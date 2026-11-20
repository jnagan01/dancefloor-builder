import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { parseSafeSaveRequest } from '@/lib/eventSchemas';
import { inspectBackupValues } from '@/lib/backupPolicy';
import { readKnowledge } from '@/lib/prep/knowledge';
import { validSavedLibrary } from '@/lib/libraryStore';
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
    if (id !== 'index' || !validSavedLibrary({ version: 1, savedAt: 1, sources: payload.sources }) || payload.sources.length > 5 || payload.sources.reduce((n: number,s: any)=>n+s.tracks.length,0)>100) throw Error('Invalid test library index.');
    for (const source of payload.sources) for (const track of source.tracks) if (!source.label.startsWith('Prototype ') || !/^Prototype Artist \d{2}$/.test(track.artist) || !/^Test Track \d{2}$/.test(track.title) || !/^prototype-files:\/\/\/library\/[A-Za-z0-9 ()_.-]+\.wav$/.test(track.filePath)) throw Error('Only generated test library references may synchronize.');
  } else throw Error('Unknown synchronization document.');
}
export async function runSyncRequest(db: any, owner: string, operation: string, raw: unknown) {
  if (operation === 'pull') {
    const { workspace } = Base.parse(raw);
    const { data, error } = await db.from('prototype_sync_documents').select('kind,entity_id,revision,payload,created_at,updated_at').eq('user_id',owner).eq('workspace_id',workspace).order('kind').order('entity_id').limit(501);
    if (error) throw unavailable();
    if (data.length > 500 || Buffer.byteLength(JSON.stringify(data)) > 4 * 1024 * 1024) throw Object.assign(Error('The test workspace exceeds its synchronization limit. Nothing was discarded.'),{status:413,code:'sync_limit'});
    for (const row of data) validateSyncPayload(row.kind,row.entity_id,row.payload);
    return { status:200, body:{documents:data} };
  }
  const p = Push.parse(raw); validateSyncPayload(p.kind,p.id,p.payload);
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
