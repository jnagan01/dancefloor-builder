import { describe, expect, it } from "vitest";
import { aggregateSimilar, overallAvailability, parseSimilarBody, runSimilarTracks, seedsFromRequests, availabilityNote, type SimilarCache } from "../src/lib/prep/similarTracks";
import { expansionFeedback, favoredFirst, recheckAdditions } from "../src/lib/prep/expansionFeedback";
import { emptyKnowledge, dismissForEvent, setFeedback, readKnowledge, eventPrep, mergeKnowledgeAdditive } from "../src/lib/prep/knowledge";
import { recommend, type Candidate, type RecControls } from "../src/lib/prep/recommend";
import { tierOf, usableForHardRule, TIER_WEIGHT } from "../src/lib/prep/metaConfidence";
import { trackFacts } from "../src/lib/prep/filters";
import { validateBackup } from "../src/lib/backups";
import type { VdjTrack } from "../src/lib/virtualDj";

const body = (rows: Array<[string, string, number]>) => ({ similartracks: { track: rows.map(([artist, name, match]) => ({ name, match, artist: { name: artist } })) } });
const controls: RecControls = { familiarity: 0, clientSimilarity: 1, artistVariety: 0, ownedOnly: false };
const cand = (artist: string, song: string, facts: Candidate["facts"] = {}): Candidate => ({ artist, song, facts: { owned: true, ...facts }, origin: "library", trackId: `/m/${artist}-${song}.mp3` });

describe("Last.fm track.getSimilar evidence", () => {
  it("aggregates support across distinct requested tracks; duplicate requests never inflate support", () => {
    const seeds = seedsFromRequests([{ artist: "Queen", song: "Don't Stop Me Now" }, { artist: "queen", song: "don't stop me now" }, { artist: "ABBA", song: "Dancing Queen" }, { artist: "", song: "No artist" }]);
    expect(seeds).toHaveLength(2);
    const agg = aggregateSimilar([
      { seed: seeds[0], status: "ok", similar: parseSimilarBody(body([["Elton John", "I'm Still Standing", 0.8], ["Queen", "Don't Stop Me Now", 1]])).similar },
      { seed: { artist: "QUEEN", title: "Don't Stop Me Now" }, status: "ok", similar: parseSimilarBody(body([["Elton John", "I'm Still Standing", 0.9]])).similar },
      { seed: seeds[1], status: "ok", similar: parseSimilarBody(body([["Elton John", "I'm Still Standing", 0.5], ["Elton John", "I'm Still Standing (Remix)", 0.7]])).similar },
    ]);
    const still = agg.find(e => e.song === "I'm Still Standing")!;
    expect(still.seeds).toEqual(["Queen – Don't Stop Me Now", "ABBA – Dancing Queen"]);
    expect(agg.some(e => e.song === "Don't Stop Me Now")).toBe(false); // a request never supports itself
    expect(agg.find(e => e.song.includes("Remix"))!.seeds).toHaveLength(1); // versions stay distinct
  });

  it("track evidence outranks artist-only neighbours and multi-seed outranks single-seed", () => {
    const requests = [{ artist: "Queen", song: "A" }, { artist: "ABBA", song: "B" }];
    const sim = aggregateSimilar([
      { seed: { artist: "Queen", title: "A" }, status: "ok", similar: [{ artist: "X", title: "Two", match: 0.3 }, { artist: "Y", title: "One", match: 0.3 }] },
      { seed: { artist: "ABBA", title: "B" }, status: "ok", similar: [{ artist: "X", title: "Two", match: 0.3 }] },
    ]);
    const out = recommend({ candidates: [cand("Z", "Neighbour"), cand("Y", "One"), cand("X", "Two")], requests, inEvent: [], feedback: [], dismissed: [], similar: [{ artist: "Z", similarTo: "Queen", match: 1 }], similarTracks: sim, controls });
    expect(out.items.map(i => i.song)).toEqual(["Two", "One", "Neighbour"]);
    expect(out.items[0].evidence.find(e => e.kind === "lastfmTrack")!.text).toContain("2 requested tracks");
  });

  it("reports missing key, rate limit, partial and failed lookups truthfully with no cached failures", async () => {
    const cache: SimilarCache = new Map();
    const seeds = [{ artist: "A", title: "1" }, { artist: "B", title: "2" }];
    expect((await runSimilarTracks(undefined, seeds, 10, async () => { throw Error("no call"); }, cache)).availability).toBe("missingKey");
    expect((await runSimilarTracks("k", [], 10, async () => { throw Error("no call"); }, cache)).availability).toBe("noSeeds");
    const urls: string[] = [];
    const rl = await runSimilarTracks("k", seeds, 10, async (u) => { urls.push(u); return { status: 429, json: async () => ({}) }; }, cache);
    expect(rl.availability).toBe("rateLimited");
    expect(cache.size).toBe(0);
    // Only artist/title/limit leave the app.
    const q = new URL(urls[0]).searchParams;
    expect([...q.keys()].sort()).toEqual(["api_key", "artist", "autocorrect", "format", "limit", "method", "track"]);
    const partial = await runSimilarTracks("k", seeds, 10, async (u) => new URL(u).searchParams.get("artist") === "A" ? { status: 200, json: async () => body([["C", "3", 0.5]]) } : (() => { throw Error("timeout"); })(), cache);
    expect(partial.availability).toBe("partial");
    expect(cache.size).toBe(1);
    expect(overallAvailability(["badKey", "badKey"])).toBe("missingKey");
    expect(parseSimilarBody({ error: 6 }).status).toBe("notFound");
    expect(availabilityNote("rateLimited", 2)).toMatch(/rate limited/);
    expect(availabilityNote("ok", 2)).not.toMatch(/%/);
  });
});

describe("Expansion honours account-fenced preparation knowledge", () => {
  it("global Never everywhere, dismissals only for their event, favour reorders only", () => {
    let k = setFeedback(emptyKnowledge(), "Bad", "Song", "never");
    k = setFeedback(k, "Fav", "Song", "favor");
    k = dismissForEvent(k, "E1", "Slow", "Song", "tooSlow");
    const e1 = expansionFeedback(k, "E1"), e2 = expansionFeedback(k, "E2"), none = expansionFeedback(k, null);
    expect(e1.blocked("bad", "song")).toBe("never");
    expect(e2.blocked("Bad", "Song")).toBe("never");
    expect(e1.blocked("Slow", "Song")).toBe("dismissed");
    expect(e2.blocked("Slow", "Song")).toBe(false); // no cross-event leakage
    expect(none.blocked("Slow", "Song")).toBe(false);
    expect(favoredFirst([{ artist: "A", song: "1" }, { artist: "Fav", song: "Song" }], e1).map(x => x.artist)).toEqual(["Fav", "A"]);
    expect(expansionFeedback(null, "E1").blocked("Bad", "Song")).toBe(false);
  });

  it("late re-check drops newly blocked additions but always keeps client requests", () => {
    const rows = [{ artist: "Bad", song: "Song", fromUpload: true }, { artist: "Bad", song: "Song", fromUpload: false }, { artist: "Ok", song: "Song" }];
    const before = recheckAdditions(rows, expansionFeedback(emptyKnowledge(), "E1"));
    expect(before.removed).toBe(0);
    const after = recheckAdditions(rows, expansionFeedback(setFeedback(emptyKnowledge(), "Bad", "Song", "never"), "E1"));
    expect(after.kept).toEqual([rows[0], rows[2]]);
    expect(after.removed).toBe(1);
  });

  it("dismissal reasons are optional, validated, event-scoped and backward compatible", () => {
    const legacy = { version: 1, presets: [], tracks: [], groups: [], feedback: [], enrichment: [], events: [{ eventId: "E1", dismissed: [{ key: "a|b", label: "A – B", at: 1 }], shortlist: [] }] };
    const frozen = JSON.stringify(legacy);
    expect(readKnowledge(legacy)!.events[0].dismissed[0]).toEqual({ key: "a|b", label: "A – B", at: 1 });
    expect(JSON.stringify(legacy)).toBe(frozen);
    const k = dismissForEvent(readKnowledge(legacy)!, "E1", "A", "B", "wrongStyle");
    expect(eventPrep(k, "E1").dismissed).toEqual([{ key: "a|b", label: "A – B", at: 1, reason: "wrongStyle" }]);
    expect(readKnowledge(JSON.parse(JSON.stringify(k)))).toEqual(k);
    expect(readKnowledge({ ...legacy, events: [{ ...legacy.events[0], dismissed: [{ key: "a|b", label: "x", at: 1, reason: "nope" }] }] })).toBeNull();
    expect(() => validateBackup({ version: 1, exportedAt: "x", events: [], prep: k } as never)).not.toThrow(/preparation/);
    const merged = mergeKnowledgeAdditive(emptyKnowledge(), k).next;
    expect(eventPrep(merged, "E2").dismissed).toEqual([]);
  });
});

describe("Source-aware metadata confidence", () => {
  it("verified file tags outrank AI estimates; unknown never adds evidence", () => {
    const requests = [{ artist: "Q", song: "R", genre: "funk", decade: "1980s" }];
    const out = recommend({
      candidates: [
        cand("AI", "Guess", { genre: "Funk", decade: "1980s", genreSource: "ai", decadeSource: "ai" }),
        cand("Tag", "Known", { genre: "Funk", decade: "1980s", genreSource: "tags", decadeSource: "tags" }),
        cand("Unk", "None", {}),
      ], requests, inEvent: [], feedback: [], dismissed: [], controls,
    });
    expect(out.items.map(i => i.artist)).toEqual(["Tag", "AI", "Unk"]);
    expect(out.items[1].evidence[0].text).toContain("AI estimate");
    expect(out.items[2].evidence).toEqual([]);
  });

  it("only verified sources satisfy hard rules; local file facts carry their provenance", () => {
    expect(usableForHardRule("ai", true)).toBe(false);
    expect(usableForHardRule("estimate", true)).toBe(false);
    expect(usableForHardRule("catalogue", true)).toBe(false);
    expect(usableForHardRule("tags", true)).toBe(true);
    expect(usableForHardRule("tags", false)).toBe(false);
    expect(tierOf(undefined, true)).toBe("unknown");
    expect(TIER_WEIGHT.estimate).toBeLessThan(TIER_WEIGHT.verified);
    const f = trackFacts({ filePath: "/m/a.mp3", artist: "A", title: "T", genre: "Disco", year: "1979" } as VdjTrack);
    expect(f.genreSource).toBe("tags");
    const blank = trackFacts({ filePath: "/m/b.mp3", artist: "A", title: "T" } as VdjTrack);
    expect(blank.genre).toBeUndefined();
    expect(blank.genreSource).toBeUndefined();
  });
});
