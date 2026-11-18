import { afterEach, describe, expect, it, vi } from 'vitest';
import { informationKey, validatedEntry, freshMetadata, DAY, reuseSummary, emptyCounts } from '@/lib/songInformation/schema';
import { createEvidenceReuse, createSharedWork } from '@/lib/songInformation/reuse';
import { createLocalInformation } from '@/lib/songInformation/local';
const fact={artist:'TEST Credit & Guest',song:'Exact (Live)',source:'ReccoBeats',energy:8,danceability:8,popularity:7,prov:{energy:'provider',danceability:'provider',popularity:'provider'}};
afterEach(()=>vi.useRealTimers());
describe('bounded public evidence reuse',()=>{
 it('cold then service recreation reuses durable successful facts without a provider call',async()=>{
  const rows=new Map(),storage={read:async(keys:string[])=>keys.flatMap(k=>rows.has(k)?[rows.get(k)]:[]),write:async(e:any)=>{rows.set(e.key,e);}};
  const load=vi.fn(async()=>fact),key=informationKey('metadata',fact.artist,fact.song);
  const first=await createEvidenceReuse(storage)('metadata',key,load,Date.now()+1000);
  const second=await createEvidenceReuse(storage)('metadata',key,load,Date.now()+1000);
  expect(load).toHaveBeenCalledTimes(1);expect(first.counts.external).toBe(1);expect(second.counts.database).toBe(1);
 });
 it('retains dated evidence on 429/503/network refresh failure without a successful write',async()=>{
  const at=Date.now()-2*DAY,key=informationKey('community','TEST','Exact');
  for(const cause of ['429','503','network']){
   const write=vi.fn(),value={source:'lastfm',listeners:6000,slowTags:[],upbeatTags:['dance']};
   const result=await createEvidenceReuse({read:async()=>[{kind:'community',key,value,at}],write})('community',key,async()=>{throw new Error(cause);},Date.now()+1000);
   expect(result.at).toBe(at);expect(result.value).toEqual(value);expect(result.stale).toBe(true);expect(result.counts.refreshFailed).toBe(1);expect(write).not.toHaveBeenCalled();
  }
 });
 it('unavailable schema/read/write are counted separately, not provider misses or saved claims',async()=>{
  const result=await createEvidenceReuse({read:async()=>{throw Error('schema unavailable');},write:async()=>{throw Error('quota');}})('metadata','key',async()=>fact,Date.now()+1000);
  expect(result.counts).toMatchObject({readFailed:1,writeFailed:1,external:1,database:0,missing:0});
 });
 it('identity never merges full credits, remixes, live, acoustic, clean or differing shapes',()=>{
  const keys=['Exact','Exact (Live)','Exact (Remix)','Exact (Acoustic)','Exact (Clean)'].map(t=>informationKey('metadata','A & B',t));
  expect(new Set(keys).size).toBe(5);expect(informationKey('similar','A','Exact','8')).not.toBe(informationKey('similar','A','Exact','20'));
  expect(informationKey('metadata','A & B','Exact')).not.toBe(informationKey('metadata','A & C','Exact'));
 });
 it('field ageing retains stable verified values but requires fresh complete popularity',()=>{
  const at=Date.now()-100*DAY;
  expect(freshMetadata(fact,at)).toBe(true);expect(freshMetadata(fact,at,true)).toBe(false);
  expect(freshMetadata({...fact,popularity:undefined},Date.now(),true)).toBe(false);
  expect(freshMetadata({...fact,updated:{popularity:Date.now()}},at,true)).toBe(true);
  expect(freshMetadata({...fact,prov:{energy:'ai',danceability:'ai'}},at)).toBe(false);
 });
 it('validation strips private metadata and rejects raw evidence shapes, oversized or corrupt entries',()=>{
  const e=validatedEntry({key:'k',kind:'metadata',value:{...fact,path:'/private',token:'secret'},at:Date.now()});
  expect(JSON.stringify(e)).not.toMatch(/private|secret|token/);
  expect(validatedEntry({key:'k',kind:'community',value:{source:'lastfm',raw:'payload'},at:Date.now()})).toBeNull();
  expect(validatedEntry({key:'k'.repeat(2000),kind:'metadata',value:fact,at:Date.now()})).toBeNull();
  expect(reuseSummary(emptyCounts())).not.toMatch(/TEST|Credit|Live/);
 });
 it('coalesces concurrent work, caller cancellation is independent, rejected entries evict',async()=>{
  const shared=createSharedWork();let settle:(v:number)=>void=()=>{};let current=true;
  const send=vi.fn(()=>new Promise<number>(r=>{settle=r;}));
  const a=shared('exact',send,Date.now()+1000,()=>current).catch(()=>null),b=shared('exact',send,Date.now()+1000);
  await Promise.resolve();current=false;settle(8);expect(await a).toBeNull();expect(await b).toBe(8);expect(send).toHaveBeenCalledTimes(1);
  await expect(shared('bad',async()=>{throw Error('denied');},Date.now()+1000)).rejects.toThrow('denied');
  expect(await shared('bad',async()=>9,Date.now()+1000)).toBe(9);
 });
 it('hung work remains one transport after consumer timeout, then rejection releases safely',async()=>{
  vi.useFakeTimers();const shared=createSharedWork();let reject:(e:Error)=>void=()=>{};
  const send=vi.fn(()=>new Promise<number>((_,r)=>{reject=r;}));
  const a=shared('hung',send,Date.now()+100).catch(()=>null);await vi.advanceTimersByTimeAsync(100);expect(await a).toBeNull();
  const b=shared('hung',send,Date.now()+100).catch(()=>null);await vi.advanceTimersByTimeAsync(100);expect(await b).toBeNull();expect(send).toHaveBeenCalledTimes(1);
  reject(Error('late'));await vi.advanceTimersByTimeAsync(0);expect(await shared('hung',async()=>7,Date.now()+100)).toBe(7);
 });
 it('local recreation reads isolated owner data and fences old account completion',async()=>{
  const rows=new Map(),storage={read:async(a:string,k:string)=>rows.get(a+':'+k),write:async(a:string,e:any)=>{rows.set(a+':'+e.key,e);}};
  const first=createLocalInformation(storage),current=first.session('A'),entry={key:'k',kind:'metadata' as const,value:fact,at:Date.now()};
  expect(await first.write('A',entry,current,Date.now()+1000)).toBe(true);
  const next=createLocalInformation(storage),live=next.session('A');expect((await next.read('A','k','metadata',live,Date.now()+1000)).entry?.value).toEqual(fact);
  next.activate('B');expect((await next.read('A','k','metadata',live,Date.now()+1000)).entry).toBeNull();
  expect((await next.read('B','k','metadata',next.session('B'),Date.now()+1000)).entry).toBeNull();
 });
});
