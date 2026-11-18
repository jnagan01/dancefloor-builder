import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj';import * as dance from '@/lib/danceFloor';import * as audio from '@/lib/audioMatch';import * as snapshots from '@/lib/snapshotSafety';import * as drafts from '@/lib/eventDrafts';import * as input from '@/lib/inputSafety';import * as autosave from '@/lib/eventAutosave';import * as vibes from '@/lib/vibes';import * as isolation from '@/lib/workflowIsolation';import * as theory from '@/lib/musicTheory';import * as revisions from '@/lib/eventRevision';
import { exportReadiness } from '@/lib/exportReadiness';import { reuseMetadata } from '@/lib/songInformation/client';
import { localInformation } from '@/lib/songInformation/local';
const require=createRequire(import.meta.url);
const actual={vdj,dance,audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('actual route repeat uses local durable facts with unchanged section coverage, requests and selected identity',async()=>{
 vi.useFakeTimers();vi.stubGlobal('indexedDB',{});
 // Minimal isolated IndexedDB-shaped storage used through the real local coordinator is tested separately in Electron.
 const local=localInformation(); const memory=new Map();
 const read=vi.spyOn(local,'read').mockImplementation(async(a,k)=>({entry:memory.get(a+':'+k)??null,failed:false}));
 const write=vi.spyOn(local,'write').mockImplementation(async(a,e,current)=>{if(!current())return false;memory.set(a+':'+e.key,e);return true;});
 const hfactory=require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({...actual,songInformation:{reuseMetadata}});
 const clients=Array.from({length:34},(_,i)=>({artist:`TEST Client ${i}`,song:`Request ${i}`}));
 const files=Array.from({length:40},(_,i)=>({artist:`Z Reuse ${i}`,title:`Floor ${i}`,filePath:`/synthetic/reuse/${i}.mp3`,year:'2005',bpm:'120',genre:'Pop',songLength:900}));
 const lib=vdj.buildLibrary(files),base={id:'A',inputs:{songs:clients,hours:'3.75',buffer:2,listType:'dance',expand:true,split:{warmUp:45,transition:120,peak:60},genresInput:'Pop',decades:['2000s'],bpmRange:[110,130],danceRange:[6,10],eventFit:{avoidSlow:true,familiarity:'familiar'}},lists:{warmUp:clients.map(s=>({...s,fromUpload:true})),transition:[],peak:[],selections:{}}};
 const original=JSON.stringify(base);let checks=0;
 const service=async({data}:any)=>{checks+=data.songs.length;return {results:data.songs.map((s:any)=>({...s,source:'ReccoBeats',energy:8,danceability:8,popularity:8,bpm:120,year:2005,prov:{energy:'provider',danceability:'provider',popularity:'provider',bpm:'provider',year:'provider'}})),status:{complete:true,timedOut:[]}};};
 const results=[];
 for(let n=0;n<2;n++){
  const h=hfactory({rows:{A:structuredClone(base)},services:{enrich:service}});await h.flush();h.library(lib);await h.flush();const p=h.current.generate();await vi.advanceTimersByTimeAsync(125000);await p;await h.flush();
  const seconds=['warmUp','transition','peak'].map(k=>exportReadiness(h.current.result[k].map((song:any,i:number)=>({song,match:h.current.matches[`${k}:${i}:${dance.dedupeKey(song.artist,song.song)}`]})),lib).knownSec);
  expect(seconds).toEqual([5400,14400,7200]);results.push(['warmUp','transition','peak'].map(k=>h.current.result[k].map((s:any)=>[s.artist,s.song,s.energy])));
  expect(JSON.stringify(base)).toBe(original);expect(h.requests).toEqual([]);h.unmount();
  if(n===0)expect(checks).toBe(74);
 }
 expect(checks).toBe(74);expect(results[1]).toEqual(results[0]);console.info('SYNTHETIC repeat metadata requested track checks (not HTTP requests): 74 -> 0; section seconds 5400/14400/7200 unchanged');read.mockRestore();write.mockRestore();
},30000);
