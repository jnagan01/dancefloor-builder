import {afterEach,expect,it,vi} from 'vitest';
import {createRequestEvidenceStorage,createEvidenceReuse} from '@/lib/songInformation/reuse';
import {EvidenceReadError,readFailure} from '@/lib/songInformation/readFailures';
import {informationKey,type Entry} from '@/lib/songInformation/schema';
const row=(name:string,at=Date.now()):Entry=>({key:informationKey('artist',name,'','0'),kind:'artist',at,value:{name,listeners:50,playcount:100,tags:['dance'],similar:[]}});
afterEach(()=>vi.useRealTimers());
it.each([
 [{name:'TimeoutError'},'readDeadline'],[{code:'42501'},'readDenied'],[{status:403},'readDenied'],[{code:'42P01'},'readSchema'],[{code:'PGRST205'},'readSchema'],[{message:'PRIVATE query path artist secret'},'readOther'],
])('classifies only structured failure categories %j',async(error,key)=>{
 expect(readFailure(error)).toEqual({...readFailure({}),readOther:0,[key]:1});
 const e=row('TEST Partial'),s={read:async()=>{throw new EvidenceReadError([e],readFailure(error));},write:vi.fn(async()=>{})};
 const request=await createRequestEvidenceStorage(s,[e.key,e.key],Date.now()+9000);
 const load=vi.fn(async()=>{throw Error('forbidden');}),hit=await createEvidenceReuse(request.storage)('artist',e.key,load,Date.now()+1000);
 expect(hit.counts.database).toBe(1);expect(load).not.toHaveBeenCalled();expect(request.counts).toMatchObject({readFailed:1,[key]:1});expect(JSON.stringify(request.counts)).not.toMatch(/PRIVATE|query|secret|artist/);
});
it('aborts overdue hydration, retains streamed exact partials, ignores late rows and never retries the cold batch',async()=>{
 vi.useFakeTimers();const a=row('TEST Partial'),b=row('TEST Late');let signal:AbortSignal|undefined,release:(e:Entry[])=>void=()=>{};
 const read=vi.fn((_k:string[],s?:AbortSignal,partial?:(e:Entry[])=>void)=>{signal=s;partial?.([a]);return new Promise<Entry[]>(r=>{release=r;});});
 const pending=createRequestEvidenceStorage({read,write:async()=>{}},[a.key,b.key],Date.now()+9000);
 await vi.advanceTimersByTimeAsync(2000);const request=await pending;
 expect(signal?.aborted).toBe(true);expect(request.counts).toMatchObject({readFailed:1,readDeadline:1});expect(await request.storage.read([a.key])).toEqual([a]);expect(await request.storage.read([b.key])).toEqual([]);
 release([b]);await vi.advanceTimersByTimeAsync(0);expect(await request.storage.read([b.key])).toEqual([]);expect(read).toHaveBeenCalledTimes(1);
});
it('short caller deadline bounds read without extending it or starting cancelled consumer work',async()=>{
 vi.useFakeTimers();const e=row('TEST Cancel'),load=vi.fn(async()=>e.value);let current=true;
 const pending=createRequestEvidenceStorage({read:()=>new Promise(()=>{}),write:async()=>{}},[e.key],Date.now()+300);
 await vi.advanceTimersByTimeAsync(100);const request=await pending;expect(request.counts.readDeadline).toBe(1);current=false;
 await expect(createEvidenceReuse(request.storage)('artist',e.key,load,Date.now()+200,()=>current)).rejects.toThrow('cancelled');expect(load).not.toHaveBeenCalled();
});
it('failed refresh retains dated stale partial evidence, never writes a transient failure',async()=>{
 const e=row('TEST Stale',Date.now()-86400000),write=vi.fn(async()=>{});
 const request=await createRequestEvidenceStorage({read:async()=>{throw new EvidenceReadError([e],readFailure({code:'42501'}));},write},[e.key],Date.now()+9000);
 const result=await createEvidenceReuse(request.storage)('artist',e.key,async()=>{throw Error('503');},Date.now()+1000);
 expect(result.at).toBe(e.at);expect(result.stale).toBe(true);expect(result.counts.refreshFailed).toBe(1);expect(write).not.toHaveBeenCalled();
});