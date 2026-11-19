import {afterEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import * as vdj from '@/lib/virtualDj';import * as dance from '@/lib/danceFloor';import * as audio from '@/lib/audioMatch';import * as snapshots from '@/lib/snapshotSafety';import * as drafts from '@/lib/eventDrafts';import * as input from '@/lib/inputSafety';import * as autosave from '@/lib/eventAutosave';import * as vibes from '@/lib/vibes';import * as isolation from '@/lib/workflowIsolation';import * as theory from '@/lib/musicTheory';import * as revisions from '@/lib/eventRevision';
import {reusePublicEvidence} from '@/lib/songInformation/client';
import {localInformation} from '@/lib/songInformation/local';
import {createDiagnosticStore} from '@/lib/generationDiagnostics/store';
import {copyDiagnostics} from '@/lib/generationDiagnostics/schema';
import {communityHandler} from './helpers/communityHandler';
import {informationKey,type Entry} from '@/lib/songInformation/schema';
import {EvidenceReadError,readFailure} from '@/lib/songInformation/readFailures';
const require=createRequire(import.meta.url);
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it.each(['none','failed','absent','malformed'] as const)('actual route two 20-row batches: 17 found / 3 %s retain truthful refresh counts',async status=>{
 vi.useFakeTimers();const local=localInformation(),writes:any[]=[];
 vi.spyOn(local,'read').mockResolvedValue({entry:null,retained:null,failed:false});
 vi.spyOn(local,'write').mockImplementation(async(_a,e,current)=>{if(!current())return false;writes.push(e);return true;});
 const saved=new Map(),store=createDiagnosticStore({read:async()=>[],write:async(a,r)=>{saved.set(a,structuredClone(r));},remove:async()=>{}});await store.activate('owner');
 const songs=Array.from({length:40},(_,i)=>({artist:`TEST Community ${i}`,song:`Exact ${i}`}));
 const lib=vdj.buildLibrary(songs.map((s,i)=>({artist:s.artist,title:s.song,filePath:`/synthetic/${i}.mp3`,songLength:240,year:'2005',bpm:'120',genre:'Pop'})));
 const base={id:'A',inputs:{songs:[{artist:'TEST Request',song:'Request'}],hours:'1.5',buffer:1,listType:'dance',expand:true,genresInput:'Pop',decades:['2000s'],eventFit:{avoidSlow:true}},lists:{warmUp:[],transition:[],peak:[],selections:{}}};
 const original=JSON.stringify(base),batches:any[][]=[];
 // Deliberately old reuse wire shape: new cause keys are absent, not NaN.
 const counts=(refreshFailed=0)=>({local:0,database:0,external:1,missing:0,readFailed:0,writeFailed:0,refreshFailed});
 const h=require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({vdj,dance:{...dance,catalogueCandidates:()=>[]},audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions,songInformation:{reusePublicEvidence},diagnostics:{beginGenerationDiagnostics:(...args:any[])=>store.begin(args[0],args[1],args[2],args[3],args[4])}})({rows:{A:base},services:{
  recommend:async()=>({suggestions:[]}),crowd:async()=>({artists:[],reuse:{...counts(0),external:0}}),similarTracks:async()=>({availability:'ok',seeds:[]}),enrich:async()=>({results:[]}),
  community:async({data}:any)=>{batches.push(data.songs);return data.songs.flatMap((s:any,i:number)=>i<17?[{...s,status:'found',evidence:{source:'lastfm',listeners:500,slowTags:[],upbeatTags:['dance']},reuse:counts()}]:status==='absent'?[]:[{...s,status:status==='malformed'?'found':status,reuse:counts(status==='failed'?1:0)}]);},
 }});
 try{
  await h.flush();h.library(lib);await h.flush();const pending=h.current.generate();await vi.advanceTimersByTimeAsync(125000);await pending;await h.flush();await store.settled();
  expect(batches.map(b=>b.length)).toEqual([20,20]);expect(writes.filter(e=>e.kind==='community')).toHaveLength(34);
  const run=store.get().rows[0].run;expect(run.reuse?.refreshFailed??0).toBe(status==='none'?0:6);expect(run.reuse?.external).toBe(status==='absent'?34:40);
  expect(Object.values(run.reuse??{}).every(Number.isFinite)).toBe(true);expect(run.reuse?.readDeadline??0).toBe(0);expect(copyDiagnostics(run)).not.toMatch(/TEST Community|Exact|\/synthetic/);
  expect(JSON.stringify(base)).toBe(original);expect(saved.size).toBe(1);
 }finally{h.unmount();}
},30000);

it.each(['partial','timeout','event','account'] as const)('actual route community batch %s counts request causes once even with locally cached first songs',async mode=>{
 vi.useFakeTimers();const local=localInformation(),saved=new Map(),store=createDiagnosticStore({read:async()=>[],write:async(a,r)=>{saved.set(a,structuredClone(r));},remove:async()=>{}});await store.activate('owner');
 const songs=Array.from({length:40},(_,i)=>({artist:`TEST Batch ${i}`,song:`Exact ${i} (Live)`}));
 const entry=(s:typeof songs[number]):Entry=>({key:informationKey('community',s.artist,s.song),kind:'community',at:Date.now()-60000,value:{source:'lastfm',listeners:6000,slowTags:[],upbeatTags:['dance']}});
 vi.spyOn(local,'read').mockImplementation(async(_a,k,kind)=>({entry:kind==='community'&&[songs[0],songs[20]].some(s=>entry(s).key===k)?entry(songs.find(s=>entry(s).key===k) as typeof songs[number]):null,retained:null,failed:false}));
 const writes:any[]=[];vi.spyOn(local,'write').mockImplementation(async(_a,e,current)=>{if(!current())return false;writes.push(e);return true;});
 const lib=vdj.buildLibrary(songs.map((s,i)=>({artist:s.artist,title:s.song,filePath:`/synthetic/batch/${i}.mp3`,songLength:240,year:'2005',bpm:'120',genre:'Pop'})));
 const base={id:'A',inputs:{songs:[{artist:'TEST Request',song:'Request'}],hours:'1.5',buffer:1,listType:'dance',expand:true,genresInput:'Pop',decades:['2000s'],eventFit:{avoidSlow:true}},lists:{warmUp:[],transition:[],peak:[],selections:{}}},original=JSON.stringify(base);
 const reads:any[][]=[],releases:Array<()=>void>=[];
 const handler=communityHandler({read:async keys=>{reads.push(keys);const rows=songs.filter(s=>keys.includes(entry(s).key)).map(entry);if(mode!=='partial')await new Promise<void>(r=>releases.push(r));throw new EvidenceReadError(rows,readFailure({code:'42501'}));},write:async()=>{}},async()=>{throw Error('Provider forbidden');});
 const h=require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({vdj,dance:{...dance,catalogueCandidates:()=>[]},audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions,songInformation:{reusePublicEvidence},diagnostics:{beginGenerationDiagnostics:(...a:any[])=>store.begin(a[0],a[1],a[2],a[3],a[4])}})({rows:{A:base},services:{recommend:async()=>({suggestions:[]}),crowd:async()=>({artists:[]}),similarTracks:async()=>({availability:'ok',seeds:[]}),enrich:async()=>({results:[]}),community:async({data}:any)=>handler(data)}});
 try{
  await h.flush();h.library(lib);await h.flush();let done=false;const pending=h.current.generate().finally(()=>{done=true;});await vi.advanceTimersByTimeAsync(1);
  expect(reads.map(r=>r.length)).toEqual([20,20]);
  if(mode==='event')h.switchTo('owner','B');if(mode==='account'){h.switchTo('other','B');await store.activate('other');}
  if(mode==='event'||mode==='account')releases.forEach(r=>r());
  for(let tick=0;tick<510&&!done;tick++)await vi.advanceTimersByTimeAsync(1000);expect(done).toBe(true);await pending;await h.flush();await store.settled();
  if(mode==='account'){expect(store.get().rows).toEqual([]);await store.activate('owner');}
  const run=structuredClone(store.get().rows[0].run),beforeWrites=writes.length;
  expect(run.reuse?.readDenied??0).toBe(mode==='partial'?2:0);expect(run.reuse?.readDeadline??0).toBe(mode==='timeout'?2:0);
  // The no-IndexedDB metadata fixture has 41 independent local read failures.
  if(mode==='partial'){expect(run.reuse?.database).toBe(38);expect(run.reuse?.local).toBe(2);expect(run.reuse?.refreshFailed??0).toBe(0);expect(run.reuse?.readFailed).toBe(43);expect([...saved.values()][0].run.reuse).toEqual(run.reuse);}
  releases.forEach(r=>r());await vi.advanceTimersByTimeAsync(10000);await store.settled();expect(store.get().rows[0].run).toEqual(run);expect(writes).toHaveLength(beforeWrites);
  expect(Object.values(run.reuse??{}).every(Number.isFinite)).toBe(true);expect(copyDiagnostics(run)).not.toMatch(/TEST Batch|Exact|\/synthetic\/batch/);expect(JSON.stringify(base)).toBe(original);
 }finally{h.unmount();}
},30000);