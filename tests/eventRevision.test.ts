import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeEventConditionally } from '@/lib/eventWriteContract';
import { EVENT_REVISION_FIELD, eventRevision } from '@/lib/eventRevision';
import { createEventAutosave } from '@/lib/eventAutosave';
import { checkpointEventDraft, loadEventDraft, storeEventDraft } from '@/lib/eventDrafts';
import { eventDbHarness } from './helpers/eventDbHarness';
const fresh=()=>crypto.randomUUID();
const initial=()=>({id:'E',create:true,expectedUpdatedAt:null,expectedRevision:null,writeRevision:fresh(),name:'A',inputs:{unknown:{keep:'value'}},lists:{custom:'keep',warmUp:[]}});
afterEach(()=>vi.useRealTimers());
describe('compact revision contract',()=>{
 it('frozen timestamp payload A B A does not restore the earlier revision',async()=>{
  const h=eventDbHarness(), base=initial();const a=await writeEventConditionally(h.db,'owner',base);
  const b=await writeEventConditionally(h.db,'owner',{...base,create:false,expectedUpdatedAt:a.updatedAt,expectedRevision:a.revision,writeRevision:fresh(),name:'B'});
  const again=await writeEventConditionally(h.db,'owner',{...base,create:false,expectedUpdatedAt:b.updatedAt,expectedRevision:b.revision,writeRevision:fresh()});
  expect(again.updatedAt).toBe(a.updatedAt);expect(again.revision).not.toBe(a.revision);
  await expect(writeEventConditionally(h.db,'owner',{...base,create:false,expectedUpdatedAt:a.updatedAt,expectedRevision:a.revision,writeRevision:fresh(),name:'stale'})).rejects.toThrow('changed elsewhere');expect(h.rows.get('E').name).toBe('A');
 });
 it('legacy first update atomically initializes the marker and invalidates competing legacy writes',async()=>{
  const h=eventDbHarness();h.rows.set('E',{id:'E',user_id:'owner',updated_at:'2026-10-31T00:00:00.000Z',name:'old',inputs:{custom:123},lists:{custom:'keep'}});
  const base={...initial(),create:false,expectedUpdatedAt:h.rows.get('E').updated_at,inputs:{custom:123},lists:{custom:'keep'}};
  const result=await Promise.allSettled([writeEventConditionally(h.db,'owner',base),writeEventConditionally(h.db,'owner',{...base,writeRevision:fresh(),name:'loser'})]);
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(h.writes).toBe(1);expect(eventRevision(h.rows.get('E').inputs)).toBe(base.writeRevision);expect(h.rows.get('E').inputs.custom).toBe(123);
 });
 it('2000-song event has bounded filters, preserves unknown fields, and carries JSON only in body',async()=>{
  const h=eventDbHarness(),base=initial();const a=await writeEventConditionally(h.db,'owner',base);
  const songs=Array.from({length:2000},(_,i)=>({artist:`Artist ${i}`,song:`Song ${i}`,custom:{keep:true}}));
  const req={...base,create:false,expectedUpdatedAt:a.updatedAt,expectedRevision:a.revision,writeRevision:fresh(),inputs:{...base.inputs,songs},lists:{...base.lists,warmUp:songs,selections:{x:{paths:['Music/曲.mp3'],excluded:true}}}};
  await writeEventConditionally(h.db,'owner',req);
  expect(JSON.stringify(h.bodies.at(-1)).length).toBeGreaterThan(200000);
  expect(h.filters.every(f=>JSON.stringify(f).length<350)).toBe(true);expect(h.filters.flat().some(([k])=>k==='inputs'||k==='lists')).toBe(false);
  expect(h.rows.get('E').inputs.unknown).toEqual(base.inputs.unknown);expect(h.rows.get('E').lists.selections.x.paths).toEqual(['Music/曲.mp3']);expect(h.rows.get('E').lists.custom).toBe('keep');expect(req.inputs).not.toHaveProperty(EVENT_REVISION_FIELD);
 });
 it('create and update retry acknowledge only their own marker and exact payload',async()=>{
  const h=eventDbHarness(),base=initial();const a=await writeEventConditionally(h.db,'owner',base);expect(await writeEventConditionally(h.db,'owner',base)).toEqual(a);expect(h.writes).toBe(1);
  const req={...base,create:false,expectedUpdatedAt:a.updatedAt,expectedRevision:a.revision,writeRevision:fresh(),name:'edited'};
  const b=await writeEventConditionally(h.db,'owner',req);expect(await writeEventConditionally(h.db,'owner',req)).toEqual(b);
  await expect(writeEventConditionally(h.db,'owner',{...req,name:'wrong payload'})).rejects.toThrow('changed elsewhere');
  await expect(writeEventConditionally(h.db,'owner',{...base,writeRevision:fresh()})).rejects.toThrow('changed elsewhere');expect(h.writes).toBe(2);
 });
 it('malformed reserved fields and persisted JSON null fail without initializing them',async()=>{
  const h=eventDbHarness();const base=initial();await expect(writeEventConditionally(h.db,'owner',{...base,inputs:{[EVENT_REVISION_FIELD]:null,custom:'keep'}})).rejects.toThrow('reserved');expect(h.writes).toBe(0);
  h.rows.set('E',{id:'E',user_id:'owner',updated_at:'2026-10-31T00:00:00Z',name:'old',inputs:{[EVENT_REVISION_FIELD]:null},lists:{}});
  await expect(writeEventConditionally(h.db,'owner',{...base,create:false,expectedUpdatedAt:'2026-10-31T00:00:00Z'})).rejects.toThrow();expect(h.writes).toBe(0);
 });
 it('marker validation rejects reused marker before any request',async()=>{
  const h=eventDbHarness(),base=initial();await expect(writeEventConditionally(h.db,'owner',{...base,create:false,expectedRevision:base.writeRevision})).rejects.toThrow('reused');expect(h.filters).toHaveLength(0);
 });
});
describe('autosave and durable checkpoint marker lifecycle',()=>{
 it('retries use the identical logical marker; a newer edit uses a new marker and confirmed base',async()=>{
  vi.useFakeTimers();const attempts:any[]=[];let fail=true;const q=createEventAutosave({write:async(_id,s,a)=>{attempts.push({...a,s});if(fail)throw Error('offline');return {id:'E',updatedAt:'frozen',revision:a.writeRevision};},onState:vi.fn(),onId:vi.fn(),onError:vi.fn()});
  q.configure('E','frozen','create',null);q.schedule('first','E',()=>true,0);await vi.advanceTimersByTimeAsync(0);fail=false;q.retry();await vi.advanceTimersByTimeAsync(0);expect(attempts[0].writeRevision).toBe(attempts[1].writeRevision);
  q.schedule('second','E',()=>true,0);await vi.advanceTimersByTimeAsync(0);expect(attempts[2].writeRevision).not.toBe(attempts[1].writeRevision);expect(attempts[2].expectedRevision).toBe(attempts[1].writeRevision);q.reset();
 });
 it('earlier confirmed write rebases a newer draft without deleting it; reload retains marker and saved ID',()=>{
  const memory=new Map<string,string>();const s={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)} as Storage;
  const marker=fresh(),pending=fresh();storeEventDraft({version:1,account:'owner',event:'new',token:'pending',createId:'stable',baseVersion:null,baseRevision:null,writeRevision:pending,snapshot:{name:'second'},savedAt:1},s);
  checkpointEventDraft('owner','new',{id:'E',revision:marker,updatedAt:'frozen'},s);const loaded=loadEventDraft<any>('owner','new',s);expect(loaded).toMatchObject({token:'pending',snapshot:{name:'second'},baseRevision:marker,writeRevision:pending,savedId:'E'});
  checkpointEventDraft('owner','new',{id:'E',revision:pending,updatedAt:'frozen'},s);expect(loadEventDraft('owner','new',s)?.baseRevision).toBe(marker);
 });
});