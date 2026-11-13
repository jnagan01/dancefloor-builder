import { afterEach, expect, it, vi } from 'vitest';
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
import { factsKey } from '@/lib/prep/factsGather';
import { AdditionKeySet, additionKeys } from '@/lib/additionIdentity';
import { recommendHandler } from './helpers/recommendHandler';
const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });
const sections = ['warmUp','transition','peak'] as const;
const clients = Array.from({length:34},(_,i)=>({artist:`TEST Request ${i}`,song:`Client ${i}`}));
const base = {id:'A',inputs:{songs:clients,hours:'3.75',buffer:2,listType:'dance',expand:true,split:{warmUp:45,transition:120,peak:60},genresInput:'Pop',decades:['2000s'],bpmRange:[110,130],danceRange:[6,10],eventFit:{avoidSlow:true}},lists:{warmUp:clients.map(s=>({...s,fromUpload:true})),transition:[],peak:[],selections:{}}};
const cacheRow = (s:any):CacheRow => ({artist_key:dance.normalizeKey(s.artist),song_key:dance.normalizeKey(s.song),energy:8,danceability:8,popularity:8,bpm:120,year:2005,genre:'Pop',camelot:null,valence:null,source:encodeCacheSource('ReccoBeats',{energy:'provider',danceability:'provider',popularity:'provider',bpm:'provider',year:'provider',genre:'provider'}),fetched_at:new Date().toISOString()});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('actual handler enforces max500 and auth before AI, bounded context retains selected requests',async()=>{
  const generate=vi.fn(async()=>({object:{suggestions:[]}}));const h=recommendHandler(generate);
  const rows=Array.from({length:2000},(_,i)=>({artist:`Act ${i}`,song:`Song ${i}`}));
  const data={section:'Peak',count:8,prefs:{},existing:rows};
  await expect(h.call({data})).rejects.toThrow();expect(generate).not.toHaveBeenCalled();
  const existing=isolation.buildRecommendExisting({warmUp:clients,transition:[],peak:[]},rows);
  expect(existing).toHaveLength(500);expect(existing.slice(0,34)).toEqual(clients);
  await h.call({data:{...data,existing}});expect(generate).toHaveBeenCalledTimes(1);
  await expect(recommendHandler(generate,false).call({data:{...data,existing}})).rejects.toThrow('Unauthorized');expect(generate).toHaveBeenCalledTimes(1);
});

for(const mode of ['cold','mixed','warm']) it(`actual route and handler ${mode}: 34 requests + 1800 unknown-prefix files + 180 three-to-five-minute safe files`,async()=>{
  vi.useFakeTimers();const start=Date.now();const cache=new Map<string,CacheRow>();const seen:string[]=[];let sends=0;
  const prefix=Array.from({length:1800},(_,i)=>({artist:`A Unknown ${i}`,title:`Uncertain ${i}`,filePath:`/synthetic/prefix/${i}.mp3`,year:'2005',bpm:'120',genre:'Metal',songLength:240}));
  const useful=Array.from({length:180},(_,i)=>({artist:`Z Floor ${i}`,title:`Safe ${i}`,filePath:`/synthetic/safe/${i}.mp3`,year:'2005',bpm:'120',genre:'Pop',songLength:180+(i%5)*30}));
  const lib=vdj.buildLibrary([...prefix,...useful]);clients.forEach(s=>cache.set(factsKey(s),cacheRow(s)));
  useful.forEach((t,i)=>{if(mode==='warm'||(mode==='mixed'&&i%2===0))cache.set(factsKey({artist:t.artist,song:t.title}),cacheRow({artist:t.artist,song:t.title}));});
  vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({content:[],recordings:[]})));
  const server=recommendHandler(async()=>{sends++;return {object:{suggestions:[{artist:useful[0].artist+' feat. TEST Guest',song:useful[0].title,energy:8,danceability:8,popularity:8,genre:'Pop',decade:'2000s'},...useful.slice(150,158).map(t=>({artist:t.artist,song:t.title,energy:8,danceability:8,popularity:8,genre:'Pop',decade:'2000s'}))]}};});
  const h=harness({rows:{A:structuredClone(base)},contract:true,services:{recommend:server.call,enrich:async({data}:any)=>{
    seen.push(...data.songs.map(factsKey));return runEnrichment(data.songs,{readRows:async()=>[...cache.values()],upsert:async rows=>{for(const row of rows)cache.set(`${row.artist_key}||${row.song_key}`,row);},estimate:async songs=>{await new Promise(r=>setTimeout(r,6000));return songs.map(s=>s.artist.startsWith('Z Floor')?{energy:8,danceability:8}:null);}});
  }}});
  await h.flush();h.library(lib);await h.flush();const pending=h.current.generate();await vi.advanceTimersByTimeAsync(180000);await pending;await h.flush();
  const seconds=sections.map(k=>exportReadiness(h.current.result[k].map((song:any,i:number)=>({song,match:h.current.matches[`${k}:${i}:${dance.dedupeKey(song.artist,song.song)}`]})),lib).knownSec);
  expect(seconds[0]).toBeGreaterThanOrEqual(5400);expect(seconds[1]).toBeGreaterThanOrEqual(14400);expect(seconds[2]).toBeGreaterThanOrEqual(7200);
  const all=sections.flatMap(k=>h.current.result[k]);expect(all.filter((s:any)=>s.fromUpload).map(factsKey).sort()).toEqual(clients.map(factsKey).sort());
  expect(all.filter((s:any)=>!s.fromUpload).every((s:any)=>s.artist.startsWith('Z Floor'))).toBe(true);expect(new Set(all.map(factsKey)).size).toBe(all.length);expect(new Set(seen).size).toBe(seen.length);
  expect(h.errors).toEqual([]);console.info(`SYNTHETIC short-track ${mode}: seconds=${seconds.join('/')} requested=${seen.length} suggestions=${sends}`);h.unmount();
},30000);

it('terminal actual validator rejection is sent at most once per section lane, never replayed, retains requests and reports honest shortage',async()=>{
  let sends=0;const server=recommendHandler(async()=>({object:{suggestions:[]}}));
  const h=harness({rows:{A:structuredClone(base)},services:{recommend:async(r:any)=>{sends++;return server.call({data:{...r.data,existing:Array.from({length:501},()=>clients[0])}});}}});
  await h.flush();await h.current.generate();await h.flush();expect(sends).toBeGreaterThanOrEqual(1);expect(sends).toBeLessThanOrEqual(3);expect(h.infos.some((m:string)=>m.includes('did not pass validation'))).toBe(true);expect(h.warnings.some((m:string)=>m.includes('short'))).toBe(true);
  expect(sections.flatMap(k=>h.current.result[k]).filter((s:any)=>s.fromUpload)).toHaveLength(34);h.unmount();
});

it('only rate/server failures are retryable; schema and timeout never replay',()=>{
  expect(isolation.suggestionFailure({status:429}).retryable).toBe(true);expect(isolation.suggestionFailure({status:503}).retryable).toBe(true);
  expect(isolation.suggestionFailure({status:400,issues:[]}).retryable).toBe(false);expect(isolation.suggestionFailure(new Error('Suggestion time limit reached')).retryable).toBe(false);
});

for (const latency of [6000,12000,15000]) it(`independent recording lag and ${latency}ms AI retain partials within fixed end`,async()=>{
  vi.useFakeTimers();const start=Date.now();let aiStart=-1;let calls=0;
  vi.stubGlobal('fetch',async url=>{if(String(url).includes('musicbrainz.org'))return new Promise(()=>{});return new Response(JSON.stringify({content:[]}));});
  const p=runEnrichment([{artist:'TEST Lag',song:'Exact'}],{readRows:async()=>[],upsert:async()=>{},estimate:async(_s,_signal,emit)=>{calls++;aiStart=Date.now()-start;await new Promise(r=>setTimeout(r,3000));emit?.(0,{energy:8});await new Promise(r=>setTimeout(r,latency-3000));return [{energy:8,danceability:8}];}});
  await vi.advanceTimersByTimeAsync(17000);const out=await p;
  expect(aiStart).toBe(0);expect(calls).toBe(1);expect(out.results[0]).toMatchObject({energy:8,prov:{energy:'ai'},incomplete:true});
  if(latency<15000){expect(out.results[0].danceability).toBe(8);expect(out.status.timedOut).not.toContain('ai');}else{expect(out.results[0].danceability).toBeUndefined();expect(out.status.timedOut).toContain('ai');}
});

it('transient recommendation failure waits, retries once, then succeeds through actual handler',async()=>{
  vi.useFakeTimers();let sends=0;const times:number[]=[];
  const server=recommendHandler(async()=>{sends++;if(sends===1)throw Object.assign(new Error('synthetic transient'),{status:503});return {object:{suggestions:[]}};});
  const h=harness({rows:{A:structuredClone(base)},services:{recommend:(r:any)=>{if(r.data.section==='Warm Up')times.push(Date.now());return server.call(r);}}});await h.flush();const p=h.current.generate();await vi.advanceTimersByTimeAsync(100000);await p;await h.flush();
  expect(sends).toBeGreaterThanOrEqual(2);expect(times[1]-times[0]).toBeGreaterThanOrEqual(1000);expect(h.infos.some((s:string)=>s.includes('temporarily unavailable'))).toBe(true);h.unmount();
});

for(const boundary of ['event','account'] as const) for(const outcome of ['rejection','timeout','retry-wait'] as const) it(`actual route fences stale ${boundary} suggestion ${outcome} without late diagnostics, writes or retries`,async()=>{
  vi.useFakeTimers();let sends=0;
  const server=recommendHandler(async()=>{
    sends++;
    if(outcome==='timeout') return new Promise(()=>{});
    await new Promise(r=>setTimeout(r,outcome==='retry-wait'?100:2000));
    throw Object.assign(new Error('synthetic unavailable'),{status:503});
  });
  const h=harness({rows:{A:structuredClone(base),B:{...structuredClone(base),id:'B'}},contract:true,services:{recommend:server.call}});
  await h.flush();const pending=h.current.generate();await vi.advanceTimersByTimeAsync(outcome==='retry-wait'?200:1000);expect(sends).toBe(3);
  h.switchTo(boundary==='account'?'other':'owner',boundary==='event'?'B':'A');await h.flush();
  const before={result:JSON.stringify(h.current.result),writes:h.requests.length,infos:[...h.infos],errors:[...h.errors],warnings:[...h.warnings]};
  await vi.advanceTimersByTimeAsync(100000);await pending;await h.flush();
  expect(sends).toBe(3);expect(h.requests).toHaveLength(before.writes);expect(JSON.stringify(h.current.result)).toBe(before.result);
  expect(h.infos).toEqual(before.infos);expect(h.errors).toEqual(before.errors);expect(h.warnings).toEqual(before.warnings);h.unmount();
});

it('actual handler returns credit variant demonstrably outside max500 wire; local intended identity rejects it',async()=>{
  const tracks=Array.from({length:1800},(_,i)=>({artist:`TEST Indexed ${i}`,title:`Recording ${i}`,filePath:`/synthetic/wire/${i}.mp3`,year:'2005',bpm:'120',genre:'Pop',songLength:10}));
  const lib=vdj.buildLibrary(tracks);let wireChecks=0;let variant:any;
  const admitted=new AdditionKeySet();
  const observedHarness=require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({vdj,dance,audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions,observeRanking:(args:any[])=>{
    if(args[2].automaticExpansion)for(const p of args[0])admitted.add(p.row.artist,p.row.song);
  }});
  const server=recommendHandler(async()=>({object:{suggestions:[{...variant,energy:8,danceability:8,popularity:8,genre:'Pop',decade:'2000s'}]}}));
  const h=observedHarness({rows:{A:structuredClone(base)},services:{
    enrich:async({data}:any)=>({results:data.songs.map((s:any)=>({...s,energy:8,danceability:8,source:'ReccoBeats',prov:{energy:'provider',danceability:'provider'}}))}),
    recommend:async(request:any)=>{
      expect(request.data.existing.length).toBeLessThanOrEqual(500);
      const wire=new AdditionKeySet();for(const s of request.data.existing)wire.add(s.artist,s.song);
      const original=tracks.find(t=>admitted.has(t.artist,t.title)&&!wire.has(t.artist,t.title));expect(original).toBeDefined();if(!original)throw new Error('Missing synthetic candidate');
      variant={artist:`${original.artist} feat. TEST Guest`,song:original.title};
      expect(wire.has(variant.artist,variant.song)).toBe(false);expect(additionKeys(variant.artist,variant.song).some(k=>additionKeys(original.artist,original.title).includes(k))).toBe(true);
      wireChecks++;return server.call(request);
    }
  }});
  await h.flush();h.library(lib);await h.flush();await h.current.generate();await h.flush();expect(wireChecks).toBeGreaterThan(0);
  const additions=sections.flatMap(k=>h.current.result[k]).filter((s:any)=>!s.fromUpload);const intended=new AdditionKeySet();
  for(const s of additions)expect(intended.tryAdd(s.artist,s.song)).toBe(true);
  expect(additions.some((s:any)=>s.artist.includes('feat. TEST Guest'))).toBe(false);h.unmount();
});