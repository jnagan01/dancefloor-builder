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
const harness = createRequire(import.meta.url)("./helpers/eventRouteHarness.cjs").createEventRouteHarness({vdj,dance,audio,snapshots,drafts,input,autosave,vibes,isolation,theory,revisions});
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
    if(process.env.DBG)console.log("DBG",JSON.stringify({n:result.length,errors:h.errors,warnings:h.warnings,infos:h.infos}));return {result,saved,calls,infos:h.infos,row};
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
  expect(infos.join(" ")).toMatch(/community tags couldn't be checked/);
  expect(result.find((r:any)=>r.artist==="TEST Held Out Tagged")?.rankWhy ?? "").not.toMatch(/community tags "/);
});
