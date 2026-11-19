import { validatedEntry, type Entry } from './schema';
/** Bounded read batches: count AND serialized (URL-encoded) size, so long/unicode credits never build oversized GET URLs. */
export const READ_BATCH_COUNT=100, READ_BATCH_CHARS=4000;
export function readBatches<T>(items:T[], size:(item:T)=>number, maxCount=READ_BATCH_COUNT, maxChars=READ_BATCH_CHARS):T[][] {
  const out:T[][]=[];let cur:T[]=[],chars=0;
  for(const item of items){const n=size(item);if(cur.length&&(cur.length>=maxCount||chars+n>maxChars)){out.push(cur);cur=[];chars=0;}cur.push(item);chars+=n;}
  if(cur.length)out.push(cur);return out;
}
export const encodedSize=(s:string)=>encodeURIComponent(s).length+3;
/** Some batches failed: carries every validated entry from the batches that succeeded (never a silent miss). */
export class EvidenceReadError extends Error { constructor(readonly entries:Entry[]){super('Evidence cache read unavailable');} }
export interface EvidenceStorage { read(keys:string[]):Promise<Entry[]>; write(entry:Entry):Promise<void> }
export function createEvidenceStorage():EvidenceStorage {
  return {
    async read(keys) {
      const { supabaseAdmin }=await import('@/integrations/supabase/client.server');
      // Every requested key is read (no truncation), in bounded parallel batches.
      const replies=await Promise.allSettled(readBatches([...new Set(keys)],encodedSize).map(async batch=>{
        const {data,error}=await supabaseAdmin.from('track_evidence_cache').select('cache_key,kind,value,fetched_at').in('cache_key',batch);
        if(error) throw new Error('Evidence cache read unavailable');
        return (data??[]).flatMap(r=>{const e=batch.includes(r.cache_key)?validatedEntry({key:r.cache_key,kind:r.kind,value:r.value,at:Date.parse(r.fetched_at)}):null;return e?[e]:[];});
      }));
      const entries=replies.flatMap(r=>r.status==='fulfilled'?r.value:[]);
      if(replies.some(r=>r.status==='rejected'))throw new EvidenceReadError(entries);
      return entries;
    },
    async write(input) {
      const e=validatedEntry(input); if(!e) throw new Error('Invalid evidence');
      const { supabaseAdmin }=await import('@/integrations/supabase/client.server');
      const {error}=await supabaseAdmin.from('track_evidence_cache').upsert({cache_key:e.key,kind:e.kind,value:e.value as import('@/integrations/supabase/types').Json,fetched_at:new Date(e.at).toISOString()});
      if(error) throw new Error('Evidence cache write unavailable');
    },
  };
}
