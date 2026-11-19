import { informationKey, schemas, validatedEntry, type Entry, type Kind } from './schema';
import { EvidenceReadError, emptyReadFailures, readFailure } from './readFailures';
export { EvidenceReadError } from './readFailures';
/** Bounded read batches: count AND serialized (URL-encoded) size, so long/unicode credits never build oversized GET URLs. */
export const READ_BATCH_COUNT=100, READ_BATCH_CHARS=4000;
export function readBatches<T>(items:T[], size:(item:T)=>number, maxCount=READ_BATCH_COUNT, maxChars=READ_BATCH_CHARS):T[][] {
  const out:T[][]=[];let cur:T[]=[],chars=0;
  for(const item of items){const n=size(item);if(cur.length&&(cur.length>=maxCount||chars+n>maxChars)){out.push(cur);cur=[];chars=0;}cur.push(item);chars+=n;}
  if(cur.length)out.push(cur);return out;
}
export const encodedSize=(s:string)=>encodeURIComponent(s).length+3;
// PostgREST quoted values escape backslashes BEFORE quotes. The locked SDK's .in()
// only adds outer quotes and corrupts JSON-array keys; .filter() accepts exact grammar.
export const quotedFilterValue=(s:string)=>`"${s.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
export const evidenceInFilter=(keys:string[])=>`(${keys.map(quotedFilterValue).join(',')})`;
export function evidenceReadBatches(keys:string[]):string[][] {
  const out:string[][]=[];let batch:string[]=[];
  const size=(items:string[])=>new URLSearchParams({select:'cache_key,kind,value,fetched_at',cache_key:`in.${evidenceInFilter(items)}`}).toString().length+1;
  for(const key of new Set(keys)) {
    let parts:unknown;try{parts=JSON.parse(key);}catch{throw Error('Invalid evidence key');}
    if(!Array.isArray(parts)||parts.length!==4||parts.some(p=>typeof p!=='string')||key.length>1400||!Object.hasOwn(schemas,parts[0])||informationKey(parts[0] as Kind,parts[1],parts[2],parts[3])!==key)throw Error('Invalid evidence key');
    if(size([key])>READ_BATCH_CHARS)throw Error('Evidence key exceeds read URL limit');
    if(batch.length&&(batch.length>=READ_BATCH_COUNT||size([...batch,key])>READ_BATCH_CHARS)){out.push(batch);batch=[];}
    batch.push(key);
  }
  if(batch.length)out.push(batch);return out;
}
/** Some batches failed: carries every validated entry from the batches that succeeded (never a silent miss). */
export interface EvidenceStorage { read(keys:string[],signal?:AbortSignal,partial?:(entries:Entry[])=>void):Promise<Entry[]>; write(entry:Entry):Promise<void> }
export function createEvidenceStorage():EvidenceStorage {
  return {
    async read(keys,signal,partial) {
      const { supabaseAdmin }=await import('@/integrations/supabase/client.server');
      // Every requested key is read (no truncation), in bounded parallel batches.
      const batches=evidenceReadBatches(keys),replies:PromiseSettledResult<Entry[]>[]=[];
      // Never queue more than the runtime's six outbound connections.
      for(let i=0;i<batches.length;i+=6)replies.push(...await Promise.allSettled(batches.slice(i,i+6).map(async batch=>{
        if(signal?.aborted)throw Object.assign(Error('Evidence deadline'),{name:'AbortError'});
        let query=supabaseAdmin.from('track_evidence_cache').select('cache_key,kind,value,fetched_at').filter('cache_key','in',evidenceInFilter(batch));
        if(signal)query=query.abortSignal(signal).retry(false);
        const {data,error,status}=await query;
        if(error) throw signal?.aborted?{name:'AbortError'}:{code:error.code,status};
        if(signal?.aborted)throw {name:'AbortError'};
        const entries=(data??[]).flatMap(r=>{const e=batch.includes(r.cache_key)?validatedEntry({key:r.cache_key,kind:r.kind,value:r.value,at:Date.parse(r.fetched_at)}):null;return e?[e]:[];});
        partial?.(entries);return entries;
      })));
      const entries=replies.flatMap(r=>r.status==='fulfilled'?r.value:[]);
      const failures=emptyReadFailures();
      for(const r of replies)if(r.status==='rejected'){const c=readFailure(r.reason);for(const k of Object.keys(failures) as Array<keyof typeof failures>)failures[k]+=c[k];}
      if(replies.some(r=>r.status==='rejected'))throw new EvidenceReadError(entries,failures);
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
