import { it, expect } from "vitest";
import fs from "node:fs";
import { danceData, danceMarkdown } from "./fit/danceUncertaintyComparison";

it("reproduces the uncertain-dance-suitability report on identical pools without replacing earlier reports", () => {
  const d = danceData(), json = JSON.stringify(d, null, 1) + "\n", md = danceMarkdown() + "\n";
  if (process.env.UPDATE_DANCE_REPORT) { fs.writeFileSync("tests/fit/dance-uncertainty.json", json); fs.writeFileSync("tests/fit/dance-uncertainty.md", md); }
  expect(fs.readFileSync("tests/fit/dance-uncertainty.json", "utf8")).toBe(json);
  expect(fs.readFileSync("tests/fit/dance-uncertainty.md", "utf8")).toBe(md);
  for (const v of Object.values(d.unchangedWithoutAvoidSlow)) expect(v).toEqual({ archived31: true, current14: true, heldOut: true, community: true });
  const row = (v: any, t: string) => v.after.find((r: any) => r.track === t);
  const prev = (v: any, t: string) => v.before.find((r: any) => r.track === t);
  // Nothing excluded by uncertainty: same counts both sides.
  expect(d.current14.after).toHaveLength(14); expect(d.heldOut.familiarAvoidSlow.after).toHaveLength(11);
  // Weak 6/6 estimate ranks below verified upbeat, estimated upbeat and the lower-energy groove, with identical similarity.
  const ho = d.heldOut.avoidSlowOnly;
  for (const up of ["HX Cedar|Neon Steps", "HX Fir|Bright Arc", "HX Elm|Slow Burn Funk", "HX Alder|Quiet Road (Club Remix)"])
    expect(row(ho, up).rank).toBeLessThan(row(ho, "HX Alder|Quiet Road").rank);
  // Confident upbeat and grooves keep their previous score exactly.
  for (const up of ["HX Cedar|Neon Steps", "HX Fir|Bright Arc", "HX Elm|Slow Burn Funk", "HX Ivy|Candle"]) expect(row(ho, up).score).toBe(prev(ho, up).score);
  // Half/double BPM never changes the outcome.
  expect(row(ho, "HX Gum|Halftime").score).toBe(row(ho, "HX Hazel|Doubletime").score);
  // Explanations say uncertain, never "slow".
  const weak = row(ho, "HX Alder|Quiet Road");
  expect(weak.uncertain.join(" ")).toMatch(/Dance suitability uncertain.*not classified slow/);
  expect(weak.evidence.some((e: any) => e.kind === "slowEstimate")).toBe(false);
  // Current pool: Chasing Cars (6/6 estimates) moves down; score falls; it is not removed (14-candidate pool).
  const cc = "Snow Patrol|Chasing Cars";
  expect(row(d.current14, cc).score).toBeLessThan(prev(d.current14, cc).score);
  expect(row(d.current14, cc).rank).toBeGreaterThan(prev(d.current14, cc).rank);
  // Community: slow+party conflict stays uncertain (bounded, no penalty); dance tags supply support; ballad tag keeps the stricter cap.
  const c = d.communityCases;
  expect(row(c, "HX Kapok|Stomp").score).toBe(prev(c, "HX Kapok|Stomp").score);
  expect(row(c, "HX Larch|Ballad Of Rain").score).toBe(prev(c, "HX Larch|Ballad Of Rain").score);
  expect(row(c, "HX Juniper|Crossfade").evidence.some((e: any) => e.points < 0)).toBe(false);
  expect(row(c, "HX Juniper|Crossfade").uncertain.join(" ")).toMatch(/Dance suitability uncertain/);
  expect(row(c, "HX Juniper|Crossfade").score).toBeLessThan(prev(c, "HX Juniper|Crossfade").score);
  expect(row(c, "HX Kapok|Stomp").uncertain.join(" ")).not.toMatch(/Dance suitability uncertain/);
});
