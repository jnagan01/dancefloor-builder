import { describe, it, expect } from "vitest";
import { evaluateFit, UNCERTAIN_DANCE_SIMILARITY_CAP } from "../src/lib/prep/eventFit";
import { recommend, DEFAULT_REC_CONTROLS, type Candidate } from "../src/lib/prep/recommend";
import { songIdentity } from "../src/lib/prep/knowledge";

const ev = (fit: any, f: any = {}) => evaluateFit(fit, { origin: "ai", artist: "ZZ Test", song: "Z", fit: f });
const est = (e: number, d: number, s = "estimate") => ({ energy: e, energySource: s, danceability: d, danceabilitySource: s });
describe("uncertain dance suitability (avoid-slow only)", () => {
  it("bounds similarity to 2 for weak 6/6 estimates, missing and verified-moderate feel, without points or exclusion", () => {
    for (const f of [est(6, 6), {}, est(6, 6, "provider"), est(5, 6, "catalogue")]) {
      const r = ev({ avoidSlow: true }, f);
      expect(r.similarityCap).toBe(UNCERTAIN_DANCE_SIMILARITY_CAP); expect(r.similarityCapReason).toBe("uncertainDance");
      expect(r.exclude).toBeUndefined(); expect(r.lines).toEqual([]);
      expect(r.uncertain!.join(" ")).toMatch(/not classified slow/);
    }
  });
  it("leaves supported upbeat, grooves and dance-tagged tracks unbounded", () => {
    for (const f of [est(8, 8, "provider"), est(7, 8, "ai"), est(4, 8, "ai"), est(7, 5), { community: { slowTags: [], upbeatTags: ["dance"] } }])
      expect(ev({ avoidSlow: true }, f).similarityCap).toBeUndefined();
  });
  it("keeps the stricter slow-risk cap without stacking", () => {
    const r = ev({ avoidSlow: true }, est(3, 3)); expect(r.similarityCap).toBe(1); expect(r.similarityCapReason).toBe("slowRisk");
    const c = ev({ avoidSlow: true }, { ...est(6, 6), community: { slowTags: ["ballad"], upbeatTags: [] } }); expect(c.similarityCap).toBe(1);
    expect(c.lines.filter(l => l.points < 0)).toHaveLength(1);
  });
  it("no avoid-slow choice → no bound", () => {
    for (const fit of [undefined, { familiarity: "familiar" }, { familiarity: "discovery" }]) expect(ev(fit, est(6, 6)).similarityCap).toBeUndefined();
  });
  it("rankPool/recommend applies the bound to all similarity kinds; lookupPriority lifts only this bound", () => {
    const reqs = [{ artist: "ZZ Req", song: "R" }];
    const cands: Candidate[] = [{ ref: 0, artist: "ZZ Req", song: "Other", origin: "ai", facts: {}, fit: est(6, 6) as any }];
    const base = { candidates: cands, requests: reqs, inEvent: reqs, feedback: [], dismissed: [], similarTracks: [{ key: songIdentity("ZZ Req", "Other"), artist: "ZZ Req", song: "Other", seeds: ["ZZ Req – R"], bestMatch: 1 }], controls: DEFAULT_REC_CONTROLS, preferences: { genres: [], artists: [], decades: [], fit: { avoidSlow: true } } } as any;
    const sim = (o: any) => o.items[0].evidence.filter((e: any) => ["artist", "lastfmTrack"].includes(e.kind)).reduce((n: number, e: any) => n + e.points, 0);
    expect(sim(recommend(base))).toBeCloseTo(2, 1);
    expect(sim(recommend({ ...base, lookupPriority: true }))).toBeGreaterThan(2);
  });
});
describe("uncertain dance suitability: community tag conflicts and wording", () => {
  const cm = (slowTags: string[], upbeatTags: string[]) => ({ community: { listeners: 500000, slowTags, upbeatTags } });
  it("mixed slow+party tags never lift the cap (6/6 estimate or unknown feel); no slow penalty", () => {
    for (const f of [{ ...est(6, 6), ...cm(["slow"], ["party"]) }, cm(["ballad"], ["dance"])]) {
      const r = ev({ avoidSlow: true }, f);
      expect(r.similarityCap).toBe(2); expect(r.similarityCapReason).toBe("uncertainDance");
      expect(r.lines.some(l => l.points < 0)).toBe(false);
      expect(r.uncertain!.join(" ")).toMatch(/Dance suitability uncertain/);
    }
  });
  it("purely upbeat tags lift it; numeric groove support still stands under mixed tags", () => {
    expect(ev({ avoidSlow: true }, { ...est(6, 6), ...cm([], ["party"]) }).similarityCap).toBeUndefined();
    expect(ev({ avoidSlow: true }, { ...est(5, 8, "ai"), ...cm(["slow"], ["party"]) }).similarityCap).toBeUndefined();
  });
  it("describes each attribute's own source; no 'moderate'/'estimates' mislabel and no point counts", () => {
    const t = ev({ avoidSlow: true }, { energy: 9, energySource: "provider", danceability: 3, danceabilitySource: "ai" }).uncertain!.find(u => u.startsWith("Dance suitability"))!;
    expect(t).toMatch(/energy 9\/10 \(music data provider\), danceability 3\/10 \(.+\) do not establish upbeat fit/);
    expect(t).not.toMatch(/moderate|are estimates|points/);
    expect(ev({ avoidSlow: true }, { energy: 6, energySource: "estimate" }).uncertain!.join(" ")).toMatch(/danceability unknown/);
  });
});
