import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextEventVersion, writeEventConditionally } from '@/lib/eventWriteContract';
import { loadMusicLibrary } from '@/lib/libraryStore';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('timestamp collision with the existing overriding trigger',()=>{
 it('rejects unsafe updates without original payload rather than re-reading a potentially newer row',async()=>{
  const from=vi.fn();await expect(writeEventConditionally({from},'owner',{id:'E',create:false,expectedUpdatedAt:'2026-10-31T00:00:00Z',name:'old draft',inputs:{},lists:{}})).rejects.toThrow('original version');expect(from).not.toHaveBeenCalled();
 });
 it('proposes an advancing token with frozen or lagging clock',()=>{
  const expected='2026-10-31T00:00:00.123456Z';
  expect(nextEventVersion(expected,Date.parse(expected))).toBe('2026-10-31T00:00:00.124Z');
  expect(nextEventVersion(expected,0)).toBe('2026-10-31T00:00:00.124Z');
 });
 it('only one different payload commits when two requests have the same expected timestamp and payload',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-31T00:00:00.000Z'));
  const initial={name:'old',inputs:{a:1},lists:{warmUp:[]}}, version=new Date().toISOString();let row={id:'E',user_id:'owner',updated_at:version,...initial};let writes=0;
  const db={from:()=>{let update:any,filters:Record<string,any>={};const chain:any={update:(p:any)=>{update=p;return chain;},select:()=>chain,eq:(k:string,v:any)=>{filters[k]=v;return chain;},maybeSingle:async()=>{
   if(Object.entries(filters).some(([k,v])=>['inputs','lists'].includes(k)?JSON.stringify((row as any)[k])!==v:(row as any)[k]!==v))return {data:null,error:null};
   if(update){writes++;row={...row,...update,updated_at:version};}return {data:{...row},error:null};}};return chain;}};
  const base={id:'E',create:false,expectedUpdatedAt:version,expectedSnapshot:initial,inputs:{a:2},lists:initial.lists};
  const outcomes=await Promise.allSettled([writeEventConditionally(db,'owner',{...base,name:'first'}),writeEventConditionally(db,'owner',{...base,name:'second'})]);
  expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(writes).toBe(1);expect(row.name).toBe('first');expect(row.updated_at).toBe(version);
 });
});
describe('null library records and atomic migration failure',()=>{
 function idb(records:Map<string,unknown>, failMigration=false){
  const reads:string[]=[], puts:any[]=[];const db={close:vi.fn(),transaction:(_s:string,mode:string)=>{
   const tx:any={};const staged=new Map(records);tx.objectStore=()=>({get:(key:string)=>{reads.push(key);const req:any={};queueMicrotask(()=>{req.result=records.get(key);req.onsuccess();});return req;},put:(v:unknown,k:string)=>{puts.push([k,v]);staged.set(k,v);},delete:(k:string)=>{staged.delete(k);queueMicrotask(()=>{if(failMigration)tx.onabort?.();else{records.clear();staged.forEach((v,k)=>records.set(k,v));tx.oncomplete?.();}});}});return tx;}};
  vi.stubGlobal('indexedDB',{open:()=>{const req:any={};queueMicrotask(()=>{req.result=db;req.onsuccess();});return req;}});return {reads,puts};
 }
 it('persisted null is invalid, not absent; never reads shared fallback',async()=>{
  const records=new Map<string,unknown>([['savedMusicLibrary:owner',null],['savedMusicLibrary',{version:1,savedAt:1,sources:[]}]]);const {reads,puts}=idb(records);
  await expect(loadMusicLibrary('owner')).rejects.toThrow('preserved');expect(reads).toEqual(['savedMusicLibrary:owner']);expect(puts).toHaveLength(0);expect(records.get('savedMusicLibrary:owner')).toBeNull();
 });
 it('aborted legacy migration reports failure and retains the original key',async()=>{
  const legacy={version:1,savedAt:1,sources:[]};const records=new Map<string,unknown>([['savedMusicLibrary',legacy]]);idb(records,true);
  await expect(loadMusicLibrary('owner')).rejects.toThrow('migration failed');expect(records.get('savedMusicLibrary')).toEqual(legacy);expect(records.has('savedMusicLibrary:owner')).toBe(false);
 });
});