import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj';
import * as dance from '@/lib/danceFloor';
import * as audio from '@/lib/audioMatch';
import * as snapshots from '@/lib/snapshotSafety';
import * as drafts from '@/lib/eventDrafts';
import * as input from '@/lib/inputSafety';
import * as autosave from '@/lib/eventAutosave';
import * as vibes from '@/lib/vibes';
import * as isolation from '@/lib/workflowIsolation';
import * as theory from '@/lib/musicTheory';
const require=createRequire(import.meta.url);
const harness=require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({vdj,dance,audio,snapshots,drafts,input,autosave,vibes,isolation,theory});
const song={artist:'The Artist',song:'Song'};
const row=(buffer=2)=>({id:'A',name:'Original',updated_at:'2026-10-31T00:00:00Z',inputs:{hours:'3',buffer,eventName:'Original'},lists:{warmUp:[song],selections:{'warmUp:0:old':{paths:['Music/Song.mp3'],excluded:true}}}});
const recovery=(account='owner',event='A')=>({version:1,account,event,token:'recover',createId:'a-create',baseVersion:row().updated_at,snapshot:{name:'Recovery',inputs:{...row().inputs,eventName:'Recovery'},lists:row().lists},savedAt:1});
const key=(a:string,e:string)=>`setarchitect:recovery:${a}:${e}`;
afterEach(()=>{vi.useRealTimers();});
describe('actual mounted event route recovery and ownership',()=>{
 it('save-as-new navigates, preserves selections, and uses the durable request UUID',async()=>{
  vi.useFakeTimers();const memory=new Map([[key('owner','A'),JSON.stringify(recovery())]]);const h=harness({memory,rows:{A:row()}});await h.flush();h.current.restoreRecovery(true);await h.flush();
  const draft=JSON.parse(memory.get(key('owner','new')));expect(h.navigations[0].search).toEqual({});expect(h.current.result.warmUp[0]).toEqual(song);
  await vi.advanceTimersByTimeAsync(1000);expect(h.requests).toHaveLength(1);expect(h.requests[0].id).toBe(draft.createId);expect(h.requests[0].create).toBe(true);expect(h.requests[0].lists.selections['warmUp:0:old'].paths).toEqual(['Music/Song.mp3']);h.unmount();
 });
 it('every manual reset uses one UUID for draft and interrupted first request across reload',async()=>{
  vi.useFakeTimers();const memory=new Map();const h=harness({eventId:null,memory,write:()=>new Promise(()=>{})});await h.flush();h.current.clearWorkflowState();await h.flush();
  // Drive actual generation result boundary through explicit new-event recovery.
  memory.set(key('owner','new'),JSON.stringify({...recovery('owner','new'),createId:h.current.stableCreate,baseVersion:null}));h.unmount();
  const b=harness({eventId:null,memory,write:()=>new Promise(()=>{})});await b.flush();b.current.restoreRecovery(false);await b.flush();await vi.advanceTimersByTimeAsync(1000);const id=b.requests[0].id; expect(JSON.parse(memory.get(key('owner','new'))).createId).toBe(id);b.unmount();
  const c=harness({eventId:null,memory});await c.flush();c.current.restoreRecovery(false);await c.flush();await vi.advanceTimersByTimeAsync(1000);expect(c.requests[0].id).toBe(id);c.unmount();
 });
 it('captures A edits before same-component A to B navigation under one second',async()=>{
  vi.useFakeTimers();const h=harness({rows:{A:row(),B:{...row(),id:'B'}}});await h.flush();h.edit('Latest A');h.switchTo('owner','B');await h.flush();
  expect(JSON.parse(h.memory.get(key('owner','A'))).snapshot.inputs.eventName).toBe('Latest A');expect(h.memory.has(key('owner','B'))).toBe(false);await vi.advanceTimersByTimeAsync(1000);expect(h.requests).toHaveLength(0);h.unmount();
 });
 it('account transition cancels pending load and never labels the old snapshot as the new account',async()=>{
  vi.useFakeTimers();let resolve:(v:unknown)=>void=()=>{};const deferred=new Promise(r=>resolve=r);const h=harness({rows:{A:deferred,B:row()}});await h.flush();h.switchTo('other','B');await h.flush();resolve(row());await h.flush();expect(h.current.result.warmUp[0]).toEqual(song);h.edit('Other');await vi.advanceTimersByTimeAsync(1000);expect(h.requests.every((r:any)=>r.account==='other')).toBe(true);expect(h.memory.has(key('other','A'))).toBe(false);h.unmount();
 });
 it('pending old-account save cannot update the new account editor or draft',async()=>{
  vi.useFakeTimers();let resolve:(v:any)=>void=()=>{};const h=harness({rows:{A:row(),B:row()},write:()=>new Promise(r=>resolve=r)});await h.flush();h.edit('Old account');await vi.advanceTimersByTimeAsync(1000);h.switchTo('other','B');await h.flush();resolve({id:'A',updatedAt:'2026-10-31T00:00:02Z'});await h.flush();expect(h.current.savedEventId).toBe('B');expect(h.memory.has(key('other','A'))).toBe(false);expect(h.memory.has(key('owner','A'))).toBe(true);h.unmount();
 });
 it('malformed draft blocks saves and exit replacement until explicit archive',async()=>{
  vi.useFakeTimers();const raw='{invalid';const h=harness({memory:new Map([[key('owner','A'),raw]]),rows:{A:row()}});await h.flush();h.edit('Changed');h.pagehide();await vi.advanceTimersByTimeAsync(1000);expect(h.current.draftBlocked.current).toBe(true);expect(h.requests).toHaveLength(0);expect(h.memory.get(key('owner','A'))).toBe(raw);h.unmount();
 });
 it('delayed library and legacy selections never autosave opening-time defaults',async()=>{
  vi.useFakeTimers();const h=harness({rows:{A:row()}});await h.flush();h.library(vdj.buildLibrary([{filePath:'Music/Song.mp3',title:'Song',artist:'The Artist'}]));await h.flush();await vi.advanceTimersByTimeAsync(2000);expect(h.requests).toHaveLength(0);h.edit('User edit');await vi.advanceTimersByTimeAsync(1000);expect(h.requests).toHaveLength(1);expect(Object.values(h.requests[0].lists.selections)[0]).toMatchObject({paths:['Music/Song.mp3'],excluded:true});h.unmount();
 });
 it.each([0,0.5])('legacy buffer %s remains read-only with finite live targets',async(buffer)=>{
  const h=harness({rows:{A:row(buffer)}});await h.flush();expect(h.current.snapshotReadOnly.current).toBe(true);expect(Number.isFinite(h.current.result.perSectionBase)).toBe(true);expect(()=>h.current.computeLiveTargets([],3)).not.toThrow();expect(h.requests).toHaveLength(0);h.unmount();
 });
});