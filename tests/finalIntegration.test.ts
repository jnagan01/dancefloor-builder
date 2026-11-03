import {describe,it,expect,vi,afterEach} from 'vitest';
import {queueBackupEvent} from '@/lib/backupClient';
import {pendingRecoveryEvent} from '@/lib/eventDrafts';
import type {Backup} from '@/lib/backups';
import {createRequire} from 'node:module';
import * as vdj from '@/lib/virtualDj';import * as dance from '@/lib/danceFloor';import * as audio from '@/lib/audioMatch';import * as snapshots from '@/lib/snapshotSafety';import * as drafts from '@/lib/eventDrafts';import * as input from '@/lib/inputSafety';import * as autosave from '@/lib/eventAutosave';import * as vibes from '@/lib/vibes';import * as isolation from '@/lib/workflowIsolation';import * as theory from '@/lib/musicTheory';import * as revisions from '@/lib/eventRevision';
const require=createRequire(import.meta.url),harness=require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({vdj,dance,audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions});
const song={artist:'A',song:'Song'},missing={artist:'B',song:'Missing'};
const backup:Backup={format:'setarchitect-backup',version:1,account:'owner',createdAt:'2026-10-31T00:00:00Z',events:[{id:'A',snapshot:{name:'Test',inputs:{songs:[song]},lists:{warmUp:[song],transition:[],peak:[]}}}],sources:[],roots:{}};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('backup restore preserves durable recovery',()=>{
 it.each(['new',pendingRecoveryEvent('new'),'malformed'])('refuses %s native-only recovery without any writes',slot=>{
   const event=slot==='malformed'?'new':slot,key=`setarchitect:recovery:owner:${encodeURIComponent(event)}`;
   const raw=slot==='malformed'?'{broken':JSON.stringify({version:1,account:'owner',event,token:'pending',createId:'pending',snapshot:backup.events[0].snapshot});
   const memory=new Map<string,string>(),journal=new Map([[key,raw]]),write=vi.fn();
   vi.stubGlobal('localStorage',{getItem:(k:string)=>memory.get(k)??null,setItem:write});
   vi.stubGlobal('window',{electronRecovery:{get:(k:string)=>journal.get(k)??null,set:write,remove:write}});
   expect(()=>queueBackupEvent(backup,'A')).toThrow();expect(journal.get(key)).toBe(raw);expect(memory.size).toBe(0);expect(write).not.toHaveBeenCalled();
 });
});
const row=()=>({id:'A',name:'Test',updated_at:'v1',inputs:{hours:'0.25',buffer:2,listType:'dance',eventName:'Test',songs:[song,missing]},lists:{warmUp:[song],transition:[song,missing],peak:[],selections:{'warmUp:0:a|song':{paths:['Synthetic/song.mp3'],confirmed:true},'transition:0:a|song':{paths:['Synthetic/song.mp3'],confirmed:true}}}});
describe('actual export route snapshot integration',()=>{
 it('section-local omission clicks Transition, then edit invalidates preview',async()=>{
   const h=harness({rows:{A:row()}});await h.flush();h.library(vdj.buildLibrary([{filePath:'Synthetic/song.mp3',artist:'A',title:'Song'}]));await h.flush();
   await h.current.exportSectionM3u('transition');h.render();
   const issue=h.current.readiness.problems.find((p:any)=>p.title==='B — Missing');expect(issue.identity).toMatchObject({section:'transition',index:1});
   h.interact((n:any)=>Array.isArray(n.props?.children)&&n.props.children.join('')==='B — Missing — No confirmed track');expect(h.current.activeSection).toBe('transition');
   h.current.applyReviewMode('none','transition');await h.flush();expect(h.current.readiness).toBe(null);h.unmount();
 });
 it('mapping and library changes during availability cannot emit unchecked paths',async()=>{
   const source=row();source.lists.selections['transition:0:a|song']={paths:['Synthetic/song.mp3'],confirmed:true,excluded:true} as any;
   const h=harness({rows:{A:source}});await h.flush();h.library(vdj.buildLibrary([{filePath:'Synthetic/song.mp3',artist:'A',title:'Song'}]));await h.flush();vdj.setFolderRoot('Synthetic','/synthetic/original');
   let finish:(v:unknown)=>void=()=>{};const checks:string[][]=[];
   h.testWindow.electronAvailability={check:(paths:string[])=>{checks.push(paths);return new Promise(resolve=>{finish=resolve;});}};
   const p=h.current.exportAllZip();vdj.setFolderRoot('Synthetic','/synthetic/unchecked');finish({ok:true,availability:{'/synthetic/original/song.mp3':'available'}});await p;
   expect(checks).toEqual([['/synthetic/original/song.mp3']]);const m3u=h.files.filter((f:any)=>f.name.endsWith('.m3u')).map((f:any)=>f.data).join('');expect(m3u).toContain('/synthetic/original/song.mp3');expect(m3u).not.toContain('/synthetic/unchecked');
   const p2=h.current.exportAllZip();h.library(vdj.buildLibrary([{filePath:'/synthetic/changed.mp3',artist:'A',title:'Song'}]));await h.flush();finish({ok:true,availability:{'/synthetic/unchecked/song.mp3':'available'}});await p2;expect(h.errors.at(-1)).toContain('Event changed');expect(h.files.filter((f:any)=>f.name.endsWith('.m3u'))).toHaveLength(1);h.unmount();
 });
 it('missing native availability result stops export',async()=>{const h=harness({rows:{A:row()}});await h.flush();h.library(vdj.buildLibrary([{filePath:'Synthetic/song.mp3',artist:'A',title:'Song'}]));await h.flush();h.testWindow.electronAvailability={check:async()=>({ok:true,availability:{}})};await h.current.exportAllZip();expect(h.errors.at(-1)).toContain('could not be verified');expect(h.files).toHaveLength(0);h.unmount();});
});
