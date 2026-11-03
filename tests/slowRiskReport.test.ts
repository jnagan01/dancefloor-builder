import { it, expect } from "vitest";
import fs from "node:fs";
import { slowRiskData, slowRiskMarkdown } from "./fit/slowRiskComparison";
it("reproduces new identical-evidence reports without replacing saved originals",()=>{
  const d=slowRiskData(), json=JSON.stringify(d,null,1)+"\n", md=slowRiskMarkdown()+"\n";
  if(process.env.UPDATE_SLOW_REPORT){fs.writeFileSync("tests/fit/slow-risk.json",json);fs.writeFileSync("tests/fit/slow-risk.md",md);}
  expect(fs.readFileSync("tests/fit/slow-risk.json","utf8")).toBe(json); expect(fs.readFileSync("tests/fit/slow-risk.md","utf8")).toBe(md);
  expect(d.noFitUnchanged).toBe(true); expect(d.archived31.after).toHaveLength(31);
  expect(d.latest14Only.ratingsReportOnly.after).toEqual({Good:7,Fair:5,Poor:2,Unfamiliar:0,Unrated:0});
  expect(d.latest14Only.after.find(r=>r.track==="Snow Patrol|Chasing Cars")?.evidence.some(e=>e.kind==="slowEstimate")).toBe(false);
});