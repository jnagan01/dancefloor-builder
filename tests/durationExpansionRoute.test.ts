import { it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import * as vdj from '@/lib/virtualDj'; import * as dance from '@/lib/danceFloor'; import * as audio from '@/lib/audioMatch'; import * as snapshots from '@/lib/snapshotSafety'; import * as drafts from '@/lib/eventDrafts'; import * as input from '@/lib/inputSafety'; import * as autosave from '@/lib/eventAutosave'; import * as vibes from '@/lib/vibes'; import * as isolation from '@/lib/workflowIsolation'; import * as theory from '@/lib/musicTheory'; import * as revisions from '@/lib/eventRevision';
import { exportReadiness } from '@/lib/exportReadiness';
const req=createRequire(import.meta.url), id='10000000-0000-4000-8000-000000000088';
const sections=['warmUp','transition','peak'] as const;
const clients=Array.from({length:10},(_,i)=>({artist:`Client ${i}`,song:`Request ${i}`}));
const word=(i:number)=>String.fromCharCode(97+Math.floor(i/26))+String.fromCharCode(97+i%26);
const tracks=(length=120)=>Array.from({length:320},(_,i)=>({artist:`Performer${word(i)}`,title:`Recording${word(i)}`,filePath:`/synthetic/${i}.mp3`,bpm:'120',year:'2005',genre:'Pop',songLength:length}));
const provider=(songs:any[])=>({results:songs.map(s=>({...s,bpm:120,year:2005,energy:8,danceability:8,source:'ReccoBeats',prov:{bpm:'provider',year:'provider',energy:'provider',danceability:'provider'}}))});
const harness=req('./helpers/eventRouteHarness.cjs').createEventRouteHarness({vdj,dance,audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions});
function seconds(h:any){return sections.map(section=>exportReadiness(h.current.result[section].map((song:any,i:number)=>({song,match:h.current.matches[`${section}:${i}:${dance.dedupeKey(song.artist,song.song)}`]})),h.lib).knownSec);}
async function generateBounded(h:any){
 const fake=vi.isFakeTimers(); if(!fake)vi.useFakeTimers();
 try{let settled=false;const work=h.current.generate().finally(()=>{settled=true;});for(let tick=0;tick<120&&!settled;tick++)await vi.advanceTimersByTimeAsync(1000);expect(settled,'actual route must terminate within 120 seconds').toBe(true);await work;}finally{if(!fake)vi.useRealTimers();}
}
async function setup(opts:any={}){
 const inputs={songs:clients,hours:'3.75',buffer:opts.buffer??2,listType:opts.background?'dinner':'dance',minutes:'60',expand:!opts.off,eventName:'TEST ONLY duration',split:opts.background?undefined:{warmUp:45,transition:120,peak:60},artistsInput:(opts.artists??[]).join(', '),decades:['2000s'],bpmRange:[110,130],danceRange:[6,10],eventFit:{avoidSlow:true},requireCleanVersions:false,ownedOnlyExpansion:false,includeSeasonalTracks:false};
 const lists={warmUp:clients.map(s=>({...s,fromUpload:true})),transition:[],peak:[],selections:opts.selections??{}};
 const h=harness({eventId:id,rows:{[id]:{id,name:inputs.eventName,updated_at:'2026-11-12T00:00:00Z',inputs,lists}},contract:true,services:{enrich:opts.enrich??(async({data}:any)=>provider(data.songs)),recommend:opts.recommend??(async()=>({suggestions:[]}))}});
 await h.flush();h.lib=vdj.buildLibrary(opts.tracks??tracks());h.library(h.lib);await h.flush();return {h,inputs,lists};
}
it('actual route 45/120/60 at 2x fills 90/240/120 individually with short files beyond old counts, save/reopen unchanged',async()=>{
 vi.useFakeTimers();try{const {h,inputs}=await setup();const before=seconds(h);expect(h.requests).toEqual([]);await generateBounded(h);await h.flush();const after=seconds(h);expect(after).toEqual([5400,14400,7200]);expect(h.current.result.warmUp.length).toBeGreaterThan(23);expect(h.current.result.transition.length).toBeGreaterThan(60);expect(h.current.result.peak.length).toBeGreaterThan(30);expect(sections.flatMap(k=>h.current.result[k]).filter(s=>s.fromUpload)).toHaveLength(10);
 await vi.advanceTimersByTimeAsync(1800);await h.flush();expect(h.errors).toEqual([]);const saved=h.requests.at(-1);expect(saved).toBeDefined();const reopen=harness({eventId:id,rows:{[id]:{id,inputs:saved.inputs,lists:saved.lists}},contract:true});await reopen.flush();reopen.library(h.lib);await reopen.flush();expect(reopen.current.eventSnapshot(reopen.current.result,reopen.current.matches).lists).toEqual(saved.lists);expect(reopen.requests).toEqual([]);
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/duration-expansion.json',JSON.stringify({label:'SYNTHETIC actual route, not user wedding replay',observedUserSeconds:[3241,7787,3061],fixtureBeforeSeconds:before,fixtureAfterSeconds:after,targetsSeconds:[5400,14400,7200],rows:sections.map(k=>h.current.result[k].length),inputs},null,2));reopen.unmount();h.unmount();}finally{vi.useRealTimers();}
},30000);
it('actual route rejects metadata, replenishes with later provider candidates, bounded empty pool reports shortage',async()=>{
 let calls=0;const rejected=tracks().map(t=>({...t,bpm:'180'}));
 const {h}=await setup({tracks:rejected,recommend:async({data}:any)=>{calls++;return {suggestions:Array.from({length:data.count},(_,i)=>({artist:`Provider ${calls} ${i}`,song:`Recording ${calls} ${i}`,energy:8,danceability:8,reason:'synthetic'}))};}});await generateBounded(h);await h.flush();expect(calls).toBeGreaterThan(3);expect(sections.flatMap(k=>h.current.result[k]).some(s=>s.artist.startsWith('Synthetic'))).toBe(false);expect(seconds(h)).toEqual([0,0,0]);expect(h.warnings.join(' ')).toMatch(/Preparation is short/);expect(calls).toBeLessThanOrEqual(24);h.unmount();
},30000);
it.each([1,2])('actual route %ix, section imbalance never covers another section',async(buffer)=>{const {h}=await setup({buffer});await generateBounded(h);await h.flush();expect(seconds(h)).toEqual([buffer===1?2760:5400,7200*buffer,3600*buffer]);h.unmount();},30000);
it('actual route background fills one continuous duration; expansion-off preserves client rows only',async()=>{const bg=await setup({background:true});await generateBounded(bg.h);await bg.h.flush();expect(seconds(bg.h)).toEqual([3600,0,0]);bg.h.unmount();const off=await setup({off:true});await generateBounded(off.h);await off.h.flush();expect(sections.flatMap(k=>off.h.current.result[k])).toHaveLength(10);off.h.unmount();},30000);
it('actual route passive saved exclusions/empty/manual paths survive unrelated save without regeneration',async()=>{vi.useFakeTimers();try{const selections={'warmUp:0:client 0|request 0':{paths:[],confirmed:false},'warmUp:1:client 1|request 1':{paths:['/synthetic/missing.mp3','/synthetic/2.mp3'],confirmed:true,excluded:true}};const {h}=await setup({selections});await vi.advanceTimersByTimeAsync(2000);expect(h.requests).toEqual([]);h.edit('unrelated name');await vi.advanceTimersByTimeAsync(1800);await h.flush();expect(h.requests.at(-1).lists.selections).toEqual(selections);h.unmount();}finally{vi.useRealTimers();}});
it('actual route metadata-rejected first suggestions are replaced by later exact known files, not counted as coverage',async()=>{
 const tt=tracks(120);let calls=0;
 const {h}=await setup({tracks:tt,recommend:async({data}:any)=>{calls++;return {suggestions:tt.slice(calls<=3?0:60,calls<=3?data.count:60+data.count).map(t=>({artist:t.artist,song:t.title,energy:8,danceability:8,reason:'synthetic replacement'}))};}});
 // Owned candidates arrive up-front; rejected initial metadata must not spend duration slots.
 const reject=tt.slice(0,60);reject.forEach(t=>t.bpm='180');h.lib=vdj.buildLibrary(tt);h.library(h.lib);await h.flush();
 await generateBounded(h);await h.flush();expect(seconds(h)).toEqual([5400,14400,7200]);expect(sections.flatMap(k=>h.current.result[k]).some(s=>reject.some(t=>t.artist===s.artist))).toBe(false);h.unmount();
},30000);
it('actual route hung suggestion provider terminates at bounded waits and never claims duration coverage',async()=>{vi.useFakeTimers();try{const sent:Record<string,number>={};const {h}=await setup({tracks:[],recommend:({data}:any)=>{sent[data.section]=(sent[data.section]??0)+1;return new Promise(()=>{});}});const generating=h.current.generate();
 // Coordinated deadlines: each lane waits its server deadline plus transport margin, at most two timeouts per lane, within the fixed repair window.
 await vi.advanceTimersByTimeAsync(120000);await generating;await h.flush();expect(Object.values(sent).every(n=>n>=1&&n<=2)).toBe(true);expect(seconds(h)).toEqual([0,0,0]);expect(h.warnings.join(' ')).toMatch(/Preparation is short/);h.unmount();}finally{vi.useRealTimers();}},30000);
it.each(['empty','duplicates'])('actual route %s favourite response still runs general usable-file sourcing',async(mode)=>{
 const tt=tracks(120).map(t=>({...t,bpm:''}));let general=0,favourites=0;
 // Use tags with unknown BPM, upgraded by the real enrichment pass only for AI offers.
 let calls=0;
 const s=await setup({tracks:tt,artists:['Client 0'],enrich:async({data}:any)=>provider(data.songs),recommend:async({data}:any)=>{
  if(data.onlyArtists){favourites++;return {suggestions:mode==='empty'?[]:[{artist:'Client 0',song:'Request 0',energy:8,danceability:8}]};}
  general++;const offset=calls;calls+=data.count;return {suggestions:tt.slice(offset,offset+data.count).map(t=>({artist:t.artist,song:t.title,energy:8,danceability:8}))};
 }});
 await generateBounded(s.h);await s.h.flush();expect(favourites).toBeGreaterThan(0);expect(general).toBeGreaterThan(0);expect(seconds(s.h)).toEqual([5400,14400,7200]);s.h.unmount();
},30000);
it('actual route >2000 unsuitable owned rows cannot crowd out later usable files, reversed input selects same identities',async()=>{
 const unsuitable=Array.from({length:2200},(_,i)=>({artist:`A bad ${i}`,title:`Bad ${i}`,filePath:`/synthetic/bad/${i}.mp3`,bpm:i%3===0?'180':i%3===1?'':'120',year:'2005',songLength:0}));
 const known=tracks(120);const lib=[...unsuitable,...known];const results=[];
 for(const tt of [lib,[...lib].reverse()]){const {h}=await setup({tracks:tt});await generateBounded(h);await h.flush();expect(seconds(h)).toEqual([5400,14400,7200]);results.push(sections.map(k=>h.current.result[k].map(s=>`${s.artist}|${s.song}`)));h.unmount();}
 expect(results[1]).toEqual(results[0]);
},30000);
it('actual route saturated usable library reserves AI metadata and capacity after verified dance rejection',async()=>{
 const saturated=Array.from({length:2200},(_,i)=>({artist:`A crowded ${i}`,title:`Crowded ${i}`,filePath:`/synthetic/crowded/${i}.mp3`,bpm:'120',year:'2005',songLength:1}));
 const supply=tracks(120).map(t=>({...t,bpm:''}));let calls=0;const looked=new Set<string>();
 const {h}=await setup({tracks:[...saturated,...supply],enrich:async({data}:any)=>{data.songs.forEach((s:any)=>looked.add(`${s.artist}|${s.song}`));return {results:provider(data.songs).results.map((s:any)=>s.artist.startsWith('A crowded')?{...s,danceability:2}:s)};},recommend:async({data}:any)=>{const offset=calls;calls+=data.count;return {suggestions:supply.slice(offset,offset+data.count).map(t=>({artist:t.artist,song:t.title,energy:8,danceability:8}))};}});
 await generateBounded(h);await h.flush();expect(calls).toBeGreaterThan(0);expect(looked.has(`${supply[0].artist}|${supply[0].title}`)).toBe(true);expect(looked.size).toBeLessThanOrEqual(610);seconds(h).forEach((s,i)=>{expect(s).toBeGreaterThanOrEqual([5400,14400,7200][i]);expect(s).toBeLessThan([5400,14400,7200][i]+120);});h.unmount();
},30000);
it('actual route sparse unsupported danceability stays an honest gap with avoidSlow, strict BPM/decade unchanged',async()=>{
 const good=tracks(120), bad=tracks().slice(0,20).map((t,i)=>({...t,artist:`Bad strict ${i}`,year:i%2?'1995':'2005',bpm:i%2?'120':'180'}));
 const {h}=await setup({tracks:[...bad,...good],enrich:async({data}:any)=>({results:data.songs.map((s:any)=>({...s,energy:8,danceability:s.artist.endsWith('a')?3:undefined,source:'AI',prov:{energy:'ai',danceability:'ai'}}))})});
 await generateBounded(h);await h.flush();expect(seconds(h)).toEqual([0,0,0]);expect(sections.flatMap(k=>h.current.result[k]).some(s=>s.artist.startsWith('Bad strict'))).toBe(false);expect(h.warnings.join(' ')).toMatch(/Preparation is short/);expect(sections.flatMap(k=>h.current.result[k]).filter(s=>s.fromUpload)).toHaveLength(10);h.unmount();
},30000);
it('actual route varied-energy files retain warm-up, transition and peak roles after duration allocation',async()=>{
 const tt=tracks(120).slice(0,240);const energy=new Map(tt.map((t,i)=>[t.artist,i<50?6:i<175?8:9]));
 const {h}=await setup({tracks:tt,enrich:async({data}:any)=>({results:provider(data.songs).results.map((s:any)=>({...s,energy:energy.get(s.artist)??8}))})});
 await generateBounded(h);await h.flush();expect(seconds(h)).toEqual([5400,14400,7200]);for(const [i,k] of sections.entries())expect(h.current.result[k].filter(s=>!s.fromUpload).every(s=>s.energy===[6,8,9][i])).toBe(true);h.unmount();
},30000);
it('actual route Mac optional-expansion regression: forty 240-second clients at 1h/1x stay forty, all sections covered, no warnings, passive membership unchanged',async()=>{
 vi.useFakeTimers();try{
 const cc=Array.from({length:40},(_,i)=>({artist:`Client ${i}`,song:`Normal track ${i}`}));
 const inputs={songs:cc,hours:'1',buffer:1,listType:'dance',expand:true,eventName:'Covered expansion 1×'};
 const lists={warmUp:cc.map(s=>({...s,fromUpload:true})),transition:[],peak:[]};
 let recommendCalls=0;
 const h=harness({eventId:id,rows:{[id]:{id,inputs,lists}},contract:true,services:{enrich:async()=>({results:[]}),recommend:async()=>{recommendCalls++;return {suggestions:[]};}}});
 await h.flush();h.lib=vdj.buildLibrary(cc.map((s,i)=>({artist:s.artist,title:s.song,filePath:`/synthetic/client-${i}.mp3`,songLength:240})));h.library(h.lib);await h.flush();
 expect(h.current.result.warmUp).toHaveLength(40);expect(h.current.result.transition).toEqual([]);expect(h.requests).toEqual([]);
 await generateBounded(h);await h.flush();expect(sections.flatMap(k=>h.current.result[k])).toHaveLength(40);expect(seconds(h)).toEqual([3120,3360,3120]);expect(h.warnings).toEqual([]);expect(recommendCalls).toBe(0);
 expect(sections.flatMap(k=>h.current.result[k]).map(s=>`${s.artist}|${s.song}`).sort()).toEqual(cc.map(s=>`${s.artist}|${s.song}`).sort());
 await vi.advanceTimersByTimeAsync(1800);await h.flush();const saved=h.requests.at(-1);expect(saved.inputs.songs).toEqual(cc);
 const reopened=harness({eventId:id,rows:{[id]:{id,inputs:saved.inputs,lists:saved.lists}},contract:true});await reopened.flush();reopened.library(h.lib);await reopened.flush();expect(reopened.current.eventSnapshot(reopened.current.result,reopened.current.matches).lists).toEqual(saved.lists);expect(reopened.requests).toEqual([]);reopened.unmount();h.unmount();
 }finally{vi.useRealTimers();}
},30000);
