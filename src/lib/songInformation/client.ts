import { localInformation } from './local';
import { informationKey, schemas, emptyCounts, MetadataSchema, type ReuseCounts, type Entry, type Kind } from './schema';
import { META_ATTRS, sourceRank } from '../prep/provenance';
import type { EnrichedSong, EnrichStatus } from '../enrich.functions';

export async function reuseMetadata(account:string,songs:Array<{artist:string;song:string}>,needPopularity:boolean,send:(songs:Array<{artist:string;song:string}>)=>Promise<{results:EnrichedSong[];status?:EnrichStatus}>,current:()=>boolean,end:number) {
  const local=localInformation(), session=local.session(account), live=()=>session()&&current();
  const counts=emptyCounts(), ready=new Map<string,EnrichedSong>(), retained=new Map<string,EnrichedSong>();
  const reads=await Promise.all(songs.map(async s=>{
    const key=informationKey('metadata',s.artist,s.song),hit=await local.read(account,key,'metadata',live,end,needPopularity);
    if(hit.failed)counts.readFailed++;
    if(hit.retained)retained.set(key,hit.retained.value as EnrichedSong);
    if(hit.entry){counts.local++;ready.set(key,{...(hit.entry.value as EnrichedSong),artist:s.artist,song:s.song});return null;}
    return s;
  }));
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
    for(const e of reply.results) {
      const key=informationKey('metadata',e.artist,e.song),old=retained.get(key);
      const parsed=MetadataSchema.safeParse(e);if(!parsed.success)continue;
      const value={...old,...parsed.data};
      // Missing refresh fields never erase retained facts; provenance remains field-specific.
      if(old)for(const a of META_ATTRS)if(old[a]!=null&&(e[a]==null||sourceRank(e.prov?.[a])<sourceRank(old.prov?.[a]))){(value as Record<string,unknown>)[a]=old[a];value.prov={...value.prov,[a]:old.prov?.[a]??'estimate'};}
      value.updated={...old?.updated,...parsed.data.updated};
      for(const a of META_ATTRS)if(value[a]!=null){
        const unchanged=old&&old[a]===value[a]&&old.prov?.[a]===value.prov?.[a];
        value.updated[a]=unchanged ? old.updated?.[a]??Date.now() : parsed.data.updated?.[a]??Date.now();
      }
      ready.set(key,value);
      if(e.source!=='none'&&!e.incomplete) {
        const entry:Entry={key,kind:'metadata',value,at:Date.now()};
        if(!(await local.write(account,entry,live,end)))counts.writeFailed++;
      }
    }
  }
  const results=songs.map(s=>ready.get(informationKey('metadata',s.artist,s.song))??{...s,source:'none' as const});
  counts.missing+=results.filter(e=>e.energy==null||e.danceability==null||(needPopularity&&e.popularity==null)).length;
  return {results,status,counts};
}
export async function reuseDetails<T>(account:string,kind:Kind,artist:string,title:string,send:()=>Promise<{ok:true;items:T;cached?:boolean;updatedAt?:number;reuse?:ReuseCounts}|{ok:false;error:string}>,current:()=>boolean,end:number) {
  const local=localInformation(),session=local.session(account),live=()=>session()&&current(),key=informationKey(kind,artist,title),counts=emptyCounts();
  const hit=await local.read(account,key,kind,live,end);if(hit.failed)counts.readFailed++;
  if(hit.entry){counts.local++;return {ok:true as const,items:hit.entry.value as T,updatedAt:hit.entry.at,reuse:counts,cached:true};}
  try {
    const result=await local.shared(`${account}:${key}`,send,end,live);
    if(result.ok){const p=schemas[kind].safeParse(result.items);if(p.success){const at=result.updatedAt??Date.now();if(!await local.write(account,{key,kind,value:p.data,at},live,end))counts.writeFailed++;}return {...result,reuse:{...emptyCounts(),...result.reuse,local:counts.local,readFailed:counts.readFailed+(result.reuse?.readFailed??0),writeFailed:counts.writeFailed+(result.reuse?.writeFailed??0)}};}
    if(hit.retained&&live()){counts.refreshFailed++;return {ok:true as const,items:hit.retained.value as T,updatedAt:hit.retained.at,reuse:counts,cached:true};}
    return result;
  }catch{if(hit.retained&&live()){counts.refreshFailed++;return {ok:true as const,items:hit.retained.value as T,updatedAt:hit.retained.at,reuse:counts,cached:true};}return {ok:false as const,error:'Track information could not be checked. Try again.'};}
}
