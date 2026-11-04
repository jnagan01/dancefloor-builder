import { it, expect } from "vitest";
import fs from "node:fs";
import { communityData, communityMarkdown } from "./fit/communityComparison";
it("reproduces the community-evidence report on identical pools without replacing earlier reports",()=>{
  const d=communityData(), json=JSON.stringify(d,null,1)+"\n", md=communityMarkdown()+"\n";
  if(process.env.UPDATE_COMMUNITY_REPORT){fs.writeFileSync("tests/fit/community.json",json);fs.writeFileSync("tests/fit/community.md",md);}
  expect(fs.readFileSync("tests/fit/community.json","utf8")).toBe(json); expect(fs.readFileSync("tests/fit/community.md","utf8")).toBe(md);
  expect(d.noFitUnchanged).toEqual({archived31:true,heldOut:true});
  // No real community data in archived/latest fixtures: identical rankings, honestly reported.
  expect(d.archived31.afterTop14).toEqual(d.archived31.beforeTop14);
  expect(d.latest14Exact.afterTop14).toEqual(d.latest14Exact.beforeTop14);
  expect(d.latest14Exact.ratingsReportOnly.after).toEqual({Good:7,Fair:5,Poor:1,Unfamiliar:1,Unrated:0});
  const rank=(v:any,t:string)=>v.after.find((r:any)=>r.track===t).rank;
  const ho=d.heldOut.familiarAvoidSlow;
  expect(rank(ho,"HO North|Lantern")).toBeGreaterThan(rank(ho,"HO East|Harbor"));
  expect(ho.after).toHaveLength(11); // estimates never exclude
  for (const t of ["HO Peak|Summit","HO Vale|Ridge"]) expect(d.heldOut.cases.find(c=>c.track===t)?.parsedCommunity).toBeNull();
  expect(d.heldOut.cases.find(c=>c.track==="HO Glen|Ember")?.parsedCommunity?.slowTags).toEqual([]);
  expect(d.heldOut.discovery.after.map(r=>r.track)).toEqual(d.heldOut.discovery.before.map(r=>r.track));
});
