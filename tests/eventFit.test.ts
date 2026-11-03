import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { recommend, rankPool, DEFAULT_REC_CONTROLS, type Candidate, type RecInput } from "../src/lib/prep/recommend";
import { evaluateFit, readEventFit, suggestFitFromNotes, fitFactsFromRow, normalizeEventFit } from "../src/lib/prep/eventFit";
import { rowCandidate } from "../src/lib/prep/expansionRanking";
import { inputsSchema } from "../src/lib/eventSchemas";
import { captureFromRanking, sampleInput } from "../src/lib/prep/qualityEval";
import { readQualitySamples } from "../src/lib/prep/quality";
import { runComparison, report, input as cmpInput, AFTER_FIT } from "./fit/fitComparison";

const cand = (artist: string, song: string, extra: Partial<Candidate> = {}): Candidate => ({ artist, song, origin: "ai", facts: {}, ...extra });
const base = (candidates: Candidate[], fit?: RecInput["preferences"] extends infer P ? P extends { fit?: infer F } ? F : never : never): RecInput => ({
  candidates, requests: [{ artist: "Req Artist", song: "Req Song" }], inEvent: [{ artist: "Req Artist", song: "Req Song" }], feedback: [], dismissed: [],
  similar: [{ artist: "Similar Artist", similarTo: "Req Artist", match: 1 }], preferences: fit ? { fit } : {}, controls: DEFAULT_REC_CONTROLS, limit: 20,
});
const pop = (p: number, s: "provider" | "ai" = "provider") => ({ fit: { popularity: p, popularitySource: s } });
const slow = (e: number, d: number, s: "provider" | "ai" | "catalogue" = "provider") => ({ fit: { energy: e, energySource: s, danceability: d, danceabilitySource: s } });

describe("legacy / no-choice controls", () => {
  it("no fit choice ranks exactly as before, even when fit facts are present", () => {
    const cs = [cand("Similar Artist", "A", pop(2)), cand("Other", "B", slow(2, 2)), cand("Req Artist", "C", pop(9))];
    const plain = recommend(base(cs.map(c => ({ ...c, fit: undefined }))));
    const withFacts = recommend(base(cs));
    expect(withFacts.items.map(i => [i.artist, i.score, i.evidence])).toEqual(plain.items.map(i => [i.artist, i.score, i.evidence]));
    expect(withFacts.hidden.slow).toBeUndefined();
  });
  it("empty fit objects normalise to no choice", () => {
    expect(normalizeEventFit({})).toBeUndefined();
    expect(normalizeEventFit({ avoidSlow: false })).toBeUndefined();
    expect(readEventFit(undefined)).toBeUndefined();
  });
});

describe("familiar hits", () => {
  const fit = { familiarity: "familiar" as const };
  it("similarity without track familiarity evidence is halved", () => {
    const out = recommend(base([cand("Similar Artist", "Deep cut")], fit));
    expect(out.items[0].score).toBe(1); // 2 × match 1, halved
    expect(out.items[0].evidence[0].text).toMatch(/no track-level familiarity evidence/);
  });
  it("popularity alone is not event fit: unlinked familiarity is halved", () => {
    const out = recommend(base([cand("Unrelated", "Big hit", pop(8))], fit));
    expect(out.items[0].score).toBe(1);
    expect(out.items[0].evidence[0].text).toMatch(/no link to this event/);
  });
  it("a linked familiar track outranks an equally similar unknown track", () => {
    const out = recommend(base([cand("Similar Artist", "Deep cut"), cand("Similar Artist", "Hit", pop(8))], { ...fit }));
    expect(out.items[0].song).toBe("Hit");
  });
  it("similarity is not halved when the track itself has familiarity evidence", () => {
    const out = recommend(base([cand("Similar Artist", "Hit", pop(8))], fit));
    expect(out.items[0].score).toBe(4);
  });
  it("unknown evidence is neutral: no bonus, no penalty line", () => {
    const r = evaluateFit(fit, { origin: "ai" });
    expect(r.lines).toEqual([]); expect(r.familiarEvidence).toBe(false);
  });
  it("AI-estimated popularity is advisory only and does not lift similarity", () => {
    const r = evaluateFit(fit, { origin: "ai", ...pop(9, "ai") });
    expect(r.lines.map(l => l.points)).toEqual([0.35]); expect(r.familiarEvidence).toBe(false);
    expect(evaluateFit(fit, { origin: "ai", ...pop(2, "ai") }).lines).toEqual([]);
  });
  it("low provider popularity lowers rank but never excludes (unfamiliar is not poor)", () => {
    const out = recommend(base([cand("X", "Obscure", pop(2))], fit));
    expect(out.items).toHaveLength(1); expect(out.items[0].score).toBe(-1.5);
  });
  it("boundaries: 7 strong, 5 moderate, 4 neutral, 3 low", () => {
    const pts = (p: number) => evaluateFit(fit, { origin: "ai", ...pop(p) }).lines.reduce((n, l) => n + l.points, 0);
    expect([pts(7), pts(6.9), pts(5), pts(4), pts(3)]).toEqual([2, 0.75, 0.75, 0, -1.5]);
  });
  it("personal play counts and ownership are not guest familiarity", () => {
    const r = evaluateFit(fit, { origin: "library" });
    expect(r.familiarEvidence).toBe(false);
    const out = recommend(base([cand("Lib", "Played a lot", { origin: "library", playCount: 500, facts: { owned: true } })], fit));
    expect(out.items[0].evidence.some(e => e.kind === "familiarTrack")).toBe(false);
  });
  it("catalogue membership is labelled curation evidence", () => {
    const r = evaluateFit(fit, { origin: "catalogue" });
    expect(r.familiarEvidence).toBe(true); expect(r.lines[0].text).toMatch(/curation, not chart data/);
  });
});

describe("discovery", () => {
  it("prefers less-common provider evidence, neutral on unknown", () => {
    const out = recommend(base([cand("A", "Famous", pop(9)), cand("B", "Niche", pop(4)), cand("C", "Unknown")], { familiarity: "discovery" }));
    expect(out.items.map(i => i.song)).toEqual(["Niche", "Unknown", "Famous"]);
  });
});

describe("avoid slow / ballad additions", () => {
  const fit = { avoidSlow: true };
  it("strong low energy AND danceability excludes and is counted", () => {
    const out = recommend(base([cand("Similar Artist", "Ballad", slow(3, 3)), cand("X", "Dance", slow(8, 8))], fit));
    expect(out.items.map(i => i.song)).toEqual(["Dance"]); expect(out.hidden.slow).toBe(1);
  });
  it("one low value alone never excludes or penalises (e.g. energy 4, dance 7)", () => {
    expect(evaluateFit(fit, { origin: "ai", ...slow(4, 7) })).toEqual({ lines: [], familiarEvidence: false });
  });
  it("estimates (AI and catalogue feel values) only lower the score", () => {
    for (const s of ["ai", "catalogue"] as const) {
      const r = evaluateFit(fit, { origin: "ai", ...slow(4, 4, s) });
      expect(r.exclude).toBeUndefined(); expect(r.lines[0].points).toBe(-1);
    }
  });
  it("boundary 4 is low, 5 is not", () => {
    expect(evaluateFit(fit, { origin: "ai", ...slow(4, 4) }).exclude).toBeDefined();
    expect(evaluateFit(fit, { origin: "ai", ...slow(5, 4) }).exclude).toBeUndefined();
  });
  it("tempo is never used: half-time energetic stays, double-time slow is still slow", () => {
    const out = recommend(base([
      cand("Half", "Time", { facts: { bpm: 70 }, ...slow(8, 7) }),
      cand("Double", "Time", { facts: { bpm: 160 }, ...slow(3, 2) }),
      cand("Missing", "Facts", { facts: { bpm: 60 } }),
    ], fit));
    expect(out.items.map(i => i.artist).sort()).toEqual(["Half", "Missing"]);
  });
  it("applies identically through rankPool (every automatic source) and never sees client requests", () => {
    const items = [{ a: "Req Artist", s: "Req Song" }, { a: "S", s: "Slow" }, { a: "F", s: "Fast" }];
    const stats: { hidden?: RecInput extends never ? never : ReturnType<typeof recommend>["hidden"] } = {};
    const ranked = rankPool(items, t => ({ artist: t.a, song: t.s, origin: "ai", facts: {}, ...(t.s === "Slow" ? slow(2, 2) : {}) }),
      { requests: [{ artist: "Req Artist", song: "Req Song" }], inEvent: [{ artist: "Req Artist", song: "Req Song" }], feedback: [], dismissed: [], preferences: { fit } }, 10, stats);
    expect(ranked.map(r => r.item.s)).toEqual(["Fast"]);
    expect(stats.hidden).toMatchObject({ slow: 1, inEvent: 1 });
  });
});

describe("row provenance → fit facts", () => {
  it("keeps provenance; legacy rows without provenance are estimates; missing stays missing", () => {
    expect(fitFactsFromRow({ energy: 3, danceability: 3, metaProv: { energy: "provider", danceability: "provider" } })).toEqual({ energy: 3, energySource: "provider", danceability: 3, danceabilitySource: "provider" });
    expect(fitFactsFromRow({ popularity: 8 })).toEqual({ popularity: 8, popularitySource: "estimate" });
    expect(fitFactsFromRow({ metaSource: "AI", popularity: 8 })).toEqual({ popularity: 8, popularitySource: "ai" });
    expect(fitFactsFromRow({})).toBeUndefined();
    expect(fitFactsFromRow({ energy: 42 })).toBeUndefined();
    expect(rowCandidate({ artist: "A", song: "B" }, "ai")).not.toHaveProperty("fit");
  });
});

describe("notes only suggest", () => {
  it("suggests from the brief without applying anything", () => {
    expect(suggestFitFromNotes("Familiar upbeat pop ... No line dances, slow ballads, or hard EDM.")).toEqual({ familiarity: "familiar", avoidSlow: true });
    expect(suggestFitFromNotes("Avoid slow songs please")).toEqual({ avoidSlow: true });
    expect(suggestFitFromNotes("Play Dirty Diana and Slow Hands early")).toBeUndefined();
    expect(suggestFitFromNotes("")).toBeUndefined();
  });
  it("notes text never filters candidates by title", () => {
    const i = base([cand("Niall Horan", "Slow Hands"), cand("X", "Ballad of Y")]);
    i.preferences = { fit: suggestFitFromNotes("no slow ballads") };
    expect(recommend(i).items).toHaveLength(2);
  });
});

describe("save / reopen / backup contract", () => {
  const inputs = { songs: [], hours: "1.5", artistsInput: "", genresInput: "", decades: [], notes: "", doNotPlayInput: "", expand: true, buffer: 1, eventName: "TEST" };
  it("accepts omitted (legacy) and valid choices; rejects invalid", () => {
    expect(inputsSchema.safeParse(inputs).success).toBe(true);
    expect(inputsSchema.safeParse({ ...inputs, eventFit: { familiarity: "familiar", avoidSlow: true } }).success).toBe(true);
    expect(inputsSchema.safeParse({ ...inputs, eventFit: { familiarity: "loud" } }).success).toBe(false);
    expect(inputsSchema.safeParse({ ...inputs, eventFit: { avoidSlow: "yes" } }).success).toBe(false);
    expect(inputsSchema.safeParse({ ...inputs, eventFit: { avoidSlow: true, extra: 1 } }).success).toBe(false);
  });
  it("round-trips through JSON (save → reopen / backup)", () => {
    const saved = JSON.parse(JSON.stringify({ ...inputs, eventFit: { familiarity: "discovery" } }));
    expect(readEventFit(inputsSchema.parse(saved).eventFit)).toEqual({ familiarity: "discovery" });
    expect(() => readEventFit({ familiarity: "x" })).toThrow();
  });
});

describe("frozen quality replay carries fit evidence and context", () => {
  it("capture → strict read → replay reproduces the same order and scores", () => {
    const i = cmpInput(AFTER_FIT);
    const out = recommend(i);
    const sample = { ...captureFromRanking(i, out.items, "fit", 14), id: "s1", createdAt: 1 };
    const [read] = readQualitySamples([JSON.parse(JSON.stringify(sample))]);
    expect(read.preferences.fit).toEqual(AFTER_FIT);
    expect(read.candidates.some(c => c.popularitySource === "provider")).toBe(true);
    const replay = recommend(sampleInput(read));
    expect(replay.items.map(r => `${r.artist}|${r.song}`)).toEqual(out.items.map(r => `${r.artist}|${r.song}`));
    expect(() => readQualitySamples([{ ...sample, preferences: { ...sample.preferences, fit: { familiarity: "x" } } }])).toThrow();
  });
});

describe("deterministic BEFORE/AFTER fixture", () => {
  it("is stable and only the fit choice changes the result", () => {
    const a = runComparison(), b = runComparison();
    expect(a.after.items.map(r => r.key)).toEqual(b.after.items.map(r => r.key));
    expect(a.before.items).toHaveLength(14); expect(a.after.items.length).toBeLessThanOrEqual(14);
    // Strong provider evidence: low-popularity + slow held-out cases never lead; similarity-only picks are halved.
    const after = a.after.items.map(r => r.song);
    expect(after.indexOf("Live Your Life")).toBe(-1);
    expect(a.after.items.filter(r => r.evidence.some(e => /counted half/.test(e.text))).length).toBeGreaterThan(0);
    if (process.env.WRITE_FIT_REPORT) writeFileSync(process.env.WRITE_FIT_REPORT, report());
  });
});

describe("saved-event evidence (Let It Be / Chasing Cars as actually stored)", () => {
  it("genre tags and BPM never classify slow; estimates/AI never exclude; uncertainty is reported", async () => {
    const { runComparison } = await import("./fit/fitComparison");
    const { after } = runComparison(true);
    const { recommend } = await import("../src/lib/prep/recommend"); const { input, AFTER_FIT } = await import("./fit/fitComparison"); const all = recommend({ ...input(AFTER_FIT, true), limit: 999 } as any).items;
    const find = (s: string) => all.find((r: any) => r.song === s) as any;
    const cc = find("Chasing Cars"), lib = find("Let It Be");
    for (const r of [cc, lib].filter(Boolean)) {
      expect(r.evidence.some((e: any) => e.kind === "slowStrong")).toBe(false);
      expect(r.evidence.some((e: any) => e.kind === "familiarTrack" && !/advisory/.test(e.text))).toBe(false);
      expect(r.evidence.find((e: any) => e.kind === "lastfm")?.text).toMatch(/counted half/);
      expect(r.uncertain?.join(" ")).toMatch(/unverified|unknown/);
    }
    if (lib) expect(lib.evidence.some((e: any) => e.kind === "slowEstimate" && e.points < 0)).toBe(true);
  });
});
it("saved-event evidence keeps Chasing Cars and Let It Be out of the 14 with fit on, without excluding them", async () => {
  const { recommend } = await import("../src/lib/prep/recommend"); const { input, AFTER_FIT } = await import("./fit/fitComparison");
  const items = recommend({ ...input(AFTER_FIT, true), limit: 999 } as any).items;
  const idx = (s: string) => items.findIndex((r: any) => r.song === s);
  expect(idx("Chasing Cars")).toBeGreaterThanOrEqual(14); expect(idx("Let It Be")).toBeGreaterThanOrEqual(14);
  expect(idx("Chasing Cars")).toBeGreaterThanOrEqual(0); expect(idx("Let It Be")).toBeGreaterThanOrEqual(0);
});

describe("review fixes: popularity provenance, catalogue membership, panel parity, caveats", () => {
  it("only verified provider popularity counts as guest familiarity; personal/local sources are unknown", async () => {
    const { evaluateFit } = await import("../src/lib/prep/eventFit");
    const ev = (src: any) => evaluateFit({ familiarity: "familiar" }, { origin: "library", fit: { popularity: 9, popularitySource: src } });
    expect(ev("provider").familiarEvidence).toBe(true);
    for (const s of ["user", "tags", "virtualdj", "measured"]) { const r = ev(s); expect(r.familiarEvidence).toBe(false); expect(r.lines).toEqual([]); expect(r.uncertain?.join()).toMatch(/not audience data/); }
    const est = ev("estimate"); expect(est.familiarEvidence).toBe(false); expect(est.lines[0].points).toBe(0.35);
    const low = evaluateFit({ familiarity: "familiar" }, { origin: "library", fit: { popularity: 1, popularitySource: "user" } });
    expect(low.lines).toEqual([]); // a personal low rating is not evidence a song is unknown to guests
  });
  it("catalogue membership is source-independent and version-aware", async () => {
    const { evaluateFit, inCrowdCatalogue } = await import("../src/lib/prep/eventFit");
    const { SONG_LIBRARY } = await import("../src/lib/songLibrary");
    const s = SONG_LIBRARY[0];
    for (const origin of ["library", "catalogue", "ai"] as const) expect(evaluateFit({ familiarity: "familiar" }, { origin, artist: s.artist, song: s.song }).familiarEvidence).toBe(true);
    expect(inCrowdCatalogue(s.artist, `${s.song} (Clean)`)).toBe(true);
    for (const v of ["Live", "Remix", "Acoustic", "Extended Mix"]) expect(inCrowdCatalogue(s.artist, `${s.song} (${v})`)).toBe(false);
    expect(inCrowdCatalogue("Nobody Real", s.song)).toBe(false);
  });
  it("panel catalogue fit facts equal the automatic route's provenance-derived facts; library files stay unknown", async () => {
    const { catalogueFitFacts, fitFactsFromRow } = await import("../src/lib/prep/eventFit");
    const { withProv } = await import("../src/lib/prep/provenance");
    const { SONG_LIBRARY } = await import("../src/lib/songLibrary");
    const { libraryCandidate } = await import("../src/lib/prep/requestFacts");
    for (const s of SONG_LIBRARY.slice(0, 25)) {
      const row = withProv({ artist: s.artist, song: s.song, energy: s.energy, danceability: s.danceability } as any, "catalogue");
      expect(catalogueFitFacts(s)).toEqual(fitFactsFromRow(row));
    }
    const lib = libraryCandidate({ artist: "A", title: "B", filePath: "/x/a.mp3" } as any, "id") as any;
    expect(lib.fit).toBeUndefined(); expect(lib.facts.energy).toBeUndefined();
  });
  it("slow estimate and fit caveats stay visible when positive reasons fill the explanation", async () => {
    const { explainTop } = await import("../src/lib/prep/recommend");
    const long = "x".repeat(400);
    const out = explainTop({ evidence: [{ kind: "lastfm", text: long, points: 3 }, { kind: "decade", text: long, points: 2 }, { kind: "genre", text: long, points: 1 }, { kind: "slowEstimate", text: "Energy 4/10 and danceability 4/10 suggest a slow song (estimate, advisory)", points: -1 }] as any, uncertain: ["Guest familiarity unknown: no track popularity data"] }, 3);
    expect(out.length).toBeLessThanOrEqual(900);
    expect(out).toMatch(/suggest a slow song/); expect(out).toMatch(/Guest familiarity unknown/);
  });
});
