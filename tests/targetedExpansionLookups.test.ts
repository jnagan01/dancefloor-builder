import { afterEach, describe, expect, it, vi } from 'vitest';
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
import * as revisions from '@/lib/eventRevision';
import { exportReadiness } from '@/lib/exportReadiness';
import { runEnrichment, type CacheRow } from '@/lib/enrichPipeline.server';
import { encodeCacheSource } from '@/lib/prep/provenance';
import { createFactsGatherer, factsKey } from '@/lib/prep/factsGather';
import { automaticDanceFailure } from '@/lib/prep/eventFit';
import { rankPool } from '@/lib/prep/recommend';

const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });
const sections = ['warmUp', 'transition', 'peak'] as const;
const all = (h:any) => sections.flatMap(k=>h.current.result[k]);
const seconds = (h:any, lib:vdj.VdjLibrary) => sections.map(k=>exportReadiness(h.current.result[k].map((song:any,i:number)=>({song,match:h.current.matches[`${k}:${i}:${dance.dedupeKey(song.artist,song.song)}`]})),lib).knownSec);
const clients = Array.from({length:34},(_,i)=>({artist:`TEST Client ${i}`,song:`Request ${i}`}));
const inputs = { songs:clients, hours:'3.75',buffer:2,listType:'dance',expand:true,split:{warmUp:45,transition:120,peak:60},genresInput:'Pop',decades:['2000s'],bpmRange:[110,130],danceRange:[6,10],eventFit:{avoidSlow:true,familiarity:'familiar'} };
const base = { id:'A',inputs,lists:{warmUp:clients.map(s=>({...s,fromUpload:true})),transition:[],peak:[],selections:{}} };
const cacheRow = (s:{artist:string;song:string}, complete=true):CacheRow => ({artist_key:dance.normalizeKey(s.artist),song_key:dance.normalizeKey(s.song),energy:complete?8:null,danceability:complete?8:null,popularity:8,bpm:120,year:2005,genre:'Pop',camelot:null,valence:null,source:encodeCacheSource('ReccoBeats',{energy:'provider',danceability:'provider',popularity:'provider',bpm:'provider',year:'provider',genre:'provider'}),fetched_at:new Date().toISOString()});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('actual event route useful facts under slow service latency',()=>{
  for(const mode of ['cold','mixed','warm'] as const) it(`${mode}: 34 requests, irrelevant alphabetical prefix, useful later facts and individual duration coverage`,async()=>{
    vi.useFakeTimers(); const start=Date.now(), looked:string[]=[];
    const prefix=Array.from({length:2200},(_,i)=>({artist:`A Irrelevant ${i}`,title:`No fit ${i}`,filePath:`/synthetic/prefix/${i}.mp3`,year:'2005',bpm:i%2?'120':'180',genre:'Metal',songLength:120}));
    const useful=Array.from({length:40},(_,i)=>({artist:`Z Relevant ${i}`,title:`Floor ${i}`,filePath:`/synthetic/useful/${i}.mp3`,year:'2005',bpm:'120',genre:'Pop',songLength:900}));
    const lib=vdj.buildLibrary([...prefix,...useful]);
    const cache = new Map<string,CacheRow>();
    const known=[...clients,...useful.map(t=>({artist:t.artist,song:t.title}))];
    known.forEach((s,i)=>{if(mode==='warm'||(mode==='mixed'&&i%2===0))cache.set(factsKey(s),cacheRow(s));});
    // Fast documented provider misses; the real pipeline now lends UNUSED provider
    // time to a six-second AI stream without extending its fixed sixteen-second end.
    vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({content:[],recordings:[]})));
    const h=harness({rows:{A:base},contract:true,services:{enrich:async({data}:any)=>{
      looked.push(...data.songs.map(factsKey));
      return runEnrichment(data.songs,{readRows:async()=>[...cache.values()],upsert:async rows=>{rows.forEach(r=>cache.set(`${r.artist_key}||${r.song_key}`,r));},estimate:async(s,_signal,emit)=>{
        await new Promise(r=>setTimeout(r,6000));
        const result=s.map(()=>({energy:8,danceability:8}));result.forEach((v,i)=>emit?.(i,v));return result;
      }},{needPopularity:data.needPopularity});
    }}});
    await h.flush();h.library(lib);await h.flush();let elapsed=0;const pending=h.current.generate().then(()=>{elapsed=Date.now()-start;});await vi.advanceTimersByTimeAsync(110_000);await pending;await h.flush();
    expect(all(h).filter((s:any)=>s.fromUpload).map(factsKey).sort()).toEqual(clients.map(factsKey).sort());
    expect(seconds(h,lib)).toEqual([5400,14400,7200]);
    const firstOwned=looked.find(k=>!clients.some(s=>factsKey(s)===k));expect(firstOwned).toMatch(/^Z Relevant/);
    expect(looked.filter(k=>k.startsWith('Z Relevant'))).toHaveLength(40);
    expect(new Set(looked).size).toBe(looked.length);
    expect(all(h).filter((s:any)=>!s.fromUpload).every((s:any)=>s.artist.startsWith('Z Relevant')&&s.energy===8)).toBe(true);
    expect(elapsed).toBeLessThan(90_000);
    console.info(`SYNTHETIC targeted ${mode}: useful=40 coverage=${seconds(h,lib).join('/')} looked=${looked.length} elapsedMs=${elapsed}`);
    h.unmount();
  },30000);
});

it('real pipeline completes twelve-second AI after quick misses within unchanged request end; partial cache facts survive',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({content:[],recordings:[]})));
  const s={artist:'TEST Partial',song:'Exact (Radio Version)'}, writes:CacheRow[]=[];const start=Date.now();
  const p=runEnrichment([s],{readRows:async()=>[cacheRow(s,false)],upsert:async r=>{writes.push(...r);},estimate:async()=>{await new Promise(r=>setTimeout(r,12_000));return [{energy:8,danceability:7}];}});
  await vi.advanceTimersByTimeAsync(12_001);const result=await p;
  expect(Date.now()-start).toBeLessThan(16_000);expect(result.status).toMatchObject({complete:true,timedOut:[],unfinished:0});
  expect(result.results[0]).toMatchObject({energy:8,danceability:7,bpm:120,year:2005,prov:{energy:'ai',year:'provider'}});expect(writes).toHaveLength(1);
});

it('remaining-time dispatch reserve keeps completed twelve-second chunks, never sends a doomed final chunk or marks it attempted',async()=>{
  vi.useFakeTimers();let current=true;const starts:number[]=[];const start=Date.now();
  const gather=createFactsGatherer(async s=>{starts.push(Date.now()-start);await new Promise(r=>setTimeout(r,12_000));return s;},factsKey,{overallMs:90_000,minDispatchMs:()=>13_000,isCurrent:()=>current});
  const p=gather.gather(Array.from({length:64},(_,i)=>({artist:`TEST ${i}`,song:'Exact'})));await vi.advanceTimersByTimeAsync(100_000);const report=await p;
  expect(starts).toEqual([0,12000,24000,36000,48000,60000,72000]);expect(report).toMatchObject({found:56,requested:56,timedOutSongs:0,skippedAfterTimeout:8});expect(gather.wasAttempted({artist:'TEST 56',song:'Exact'})).toBe(false);
  current=false;expect((await gather.gather([{artist:'TEST 56',song:'Exact'}])).skippedCancelled).toBe(1);
});

it('fresh automatic Desperado-like unknown and verified slow cannot fill; exact cover/remix facts and requests remain independent; passive selections byte-identical',async()=>{
  const unknown={artist:'Eagles',title:'Desperado',filePath:'/synthetic/original.mp3',bpm:'121',year:'2003',genre:'Rock',songLength:240};
  const cover={...unknown,artist:'TEST Cover Act',filePath:'/synthetic/cover.mp3'};
  const remix={...unknown,title:'Desperado (Dance Remix)',filePath:'/synthetic/remix.mp3'};
  const slow={...unknown,artist:'TEST Ballad Act',title:'Independent Slow',filePath:'/synthetic/slow.mp3'};
  const saved=JSON.parse(JSON.stringify({...base,inputs:{...inputs,songs:[{artist:'Eagles',song:'Desperado'}]},lists:{warmUp:[{artist:'Eagles',song:'Desperado',fromUpload:true}],transition:[],peak:[{artist:'Eagles',song:'Desperado',fromUpload:false}],selections:{'peak:0:eagles|desperado':{paths:['/synthetic/original.mp3'],confirmed:true}}}}));
  const original=JSON.stringify(saved);const lib=vdj.buildLibrary([unknown,cover,remix,slow]);
  const h=harness({rows:{A:saved},services:{enrich:async({data}:any)=>({results:data.songs.map((s:any)=>s.artist==='TEST Cover Act'||s.song.includes('Dance Remix')?{...s,energy:8,danceability:8,source:'ReccoBeats',prov:{energy:'provider',danceability:'provider'}}:s.artist==='TEST Ballad Act'?{...s,energy:2,danceability:2,source:'ReccoBeats',prov:{energy:'provider',danceability:'provider'}}:{...s,source:'none'})})}});
  await h.flush();h.library(lib);await h.flush();expect(JSON.stringify(saved)).toBe(original);expect(h.current.result.peak).toHaveLength(1);expect(h.requests).toEqual([]);
  await h.current.generate();await h.flush();
  expect(all(h).filter((s:any)=>s.artist==='Eagles'&&s.song==='Desperado')).toHaveLength(1);expect(all(h).find((s:any)=>s.artist==='Eagles'&&s.song==='Desperado').fromUpload).toBe(true);
  expect(all(h).some((s:any)=>s.artist==='TEST Ballad Act')).toBe(false);
  expect(all(h).some((s:any)=>s.artist==='TEST Cover Act')).toBe(true);expect(all(h).some((s:any)=>s.song==='Desperado (Dance Remix)')).toBe(true);expect(JSON.stringify(saved)).toBe(original);h.unmount();
});

it('shared final rank/refill gates unknown without slow verdict; lookup lane, no-fit and client in-event identity exceptions unchanged',()=>{
  const rows=[{artist:'TEST',song:'Unknown',origin:'library' as const,facts:{bpm:121}},{artist:'TEST Cover',song:'Unknown',origin:'library' as const,facts:{},fit:{energy:8,energySource:'provider' as const,danceability:8,danceabilitySource:'provider' as const}}];
  const ctx={requests:[],inEvent:[],feedback:[],dismissed:[],preferences:{fit:{avoidSlow:true}},automaticExpansion:true};
  expect(rankPool(rows,r=>r,ctx).map(r=>r.item.artist)).toEqual(['TEST Cover']);expect(rankPool(rows,r=>r,{...ctx,lookupPriority:true})).toHaveLength(2);
  expect(rankPool(rows,r=>r,{...ctx,preferences:{}})).toHaveLength(2);
  expect(automaticDanceFailure({avoidSlow:true},undefined)).toMatch(/not classified slow/);
});

for(const n of [100,200,600]) for(const mode of ['cold','mixed','warm'] as const) it(`real pipeline+scheduler ${n}/${mode} six-second estimates: bounded, no futile repeats, warm facts survive`,async()=>{
  vi.useFakeTimers();const input=Array.from({length:n},(_,i)=>({artist:`TEST ${i}`,song:`Exact ${i}`}));
  const cache=input.filter((_,i)=>mode==='warm'||(mode==='mixed'&&i%2===0)).map(s=>cacheRow(s));const calls:string[]=[];let estimates=0,readyAt=0,reserve=0;
  vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({content:[],recordings:[]})));
  const start=Date.now();const g=createFactsGatherer(async chunk=>{
    calls.push(...chunk.map(factsKey));const started=Date.now();
    const out=await runEnrichment(chunk,{readRows:async()=>cache,upsert:async()=>{},estimate:async s=>{estimates++;await new Promise(r=>setTimeout(r,6000));return s.map(()=>({energy:8,danceability:8}));}});
    reserve=Math.max(reserve,Date.now()-started+1000);readyAt=Date.now()+(out.status.retryAfterMs??0);return out.results;
  },factsKey,{readyAt:()=>readyAt,minDispatchMs:()=>reserve,isIncomplete:r=>!!r.incomplete});
  let elapsed=0;const p=g.gather(input).then(r=>{elapsed=Date.now()-start;return r;});await vi.advanceTimersByTimeAsync(100_000);const report=await p;
  expect(elapsed).toBeLessThan(90_000);expect(report.timedOutSongs).toBe(0);expect(report.incompleteSongs).toBe(0);
  expect(new Set(calls).size).toBe(calls.length);expect(report.found).toBe(calls.length);
  if(mode==='warm'){expect(report.found).toBe(n);expect(estimates).toBe(0);}else if(n>=200){expect(report.skippedAfterTimeout).toBeGreaterThan(0);expect(report.found).toBeGreaterThanOrEqual(112);}
  await g.gather(input);expect(new Set(calls).size).toBe(calls.length);
  console.info(`SYNTHETIC realistic ${n}/${mode}: elapsedMs=${elapsed} facts=${report.found} unsent=${report.skippedAfterTimeout} ai=${estimates}`);
},30000);

it('rate pressure is failed/unavailable not timedout; independent cached/provider facts retained',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',async url=>new URL(String(url)).host==='api.reccobeats.com'?new Response('{}',{status:429,headers:{'retry-after':'30'}}):new Response(JSON.stringify({recordings:[]})));
  const p=runEnrichment([{artist:'TEST Pressure',song:'Exact'}],{readRows:async()=>[],upsert:async()=>{},estimate:async()=>[null]});await vi.advanceTimersByTimeAsync(16000);const out=await p;
  expect(out.status).toMatchObject({complete:false,failed:['fetch'],timedOut:[],unfinished:1});expect(out.status.retryAfterMs).toBeGreaterThan(0);expect(out.results[0].incomplete).toBe(true);
});

it('rejected AI with streamed partials remains failed/incomplete, returned partials cached once and never retried in generation',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({content:[],recordings:[]})));let estimates=0;const writes:CacheRow[]=[];
  const g=createFactsGatherer(async chunk=>(await runEnrichment(chunk,{readRows:async()=>[],upsert:async rows=>{writes.push(...rows);},estimate:async(_s,_signal,emit)=>{estimates++;emit?.(0,{energy:8});throw new Error('synthetic denial');}})).results,factsKey,{isIncomplete:r=>!!r.incomplete});
  const s=[{artist:'TEST Denied',song:'Exact'}];const report=await g.gather(s);
  expect(report).toMatchObject({found:1,incompleteSongs:1,timedOutSongs:0});expect(g.get(s[0])).toMatchObject({energy:8,prov:{energy:'ai'},incomplete:true});
  expect((await g.gather(s)).alreadyAttempted).toBe(1);expect(estimates).toBe(1);expect(writes).toHaveLength(1);
});

for(const change of ['event','account']) it(`actual 34-request route stale ${change} during six-second lookup rejects late results and sends nothing more`,async()=>{
  vi.useFakeTimers();let calls=0;const h=harness({rows:{A:base,B:{...base,id:'B'}},services:{enrich:async({data}:any)=>{calls++;await new Promise(r=>setTimeout(r,6000));return {results:data.songs.map((s:any)=>({...s,energy:8,danceability:8,source:'AI',prov:{energy:'ai',danceability:'ai'}}))};}}});
  await h.flush();const p=h.current.generate();await vi.advanceTimersByTimeAsync(1000);h.switchTo(change==='account'?'other':'owner',change==='event'?'B':'A');await h.flush();await vi.advanceTimersByTimeAsync(100000);await p;await h.flush();
  expect(calls).toBe(1);expect(all(h).some((s:any)=>s.energy===8)).toBe(false);expect(h.requests).toEqual([]);expect(h.warnings).toEqual([]);h.unmount();
});