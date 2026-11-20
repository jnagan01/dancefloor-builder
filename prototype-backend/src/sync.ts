import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { parseSafeSaveRequest } from '@/lib/eventSchemas';
import { inspectBackupValues } from '@/lib/backupPolicy';
import { readKnowledge } from '@/lib/prep/knowledge';
import {validateLibrarySources,validateLibraryManifest,validateLibraryChunk,isChunkedLibrary,isLibraryChunkId,libraryChunkIds,LIBRARY_PUSH_BATCH,LIBRARY_PULL_BATCH,stableLibrary} from './library';
import { assertSyntheticSave } from './guards.mjs';
const Base = z.object({ workspace: z.guid() });
const Push = Base.extend({ kind: z.enum(['event','prep','library']), id: z.string().min(1).max(100), expectedRevision: z.guid().nullable(), writeRevision: z.guid(), payload: z.record(z.string(), z.unknown()) });
const stable = (v: unknown): string => JSON.stringify(v, (_key, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))) : x);
function unavailable() { return Object.assign(Error('Test synchronization is temporarily unavailable. Local changes are kept.'), { status: 503, code: 'sync_unavailable' }); }
export function validateSyncPayload(kind: string, id: string, payload: any) {
  if (Buffer.byteLength(JSON.stringify(payload)) > 262144) throw Error('Test synchronization payload is too large.');
  inspectBackupValues(payload);
  const walk = (v: unknown): void => {
    if (typeof v === 'string' && (/\/Users\/|\/Volumes\/|[a-z]:\\|sb_secret_|Bearer\s/i.test(v))) throw Error('Private fields cannot enter test synchronization.');
    if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  }; walk(payload);
  if (kind === 'event') {
    z.guid().parse(id);
    const request = { id, create: true, expectedUpdatedAt: null, expectedRevision: null, writeRevision: randomUUID(), ...payload };
    parseSafeSaveRequest(request); assertSyntheticSave(request);
  } else if (kind === 'prep') {
    if (id !== 'knowledge' || !readKnowledge(payload)) throw Error('Invalid preparation information.');
  } else if (kind === 'library') {
    if(isLibraryChunkId(id))validateLibraryChunk(id,payload);
    else if(id==='index'&&isChunkedLibrary(payload))validateLibraryManifest(payload);
    else if(id==='index')validateLibrarySources(payload.sources,100);
    else throw Error('Invalid test library identity.');
  } else throw Error('Unknown synchronization document.');
}
export async function runSyncRequest(db: any, owner: string, operation: string, raw: unknown) {
  const chunkQuery=(workspace:string,ids:string[])=>db.from('prototype_sync_documents').select('entity_id,payload').eq('user_id',owner).eq('workspace_id',workspace).eq('kind','library').in('entity_id',ids);
  if(operation==='library-push'){
    const p=Base.extend({chunks:z.array(z.object({id:z.string(),payload:z.record(z.string(),z.unknown())}).strict()).min(1).max(LIBRARY_PUSH_BATCH)}).strict().parse(raw);
    if(new Set(p.chunks.map(c=>c.id)).size!==p.chunks.length)throw Error('Repeated library chunk identity.');
    for(const c of p.chunks)validateLibraryChunk(c.id,c.payload);
    const {error}=await db.from('prototype_sync_documents').upsert(p.chunks.map(c=>({user_id:owner,workspace_id:p.workspace,kind:'library',entity_id:c.id,revision:randomUUID(),payload:c.payload})),{onConflict:'user_id,workspace_id,kind,entity_id',ignoreDuplicates:true});if(error)throw unavailable();
    const result=await chunkQuery(p.workspace,p.chunks.map(c=>c.id));if(result.error)throw unavailable();if(result.data?.length!==p.chunks.length)throw unavailable();for(const c of p.chunks){const stored=result.data.find((r:any)=>r.entity_id===c.id);validateLibraryChunk(c.id,stored?.payload);if(stableLibrary(stored.payload)!==stableLibrary(c.payload))throw Error('Stored library chunk differs; original copies kept.');}
    return {status:200,body:{ids:p.chunks.map(c=>c.id)}};
  }
  if(operation==='library-pull'){
    const p=Base.extend({ids:z.array(z.string()).min(1).max(LIBRARY_PULL_BATCH)}).strict().parse(raw);if(p.ids.some(id=>!isLibraryChunkId(id))||new Set(p.ids).size!==p.ids.length)throw Error('Invalid library chunk request.');const result=await chunkQuery(p.workspace,p.ids);if(result.error)throw unavailable();if(result.data?.length!==p.ids.length)throw Object.assign(Error('Library transfer is incomplete. The previous library is preserved.'),{status:503,code:'sync_unavailable'});const chunks=p.ids.map(id=>({id,payload:validateLibraryChunk(id,result.data.find((r:any)=>r.entity_id===id)?.payload)}));return {status:200,body:{chunks}};
  }
  if (operation === 'pull') {
    const { workspace,libraryChunks } = Base.extend({libraryChunks:z.literal('separate').optional()}).parse(raw);
    let query=db.from('prototype_sync_documents').select('kind,entity_id,revision,payload,created_at,updated_at').eq('user_id',owner).eq('workspace_id',workspace);
    if(libraryChunks==='separate')query=query.not('entity_id','like','chunk:%');
    const {data,error}=await query.order('kind').order('entity_id').limit(501);
    if (error) throw unavailable();
    if (data.length > 500 || Buffer.byteLength(JSON.stringify(data)) > 4 * 1024 * 1024) throw Object.assign(Error('The test workspace exceeds its synchronization limit. Nothing was discarded.'),{status:413,code:'sync_limit'});
    for (const row of data) validateSyncPayload(row.kind,row.entity_id,row.payload);
    return { status:200, body:{documents:data} };
  }
  if(operation!=='push')throw Error('Unknown synchronization operation.');
  const p = Push.parse(raw); validateSyncPayload(p.kind,p.id,p.payload);
  if(p.kind==='library'&&p.id!=='index')throw Error('Immutable chunks must use the bounded library transfer.');
  if(p.kind==='library'&&isChunkedLibrary(p.payload)){const ids=libraryChunkIds(p.payload);for(let start=0;start<ids.length;start+=50){const batch=ids.slice(start,start+50);const {data,error}=await db.from('prototype_sync_documents').select('entity_id').eq('user_id',owner).eq('workspace_id',p.workspace).eq('kind','library').in('entity_id',batch);if(error)throw unavailable();if(data?.length!==batch.length)throw Object.assign(Error('Library chunks must finish uploading before publishing their manifest.'),{status:503,code:'sync_unavailable'});}}
  const where = (q: any) => q.eq('user_id',owner).eq('workspace_id',p.workspace).eq('kind',p.kind).eq('entity_id',p.id);
  if (p.expectedRevision === null) {
    const { error } = await db.from('prototype_sync_documents').upsert({user_id:owner,workspace_id:p.workspace,kind:p.kind,entity_id:p.id,revision:p.writeRevision,payload:p.payload},{onConflict:'user_id,workspace_id,kind,entity_id',ignoreDuplicates:true});
    if(error)throw unavailable();
  } else {
    const { data,error } = await where(db.from('prototype_sync_documents').update({revision:p.writeRevision,payload:p.payload})).eq('revision',p.expectedRevision).select('kind,entity_id,revision,payload,created_at,updated_at').maybeSingle();
    if(error)throw unavailable(); if(data)return {status:200,body:{document:data}};
  }
  const { data,error } = await where(db.from('prototype_sync_documents').select('kind,entity_id,revision,payload,created_at,updated_at')).maybeSingle();
  if(error)throw unavailable();
  if(data?.revision===p.writeRevision && stable(data.payload)===stable(p.payload))return {status:200,body:{document:data}};
  return {status:409,body:{error:'This item changed on another device. Both copies are kept for review.',code:'sync_conflict',document:data}};
}
