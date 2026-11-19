import { localInformation } from './local';
import { informationKey, schemas, emptyCounts, MetadataSchema, type ReuseCounts, type Entry, type Kind, validatedEntry } from './schema';
import { META_ATTRS, sourceRank } from '../prep/provenance';
import type { EnrichedSong, EnrichStatus } from '../enrich.functions';
const deliveredCounts=new WeakSet<object>();

export async function reuseMetadata(account:string,songs:Array<{artist:string;song:string}>,needPopularity:boolean,send:(songs:Array<{artist:string;song:string}>)=>Promise<{results:EnrichedSong[];status?:EnrichStatus}>,current:()=>boolean,end:number) {
  const local=localInformation(), session=local.session(account), live=()=>session()&&current();
  const retainedAt=new Map<string,number>();
  const counts=emptyCounts(), ready=new Map<string,EnrichedSong>(), retained=new Map<string,EnrichedSong>();
  const reads=typeof indexedDB==='undefined'?songs:(await Promise.all(songs.map(async s=>{
    const key=informationKey('metadata',s.artist,s.song),hit=await local.read(account,key,'metadata',live,end,needPopularity);
    if(hit.failed)counts.readFailed++;
    if(hit.retained){retained.set(key,hit.retained.value as EnrichedSong);retainedAt.set(key,hit.retained.at);}
    if(hit.entry){counts.local++;ready.set(key,{...(hit.entry.value as EnrichedSong),artist:s.artist,song:s.song});return null;}
    return s;
  })));
  if(typeof indexedDB==='undefined')counts.readFailed+=songs.length;
  const missing=reads.filter((s):s is {artist:string;song:string}=>!!s);
  let status:EnrichStatus|undefined;
  if(missing.length&&live()) {
    // The gatherer remains the transport owner: never hide its 20s timeout behind a local race.
    let reply: Awaited<ReturnType<typeof send>>;
    try { reply=await send(missing); }
    catch (error) {
      if(!live() || !retained.size) throw error;
      counts.refreshFailed++;
      reply={results:missing.map(s=>retained.get(informationKey('metadata',s.artist,s.song))??{...s,source:'none' as const})};
    }
    if(!live())return {results:[],status,counts};status=reply.status;
    const wire=(reply.status as EnrichStatus&{reuse?:ReuseCounts})?.reuse;
    if(wire)for(const k of Object.keys(counts) as Array<keyof ReuseCounts>)counts[k]+=k==='missing'?0:wire[k]??0;
    const writes:Promise<boolean>[]=[];
    for(const e of reply.results) {
      const key=informationKey('metadata',e.artist,e.song);if(!missing.some(s=>informationKey('metadata',s.artist,s.song)===key))continue;const old=retained.get(key);
      const parsed=MetadataSchema.safeParse(e);if(!parsed.success)continue;
      const value={...old,...parsed.data};
      // Missing refresh fields never erase retained facts; provenance remains field-specific.
      if(old)for(const a of META_ATTRS)if(old[a]!=null&&(e[a]==null||sourceRank(e.prov?.[a])<sourceRank(old.prov?.[a]))){(value as Record<string,unknown>)[a]=old[a];value.prov={...value.prov,[a]:old.prov?.[a]??'estimate'};}
      value.updated={...old?.updated,...parsed.data.updated};value.checked={...old?.checked,...parsed.data.checked};if(old?.missed||parsed.data.missed)value.missed={...old?.missed,...parsed.data.missed};
      for(const a of META_ATTRS)if(value[a]!=null){
        const unchanged=old&&old[a]===value[a]&&old.prov?.[a]===value.prov?.[a];
        value.updated[a]=unchanged ? old.updated?.[a]??retainedAt.get(key)??0 : parsed.data.updated?.[a]??retainedAt.get(key)??Date.now();
      }
      ready.set(key,value);
      if(e.source!=='none'&&!e.incomplete) {
        const entry:Entry={key,kind:'metadata',value,at:Math.max(...Object.values(value.checked??value.updated??{}).filter((n):n is number=>typeof n==='number'),0)||Date.now()};
        if(typeof indexedDB==='undefined')counts.writeFailed++;else writes.push(local.write(account,entry,live,end));
      }
    }
    if(writes.length){const outcomes=await Promise.all(writes);counts.writeFailed+=outcomes.filter(v=>!v).length;}
  }
  const results=songs.map(s=>ready.get(informationKey('metadata',s.artist,s.song))??{...s,source:'none' as const});
  counts.missing+=results.filter(e=>e.energy==null||e.danceability==null||(needPopularity&&e.popularity==null)).length;
  return {results,status,counts};
}
export async function reuseDetails<T>(account:string,kind:Kind,artist:string,title:string,send:()=>Promise<{ok:true;items:T;cached?:boolean;updatedAt?:number;reuse?:ReuseCounts;stale?:boolean;compatible?:Entry[]}|{ok:false;error:string;reuse?:ReuseCounts}>,current:()=>boolean,end:number) {
  const local=localInformation(),session=local.session(account),live=()=>session()&&current(),key=informationKey(kind,artist,title),counts=emptyCounts();
  const hit=await local.read(account,key,kind,live,end);if(hit.failed)counts.readFailed++;
  if(hit.entry){counts.local++;return {ok:true as const,items:hit.entry.value as T,updatedAt:hit.entry.at,reuse:counts,cached:true};}
  try {
    const result=await local.shared(`${account}:${key}`,send,end,live);
    if(!live())return {ok:false as const,error:"Information cancelled"};
    const wireCounts=!deliveredCounts.has(result)?result.reuse:undefined;deliveredCounts.add(result);
    if(result.ok){const p=schemas[kind].safeParse(result.items);if(p.success){const at=result.updatedAt??Date.now();const extras=result.compatible??(p.data as {compatible?:Entry[]}).compatible??[];const entries=[{key,kind,value:p.data,at},...extras].flatMap(e=>{const v=validatedEntry(e);return v?[v]:[];});const writes=await Promise.all(entries.map(e=>local.write(account,e,live,end)));counts.writeFailed+=writes.filter(v=>!v).length;}return {...result,reuse:{...emptyCounts(),...wireCounts,local:counts.local,readFailed:counts.readFailed+(wireCounts?.readFailed??0),writeFailed:counts.writeFailed+(wireCounts?.writeFailed??0)}};}
    if(wireCounts)for(const k of Object.keys(counts) as Array<keyof ReuseCounts>)counts[k]+=wireCounts[k]??0;
    if(hit.retained&&live()){counts.refreshFailed++;return {ok:true as const,items:hit.retained.value as T,updatedAt:hit.retained.at,reuse:counts,cached:true};}
    return {...result,reuse:counts};
  }catch{if(hit.retained&&live()){counts.refreshFailed++;return {ok:true as const,items:hit.retained.value as T,updatedAt:hit.retained.at,reuse:counts,cached:true};}return {ok:false as const,error:'Track information could not be checked. Try again.'};}
}

/** Account-scoped evidence coordinator used by actual generation context and details. */
export async function reusePublicEvidence<T>(account:string,kind:Kind,artist:string,title:string,shape:string,send:()=>Promise<{value:T;at:number;counts?:ReuseCounts;stale?:boolean}>,current:()=>boolean,end:number) {
 const local=localInformation(),session=local.session(account),live=()=>session()&&current(),key=informationKey(kind,artist,title,shape),counts=emptyCounts();
 const hit=await local.read(account,key,kind,live,end);if(hit.failed)counts.readFailed++;
 if(hit.entry){counts.local++;return {value:hit.entry.value as T,at:hit.entry.at,counts,stale:false};}
 try {
  const result=await local.shared(account+':'+key,send,end,live);
  if(result.counts&&!deliveredCounts.has(result)){deliveredCounts.add(result);for(const k of Object.keys(counts) as Array<keyof ReuseCounts>)counts[k]+=result.counts[k]??0;}
  const e=validatedEntry({key,kind,value:result.value,at:result.at});
  if(!e||!await local.write(account,e,live,end))counts.writeFailed++;
  return {...result,counts};
 }catch(error){
  if(!live()||Date.now()>=end)throw Error('Information cancelled');
  const failure=error as {reuse?:ReuseCounts;category?:string};
  const c=failure.reuse;
  if(c&&typeof error==='object'&&error&&!deliveredCounts.has(error)){deliveredCounts.add(error);for(const k of Object.keys(counts) as Array<keyof ReuseCounts>)counts[k]+=c[k]??0;}
  // Only explicit, identity-matched community no-data is ordinary absence. Failed refresh
  // already counted by the service is the same failure, not another client failure.
  if(!(kind==='community'&&failure.category==='none')&&!(c?.refreshFailed))counts.refreshFailed++;
  if(hit.retained&&live())return {value:hit.retained.value as T,at:hit.retained.at,counts,stale:true};
  throw Object.assign(Error('Information unavailable'),typeof error==='object'&&error?error:{},{reuse:counts});
 }
}
