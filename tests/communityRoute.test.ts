import { it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import * as vdj from "@/lib/virtualDj";
import * as dance from "@/lib/danceFloor";
import * as audio from "@/lib/audioMatch";
import * as snapshots from "@/lib/snapshotSafety";
import * as drafts from "@/lib/eventDrafts";
import * as input from "@/lib/inputSafety";
import * as autosave from "@/lib/eventAutosave";
import * as vibes from "@/lib/vibes";
import * as isolation from "@/lib/workflowIsolation";
import * as theory from "@/lib/musicTheory";
import * as revisions from "@/lib/eventRevision";
import { REQUESTS } from "./fit/fitComparison";
// Isolate community propagation from catalogue competition; complete catalogue coverage has its own route regressions.
const harness = createRequire(import.meta.url)("./helpers/eventRouteHarness.cjs").createEventRouteHarness({vdj,dance:{...dance,catalogueCandidates:()=>[]},audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions});
const id="10000000-0000-4000-8000-000000000077";
const requests=REQUESTS.map(r=>({...r,fromUpload:true}));
// TEST-ONLY renamed synthetic owned files with identical estimated feel; only community evidence differs.
const extras=[["Held Out Tagged","Q"],["Held Out Plain","R"],["Held Out Wrong","S"]].map(([a,s])=>({artist:`TEST ${a}`,song:s}));
const library=vdj.buildLibrary(extras.map(c=>({artist:c.artist,title:c.song,filePath:`/synthetic/${c.song}.mp3`,year:"1985",genre:"Pop"})) as vdj.VdjTrack[]);
const inputBase={songs:requests,hours:"1.5",buffer:1,listType:"dance",expand:true,eventName:"TEST ONLY community",artistsInput:"",genresInput:"",decades:["1970s","1980s","1990s","2000s","2010s","2020s"],notes:"",doNotPlayInput:""};
const all=(r:any)=>[...r.warmUp,...r.transition,...r.peak];
const enrich=async({data}:any)=>({results:data.songs.flatMap((s:any)=>extras.some(c=>c.artist===s.artist)?[{...s,energy:6,danceability:6,source:"AI",prov:{energy:"estimate",danceability:"estimate"}}]:[])});
async function run(fit:any, community:any){
  const row={id,name:inputBase.eventName,updated_at:"2026-11-04T00:00:00Z",inputs:{...inputBase,...(fit?{eventFit:fit}:{})},lists:{warmUp:requests,transition:[],peak:[]}};
  const calls:any[]=[];
  const services={recommend:async()=>({suggestions:[]}),enrich,similarTracks:async()=>({availability:"ok",seeds:REQUESTS.slice(0,1).map(s=>({seed:{artist:s.artist,title:s.song},status:"ok",similar:extras.map(c=>({artist:c.artist,title:c.song,match:1}))}))}),community:async(r:any)=>{calls.push(r.data.songs);return community(r);}};
  vi.useFakeTimers();
  try{
    const h=harness({eventId:id,rows:{[id]:row},services,contract:true});await h.flush();h.library(library);await h.flush();await h.current.generate();await h.flush();
    const result=all(h.current.result);
    await vi.advanceTimersByTimeAsync(1500);await h.flush();
    const saved=h.requests.at(-1);h.unmount();
    return {result,saved,calls,infos:h.infos,row};
  }finally{vi.useRealTimers();}
}
const tagged=async(r:any)=>r.data.songs.map((s:any)=>s.artist==="TEST Held Out Tagged"?{...s,status:"found",evidence:{source:"lastfm",listeners:90000,slowTags:["ballad"],upbeatTags:[]}}:{...s,status:"none"});
it("community slow tags reach rankPool before ranking, stay out of the snapshot, and requests survive save/reopen",async()=>{
  const {result,saved,calls,row}=await run({avoidSlow:true},tagged);
  expect(result.filter((r:any)=>r.fromUpload).map((r:any)=>`${r.artist}|${r.song}`).sort()).toEqual(REQUESTS.map(r=>`${r.artist}|${r.song}`).sort());
  const adds=result.filter((r:any)=>!r.fromUpload).map((r:any)=>r.artist);
  expect(adds.indexOf("TEST Held Out Tagged")).toBeGreaterThan(adds.indexOf("TEST Held Out Plain"));
  expect(result.find((r:any)=>r.artist==="TEST Held Out Tagged")?.rankWhy).toMatch(/community tags "ballad".*not confirmed slow/);
  expect(calls.flat().length).toBe(new Set(calls.flat().map((s:any)=>`${s.artist}||${s.song}`)).size);
  expect(JSON.stringify(saved.lists)).not.toMatch(/"community"|slowTags/);
  const t=result.find((r:any)=>r.artist==="TEST Held Out Tagged");expect([t.energy,t.danceability]).toEqual([6,6]);
  const reopened=harness({eventId:id,rows:{[id]:{...row,inputs:saved.inputs,lists:saved.lists}},contract:true});await reopened.flush();
  expect(all(reopened.current.result).filter((r:any)=>r.fromUpload)).toHaveLength(REQUESTS.length);expect(reopened.requests).toEqual([]);reopened.unmount();
});
it("no fit choices: no community lookups at all (legacy/neutral)",async()=>{
  const {calls}=await run(undefined,tagged);expect(calls).toEqual([]);
});
it("provider failure: candidates stay, evidence unknown, honest notice",async()=>{
  const {result,infos}=await run({avoidSlow:true},async()=>{throw Error("down");});
  expect(result.filter((r:any)=>!r.fromUpload).map((r:any)=>r.artist)).toEqual(expect.arrayContaining(["TEST Held Out Tagged","TEST Held Out Plain"]));
  expect(infos.join(" ")).toMatch(/community tags couldn.t be checked for 3 candidate tracks/);
  expect(result.find((r:any)=>r.artist==="TEST Held Out Tagged")?.rankWhy ?? "").not.toMatch(/community tags "/);
});
it("discovery-only: no community lookups (they could not change the ranking)",async()=>{
  const {calls}=await run({familiarity:"discovery"},tagged);expect(calls).toEqual([]);
});
it("provider disabled: truthful notice limited to community evidence; other facts kept",async()=>{
  const {result,infos}=await run({avoidSlow:true},async(r:any)=>r.data.songs.map((s:any)=>({...s,status:"disabled"})));
  expect(infos.join(" ")).toMatch(/Last\.fm isn't available, so community tags and listener counts weren't checked for 3 candidate tracks\. Only that community evidence is unknown/);
  const t=result.find((r:any)=>r.artist==="TEST Held Out Tagged");expect([t.energy,t.danceability]).toEqual([6,6]);
});
it("budget: at most 40 distinct lookups, preliminary-rank priority, unattempted eligible tracks reported once",async()=>{
  const many=Array.from({length:45},(_,i)=>({artist:`TEST Bulk ${String(i).padStart(2,"0")}`,song:`T${i}`}));
  const lib=vdj.buildLibrary(many.map(c=>({artist:c.artist,title:c.song,filePath:`/synthetic/bulk/${c.song}.mp3`,year:"1985",genre:"Pop"})) as vdj.VdjTrack[]);
  const row={id,name:inputBase.eventName,updated_at:"2026-11-04T00:00:00Z",inputs:{...inputBase,eventFit:{avoidSlow:true}},lists:{warmUp:requests,transition:[],peak:[]}};
  const calls:any[]=[];
  // T44 gets the strongest exact-track similarity, so the preliminary shared ranking must spend budget on it first.
  const services={recommend:async()=>({suggestions:[]}),enrich:async()=>({results:[]}),similarTracks:async()=>({availability:"ok",seeds:REQUESTS.slice(0,1).map(s=>({seed:{artist:s.artist,title:s.song},status:"ok",similar:many.map(c=>({artist:c.artist,title:c.song,match:c.song==="T44"?1:0.2}))}))}),community:async(r:any)=>{calls.push(...r.data.songs);return r.data.songs.map((s:any)=>({...s,status:"none"}));}};
  vi.useFakeTimers();
  try{
    const h=harness({eventId:id,rows:{[id]:row},services,contract:true});await h.flush();h.library(lib);await h.flush();await h.current.generate();await h.flush();
    expect(calls.length).toBe(40);expect(new Set(calls.map((s:any)=>`${s.artist}||${s.song}`)).size).toBe(40);
    expect(calls[0]).toEqual({artist:"TEST Bulk 44",song:"T44"});
    const notice=h.infos.filter((m:string)=>/per-run limit of 40/.test(m));expect(notice).toHaveLength(1);
    const n=Number(notice[0].match(/^(\d+)/)[1]);expect(n).toBeGreaterThanOrEqual(5);
    h.unmount();
  }finally{vi.useRealTimers();}
});
// TEST-ONLY renamed synthetic files: "Weak" has identical-request similarity (match 1) but estimated 6/6 feel; "Up" has
// weaker similarity and estimated upbeat 8/8. Only the new uncertain-dance bound and community evidence differ.
const ud=[["TEST UD Weak","W1",6,6,1],["TEST UD Up","U1",8,8,0.8]] as const;
const udLib=vdj.buildLibrary(ud.map(([a,s])=>({artist:a,title:s,filePath:`/synthetic/ud/${s}.mp3`,year:"2006",genre:"Pop"})) as vdj.VdjTrack[]);
const late=async<T>(v:T)=>{for(let i=0;i<40;i++)await Promise.resolve();return v;};
async function runUD(community:any){
  const row={id,name:inputBase.eventName,updated_at:"2026-11-04T00:00:00Z",inputs:{...inputBase,eventFit:{avoidSlow:true}},lists:{warmUp:requests,transition:[],peak:[]}};
  const calls:any[]=[];
  const services={recommend:async()=>({suggestions:[]}),
    enrich:async({data}:any)=>({results:data.songs.flatMap((s:any)=>{const u=ud.find(x=>x[0]===s.artist);return u?[{...s,energy:u[2],danceability:u[3],source:"AI",prov:{energy:"estimate",danceability:"estimate"}}]:[];})}),
    similarTracks:async()=>({availability:"ok",seeds:REQUESTS.slice(0,1).map(s=>({seed:{artist:s.artist,title:s.song},status:"ok",similar:ud.map(([a,t,,,m])=>({artist:a,title:t,match:m}))}))}),
    community:async(r:any)=>{calls.push(...r.data.songs);return community(r);}};
  vi.useFakeTimers();
  try{
    const h=harness({eventId:id,rows:{[id]:row},services,contract:true});await h.flush();h.library(udLib);await h.flush();await h.current.generate();await h.flush();
    const result=all(h.current.result);await vi.advanceTimersByTimeAsync(1500);await h.flush();
    const saved=h.requests.at(-1);h.unmount();return {result,saved,calls,row};
  }finally{vi.useRealTimers();}
}
const ud1=(res:any[],a:string)=>res.find((r:any)=>r.artist===a);
it("uncertain dance bound: lookup fetches the relevant uncertain track, final rank applies the bound; save/reopen keeps explanation and requests, no new fields",async()=>{
  const {result,saved,calls,row}=await runUD(async(r:any)=>late(r.data.songs.map((s:any)=>({...s,status:"none"}))));
  expect(calls.map((s:any)=>s.artist)).toContain("TEST UD Weak");
  const w=ud1(result,"TEST UD Weak");expect(w.rankWhy).toMatch(/similarity bounded: dance suitability uncertain/);
  // Set order is energy-flow, not rank order: assert the bound itself (Weak bounded, upbeat Up not).
  expect(ud1(result,"TEST UD Up").rankWhy).not.toMatch(/dance suitability uncertain/);
  expect(result.filter((r:any)=>r.fromUpload)).toHaveLength(REQUESTS.length);
  expect(JSON.stringify(saved)).not.toMatch(/lookupPriority|similarityCap|"community"|upbeatTags/);
  expect(Object.keys(saved.inputs).sort()).toEqual(Object.keys({...row.inputs,...saved.inputs}).sort());
  const reopened=harness({eventId:id,rows:{[id]:{...row,inputs:saved.inputs,lists:saved.lists}},contract:true});await reopened.flush();
  const rr=all(reopened.current.result);expect(rr.filter((r:any)=>r.fromUpload)).toHaveLength(REQUESTS.length);
  expect(ud1(rr,"TEST UD Weak").rankWhy).toBe(w.rankWhy);expect(reopened.requests).toEqual([]);reopened.unmount();
});
it("uncertain dance bound: late pure dance tags are awaited and lift it; mixed tags, disabled and failed stay bounded",async()=>{
  const tag=(t:any)=>async(r:any)=>late(r.data.songs.map((s:any)=>s.artist==="TEST UD Weak"?{...s,status:"found",evidence:{source:"lastfm",listeners:90000,...t}}:{...s,status:"none"}));
  const up=await runUD(tag({slowTags:[],upbeatTags:["dance"]}));
  expect(ud1(up.result,"TEST UD Weak").rankWhy).not.toMatch(/dance suitability uncertain/);
  const mixed=await runUD(tag({slowTags:["slow"],upbeatTags:["party"]}));
  expect(ud1(mixed.result,"TEST UD Weak").rankWhy).toMatch(/similarity bounded: dance suitability uncertain/);
  for (const c of [async(r:any)=>r.data.songs.map((s:any)=>({...s,status:"disabled"})),async()=>{throw Error("down");}]) {
    const x=await runUD(c);expect(ud1(x.result,"TEST UD Weak").rankWhy).toMatch(/similarity bounded: dance suitability uncertain/);
  }
});
