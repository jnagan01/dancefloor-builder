import { describe, it, expect } from "vitest";
import { recommend, rankPool, explainTop } from "../src/lib/prep/recommend";
import { recommend as before } from "./fit/archived/recommend.543920d";
import { matrix, matrixInput } from "./fit/slowRiskMatrix";
import { evaluateFit } from "../src/lib/prep/eventFit";
import { captureFromRanking, sampleInput } from "../src/lib/prep/qualityEval";
import { readQualitySamples } from "../src/lib/prep/quality";
import { inputsSchema } from "../src/lib/eventSchemas";

describe("active avoid-slow held-out evidence boundaries", () => {
  it("old exact-track similarity overwhelms 4/4 estimates; bounded new risk ranks comparable supported upbeat above it", () => {
    const i = matrixInput(matrix.slice(0, 2));
    expect(before(i).items[0].song).toBe("A");
    const n = recommend(i); expect(n.items[0].song).toBe("B");
    const risk = n.items.find(r => r.song === "A"); expect(risk).toBeDefined();
    expect(risk?.evidence.filter(e => e.kind === "lastfmTrack").reduce((s, e) => s + e.points, 0)).toBe(1);
    expect(risk?.evidence.find(e => e.kind === "slowEstimate")?.points).toBe(-3);
    expect(explainTop(risk ?? { evidence: [] })).toMatch(/ranked lower, not confirmed slow/);
  });
  it("verified low both excludes automatic only; estimates remain even as the sole choice", () => {
    expect(recommend(matrixInput([matrix[2]])).hidden.slow).toBe(1);
    expect(recommend(matrixInput([matrix[0]])).items).toHaveLength(1);
    const i = matrixInput([matrix[2]]); i.inEvent = [matrix[2]];
    expect(recommend(i).hidden.inEvent).toBe(1); expect(recommend(i).hidden.slow).toBe(0);
  });
  it("groove and mixed-source contradictions are explained, never fabricated as slow", () => {
    for (const c of matrix.slice(3, 5)) {
      const r = evaluateFit({ avoidSlow: true }, c);
      expect(r.exclude).toBeUndefined(); expect(r.lines).toEqual([]); expect(r.uncertain?.join()).toMatch(/conflict.*groove is possible/);
      expect(r.uncertain?.join()).toMatch(/Verified|AI estimate/);
    }
  });
  it("estimated popularity cannot rescue unknown/low/moderate feel; verified popularity is not dance proof", () => {
    for (const index of [0, 5, 8]) expect(evaluateFit({ familiarity: "familiar", avoidSlow: true }, matrix[index]).lines.filter(l => l.kind === "familiarTrack").reduce((s,l) => s+l.points,0)).toBe(0);
    expect(evaluateFit({ familiarity: "familiar", avoidSlow: true }, matrix[9]).lines[0].points).toBe(0.35);
    const r = evaluateFit({ familiarity: "familiar", avoidSlow: true }, matrix[6]);
    expect(r.exclude).toBeUndefined(); expect(r.lines[0].points).toBe(1); expect(r.uncertain?.join()).toMatch(/recognition, not/);
    const verifiedSlow = { ...matrix[2], fit: { ...matrix[2].fit, popularity: 10, popularitySource: "provider" as const } };
    expect(recommend(matrixInput([verifiedSlow])).items).toHaveLength(0);
  });
  it("unknown and boundary above 4 never earn slow penalties, BPM alone is ignored", () => {
    for (const index of [5, 7, 8]) {
      const r = evaluateFit({ avoidSlow: true }, matrix[index]); expect(r.exclude).toBeUndefined(); expect(r.lines).toEqual([]);
    }
  });
  it("neutral, legacy, familiarity-alone and discovery-alone outputs remain identical", () => {
    for (const fit of [undefined, {}, { avoidSlow: false }, { familiarity: "familiar" as const }, { familiarity: "discovery" as const }]) {
      const i = { ...matrixInput(), preferences: { fit } }; expect(recommend(i)).toEqual(before(i));
    }
  });
  it("all source paths share rankPool; renaming leaves scores and risk unchanged", () => {
    const i = matrixInput(); const out = recommend(i);
    const renamed = matrix.map(c => ({ ...c, artist: c.artist.replace("TEST", "RENAMED"), song: c.song }));
    expect(recommend(matrixInput(renamed)).items.map(r => [r.song, r.score])).toEqual(out.items.map(r => [r.song,r.score]));
    for (const origin of ["library", "ai", "catalogue"] as const) {
      const cs = matrix.slice(0,2).map(c => ({ ...c, origin })); const ctx = matrixInput(cs);
      const { candidates: _, limit: __, ...context } = ctx;
      expect(rankPool(cs, c => c, context).map(r => r.item.song)).toEqual(recommend({ ...ctx, limit: 2 }).items.map(r => r.song));
    }
  });
  it("frozen evidence replay and optional snapshot inputs survive without new fields", () => {
    const i = matrixInput(), out = recommend(i);
    const sample = { ...captureFromRanking(i, out.items, "held-out", 14), id: "risk", createdAt: 1 };
    const [read] = readQualitySamples(JSON.parse(JSON.stringify([sample])));
    expect(recommend(sampleInput(read)).items.map(r => [r.song,r.score])).toEqual(out.items.map(r => [r.song,r.score]));
    const legacy = { songs: [], hours: "1.5", artistsInput: "", genresInput: "", decades: [], notes: "", doNotPlayInput: "", buffer: 1, expand: false, eventName: "TEST" };
    expect(inputsSchema.parse(legacy).eventFit).toBeUndefined();
    expect(inputsSchema.parse(JSON.parse(JSON.stringify({ ...legacy, eventFit: i.preferences?.fit }))).eventFit).toEqual(i.preferences?.fit);
  });
});