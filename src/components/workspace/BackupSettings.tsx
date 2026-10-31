import { useState, useRef, useEffect } from 'react';
import { useWorkspace } from './WorkspaceContext';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { latestBackup, queueBackupEvent, backupBridgeAvailable } from '@/lib/backupClient';
import { validateBackup, previewMetadataRestore, type Backup, MAX_BACKUP_BYTES } from '@/lib/backups';
import { getFolderRoots } from '@/lib/virtualDj';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Download, Upload, Archive } from 'lucide-react';
export function BackupSettings(){
 const workspace=useWorkspace(),{user}=useAuth(),navigate=useNavigate(),input=useRef<HTMLInputElement>(null);
 const [preview,setPreview]=useState<Backup|null>(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false);
 const owner=useRef({id:user?.id,generation:0}); if(owner.current.id!==user?.id){owner.current={id:user?.id,generation:owner.current.generation+1};}
 useEffect(()=>{setPreview(null);setSelected('');},[user?.id]);
 const run=async(f:()=>Promise<void>)=>{setBusy(true);try{await f();}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}};
 const show=(b:Backup|null)=>{setPreview(b);setSelected(b?.events[0]?.id??'');if(!b)toast.info('No backup on this device.');};
 const plan=preview?previewMetadataRestore(preview,workspace.sources,getFolderRoots()):null;
 return <section id="backups" className="space-y-4 border-b border-border pb-8"><h2 className="font-display text-lg">Backups</h2>
 <p className="text-xs text-muted-foreground">{backupBridgeAvailable()?'Dated device backups · 10 verified copies retained':'Browser-only copies · 5 retained · no automatic native update backup'} · Events, metadata and folder mappings only. Audio and sign-in details are not included.</p>
 <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy||!user} onClick={()=>void run(async()=>{const b=await workspace.backup();show(b);toast.success('Backup saved.');})}><Archive className="mr-2 size-4"/>Back up now</Button>
 <Button variant="outline" size="sm" disabled={busy||!user} onClick={()=>void run(async()=>{if(user){const captured=owner.current;const b=await latestBackup(user.id);if(owner.current!==captured)throw Error('Account changed.');show(b);}})}>Preview latest</Button>
 <Button variant="outline" size="sm" disabled={busy||!user} onClick={()=>input.current?.click()}><Upload className="mr-2 size-4"/>Import backup</Button>
 <input ref={input} type="file" accept=".json" className="hidden" onChange={e=>{const file=e.target.files?.[0];if(!file||!user)return;void run(async()=>{if(file.size>MAX_BACKUP_BYTES)throw Error('Backup exceeds 32 MB.');const captured=owner.current;const raw=await file.text();if(owner.current!==captured)throw Error('Account changed.');show(validateBackup(raw,user.id));});e.target.value='';}}/>
 </div>
 {preview&&<div className="space-y-3"><p className="text-sm">{new Date(preview.createdAt).toLocaleString()} · {preview.events.length} events · {preview.sources.reduce((n,s)=>n+s.tracks.length,0)} track records</p>
 <label className="block text-sm">Event to restore<select aria-label="Event to restore" className="mt-1 block max-w-full rounded-md border border-input bg-background p-2" value={selected} onChange={e=>setSelected(e.target.value)}>{preview.events.map(e=><option key={e.id} value={e.id}>{e.snapshot.name||'Untitled event'}</option>)}</select></label>
 <Button size="sm" disabled={!selected||busy} onClick={()=>void run(async()=>{if(!user||user.id!==preview.account)throw Error('Account changed. Preview this account’s backup first.');queueBackupEvent(validateBackup(JSON.stringify(preview),user.id),selected);await navigate({to:'/events/new'});})}>Restore selected event as new</Button>
 <p className="text-xs text-muted-foreground">Library restore: {plan?.additions.length} new sources · {plan?.conflictCount} conflicts left unchanged</p>
 {plan&&plan.conflicts.length>0&&<ul className="max-h-32 overflow-auto text-xs text-warning">{plan.conflicts.map((c,i)=><li key={i}>{c}</li>)}</ul>}
 <Button size="sm" variant="outline" disabled={busy||!plan?.additions.length} onClick={()=>void run(async()=>{await workspace.restoreMetadata(preview);toast.success('Non-conflicting sources added; existing library unchanged.');})}>Add non-conflicting metadata sources</Button>
 <Button variant="ghost" size="sm" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(preview)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`setarchitect-backup-${preview.createdAt.replace(/[:.]/g,'-')}.json`;a.click();URL.revokeObjectURL(url);}}><Download className="mr-2 size-4"/>Download backup</Button>
 </div>}
 </section>;
}
