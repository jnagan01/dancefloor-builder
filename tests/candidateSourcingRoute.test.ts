import {it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import * as eventTypes from '@/lib/eventTypes';
import * as addition from '@/lib/additionIdentity';
import * as vdj from '@/lib/virtualDj';import * as dance from '@/lib/danceFloor';import * as audio from '@/lib/audioMatch';import * as snapshots from '@/lib/snapshotSafety';import * as drafts from '@/lib/eventDrafts';import * as input from '@/lib/inputSafety';import * as autosave from '@/lib/eventAutosave';import * as vibes from '@/lib/vibes';import * as isolation from '@/lib/workflowIsolation';import * as theory from '@/lib/musicTheory';import * as revisions from '@/lib/eventRevision';
import {CATALOGUE,CLIENTS,PROVIDERS,INPUTS} from './fit/candidateStageFixture';
import {strictLimitFailure} from '@/lib/prep/provenance';
import {rowCandidate,expansionRankContext} from '@/lib/prep/expansionRanking';
import {rankPool} from '@/lib/prep/recommend';
const req=createRequire(import.meta.url),id='10000000-0000-4000-8000-000000000099';
const all=(r:any)=>[...r.warmUp,...r.transition,...r.peak];
const key=(r:any)=>`${r.artist}|${r.song}`;
function frozenDance(catalogue:typeof CATALOGUE){const m={exports:{} as typeof dance},ts=req('typescript');const imports:any={'@/lib/additionIdentity':addition,'@/lib/inputSafety':input,'@/lib/eventTypes':eventTypes,'@/lib/vibes':vibes,'@/lib/songLibrary':{SONG_LIBRARY:catalogue}};vm.runInNewContext(ts.transpileModule(readFileSync('tests/fit/archived/danceFloor.985f18cf.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:(k:string)=>imports[k]??req(k)});return m.exports;}
function factory(catalogue=CATALOGUE,baseline=false){return req('./helpers/eventRouteHarness.cjs').createEventRouteHarness({vdj,dance:baseline?frozenDance(catalogue):{...dance,catalogueCandidates:(i:any)=>dance.catalogueCandidates(i,catalogue)},audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions,songLibrary:{SONG_LIBRARY:catalogue},routeSource:baseline?readFileSync('tests/fit/archived/events.new.985f18cf.txt','utf8'):undefined});}
async function run(opts:{reverse?:boolean;baseline?:boolean;off?:boolean;neutral?:boolean;failure?:boolean;owned?:boolean;relaxed?:boolean}={}){
 const cat=opts.reverse?[...CATALOGUE].reverse():CATALOGUE,harness=factory(cat,opts.baseline),looked:any[]=[];
 const inputs={...INPUTS,expand:!opts.off,...(opts.neutral?{eventFit:undefined}:{}),...(opts.relaxed?{decades:[]}: {})};
 const row={id,name:inputs.eventName,updated_at:'2026-11-04T00:00:00Z',inputs,lists:{warmUp:CLIENTS.map(s=>({...s,fromUpload:true})),transition:[],peak:[]}};
 const h=harness({eventId:id,rows:{[id]:row},contract:true,services:{recommend:async()=>({suggestions:[]}),enrich:async({data}:any)=>{looked.push(...data.songs);if(opts.failure)throw Error('controlled provider outage');return {results:PROVIDERS.filter(p=>data.songs.some((s:any)=>key(s)===key(p)))};},community:async({data}:any)=>data.songs.map((s:any)=>({...s,status:'disabled'}))}});
 vi.useFakeTimers();try{await h.flush();if(opts.owned){const c=CATALOGUE[29];h.library(vdj.buildLibrary([{artist:c.artist,title:c.song,filePath:'/synthetic/exact.mp3',genre:'Funk'}] as vdj.VdjTrack[]));await h.flush();}await h.current.generate();await h.flush();const result=h.current.result;await vi.advanceTimersByTimeAsync(1600);await h.flush();const saved=h.requests.at(-1);h.unmount();const reopen=harness({eventId:id,rows:{[id]:{...row,inputs:saved.inputs,lists:saved.lists}},contract:true});await reopen.flush();expect(all(reopen.current.result)).toEqual(all(result));expect(reopen.requests).toEqual([]);reopen.unmount();return {result,saved,looked,warnings:h.warnings};}finally{vi.useRealTimers();h.unmount();}}
it('actual route: >14 alternatives compete for 14 unchanged slots; evidence beyond old cut displaces weak picks; requests/save/reopen preserved',async()=>{
 const after=await run(),reverse=await run({reverse:true}),before=await run({baseline:true});
 const adds=all(after.result).filter(r=>!r.fromUpload),old=all(before.result).filter(r=>!r.fromUpload);
 expect(adds).toHaveLength(14);expect(after.looked.filter(s=>CATALOGUE.some(c=>key(c)===key(s)))).toHaveLength(30);
 expect(adds.map(key).sort()).toEqual(all(reverse.result).filter(r=>!r.fromUpload).map(key).sort());
 // Existing shared scorer's variety keeps two weaker alternatives; this change does not tune scores or assert perfection.
 expect(adds.filter(r=>PROVIDERS.find(p=>key(p)===key(r))?.popularity===9)).toHaveLength(12);expect(old).toHaveLength(0); // old cut discards decade; strict policy rejects it
 expect(all(after.result).filter(r=>r.fromUpload).map(key).sort()).toEqual(CLIENTS.map(key).sort());
 expect(adds.some(r=>r.song==='Recording 29')).toBe(true);expect(adds.every(r=>r.catalogueDecade==='1980s'&&r.year===undefined)).toBe(true);
 const ctx=expansionRankContext({knowledge:null,eventId:null,requests:CLIENTS,rows:CLIENTS,preferences:{decades:['1980s'],fit:{avoidSlow:true,familiarity:'familiar'}}});
 const diagnostic=(legacy:boolean)=>{const candidates=legacy?CATALOGUE.slice(0,8).map(s=>({artist:s.artist,song:s.song,energy:s.energy,danceability:s.danceability,metaProv:{energy:'catalogue',danceability:'catalogue'}})):dance.catalogueCandidates({uploaded:CLIENTS,prefs:{artists:[],genres:[],decades:['1980s'],notes:''},expand:true},CATALOGUE).map(c=>c.row);const enriched=candidates.map(c=>({...c,...PROVIDERS.find(p=>key(p)===key(c)),metaProv:{...c.metaProv,...PROVIDERS.find(p=>key(p)===key(c))?.prov}}));const eligible=enriched.filter(c=>!strictLimitFailure(c,{decades:['1980s']}));return {beforeTruncation:30,afterSourcing:candidates.length,afterPolicy:eligible.length,ranking:rankPool(eligible,c=>rowCandidate(c,'catalogue'),ctx).map(x=>({key:key(x.item),score:x.rec.score,reasons:x.rec.evidence,missingFacts:['year','bpm','community']})),selected:all((legacy?before:after).result).filter(r=>!r.fromUpload).map(r=>({key:key(r),reasons:r.rankWhy,prov:r.metaProv})),sourceContribution:{catalogue:eligible.length,ai:0,owned:0}};};
 const report={label:'CONTROLLED FICTIONAL fixture, real event route and save validator. NOT original native pool/replay; no ratings or claimed real quality gains.',sourceCommit:'985f18cf4a204381f597883299d1ab1f9aa05b28',targetCommit:'content-addressed patch; final automatic revision reported separately',targetSourceHash:createHash('sha256').update(readFileSync('src/routes/_authenticated/events.new.tsx')).digest('hex'),fixture:{clients:CLIENTS,catalogue:CATALOGUE,providers:PROVIDERS,inputs:INPUTS,community:'disabled',recommendations:[],library:[]},before:diagnostic(true),after:diagnostic(false)};
 mkdirSync('test-results',{recursive:true});writeFileSync('test-results/candidate-stage.json',JSON.stringify(report,null,2));
},30000);
it('actual route: provider failure retains catalogue provenance, owned promotion keeps file tags, expand-off retains requests and neutral does not infer fit',async()=>{
 const failed=await run({failure:true});expect(all(failed.result).filter(r=>!r.fromUpload)).toHaveLength(14);expect(failed.warnings.join(' ')).toMatch(/Couldn't reach/);
 const owned=await run({owned:true});expect(all(owned.result).find(r=>r.song==='Recording 29')).toMatchObject({genre:'Funk',catalogueDecade:'1980s',metaProv:{genre:'tags',energy:'provider'}});
 const off=await run({off:true});expect(all(off.result)).toHaveLength(10);expect(off.looked).toHaveLength(10);
 const neutral=await run({neutral:true});expect(neutral.saved.inputs.eventFit).toBeUndefined();expect(all(neutral.result).filter(r=>!r.fromUpload)).toHaveLength(14);expect(all(neutral.result).some(r=>/dance suitability uncertain/.test(r.rankWhy??''))).toBe(false);
},30000);
