/**
 * Deterministic BEFORE/AFTER comparison for the event-fit choices on ONE identical explicit fixture.
 * - Candidate evidence: a read-only snapshot of real `song_metadata_cache` rows (energy/danceability/popularity with the
 *   row's recorded source: ReccoBeats = provider, AI = AI estimate). Missing values stay missing.
 * - Similarity: EXPLICIT SYNTHETIC artist-level entries (not live Last.fm reads), identical in both runs.
 * - Context: the fictional Traditional Wedding brief's 10 requests, decades 1970s–2020s, no favourite artists/genres.
 * The only difference between runs is `preferences.fit`. User ratings are attached for reporting only; they are never
 * an input to ranking.
 */
import rows from "./realCacheRows.json";
import { recommend, explainTop, DEFAULT_REC_CONTROLS, type Candidate, type RecInput, type Recommendation } from "../../src/lib/prep/recommend";
import { rowCandidate } from "../../src/lib/prep/expansionRanking";
import { SONG_LIBRARY } from "../../src/lib/songLibrary";
import { songIdentity } from "../../src/lib/prep/knowledge";
import type { EventFit } from "../../src/lib/prep/eventFit";

export const REQUESTS = [
  ["Earth, Wind & Fire", "September"], ["Mark Ronson feat. Bruno Mars", "Uptown Funk"], ["Whitney Houston", "I Wanna Dance With Somebody"],
  ["Usher feat. Lil Jon & Ludacris", "Yeah!"], ["The Killers", "Mr. Brightside"], ["Walk The Moon", "Shut Up and Dance"], ["Dua Lipa", "Levitating"],
  ["Queen", "Don't Stop Me Now"], ["Outkast", "Hey Ya!"], ["ABBA", "Dancing Queen"],
].map(([artist, song]) => ({ artist, song }));

export const SYNTHETIC_SIMILAR = [
  ["Big Boi", "Outkast", 0.9], ["American Authors", "Walk The Moon", 0.85], ["Grouplove", "Walk The Moon", 0.8], ["Mariah Carey", "Whitney Houston", 0.8],
  ["Ava Max", "Dua Lipa", 0.75], ["Zara Larsson", "Dua Lipa", 0.7], ["Toni Braxton", "Whitney Houston", 0.6], ["Snow Patrol", "The Killers", 0.6],
  ["The Beatles", "Queen", 0.55], ["KISS", "Queen", 0.5], ["The Pussycat Dolls", "Usher", 0.5], ["Tones and I", "Dua Lipa", 0.4],
].map(([artist, similarTo, match]) => ({ artist: artist as string, similarTo: similarTo as string, match: match as number }));

/** Saved user ratings for the 14 baseline additions — REPORTING ONLY. */
export const BASELINE_RATINGS: Record<string, string> = {
  "Bill Withers|Lovely Day": "Good", "Toni Braxton|Another Sad Love Song": "Unfamiliar", "Journey|Don't Stop Believin'": "Good",
  "KISS|I Was Made For Lovin' You": "Fair", "The Beatles|Let It Be": "Poor", "Mariah Carey|A No No": "Unfamiliar", "Ava Max|Freaking Me Out": "Unfamiliar",
  "Snow Patrol|Chasing Cars": "Poor", "American Authors|Best Day Of My Life": "Good", "Kool & The Gang|Celebration": "Good", "Grouplove|Tongue Tied": "Fair",
  "Zara Larsson|Don't Let Me Be Yours": "Unfamiliar", "ABBA|Mamma Mia": "Good", "Big Boi|All Night (Dirty)": "Unfamiliar",
};

const catalogue = new Map(SONG_LIBRARY.map(s => [songIdentity(s.artist, s.song), s]));
/** Saved-event metadata the user reported for two baseline rows (supersedes the cache snapshot when `saved` is true). */
export const SAVED_EVENT_ROWS: Record<string, object> = {
  "The Beatles|Let It Be": { genre: "Classic Rock", bpm: 138, energy: 4, danceability: 4, metaProv: { genre: "tags", bpm: "tags", energy: "ai", danceability: "ai" } },
  "Snow Patrol|Chasing Cars": { genre: "Alternative Rock", bpm: 104, energy: 6, danceability: 6, popularity: 8, metaProv: { genre: "tags", bpm: "tags", energy: "estimate", danceability: "estimate", popularity: "estimate" } },
};
export function candidates(saved = false): Candidate[] {
  return (rows as { artist: string; song: string; heldOut: boolean }[]).map(r0 => { const o = saved ? SAVED_EVENT_ROWS[`${r0.artist}|${r0.song}`] : undefined; return o ? { artist: r0.artist, song: r0.song, heldOut: r0.heldOut, ...o } : r0; }).map((r, i) => {
    const cat = catalogue.get(songIdentity(r.artist, r.song));
    const base = rowCandidate(r as never, cat ? "catalogue" : "ai");
    const facts = cat ? { ...base.facts, genre: cat.genre, genreSource: "catalogue" as const, decade: cat.decade, decadeSource: "catalogue" as const } : base.facts;
    return { ...base, facts, ref: i };
  });
}

export function input(fit: EventFit | undefined, saved = false): RecInput {
  return {
    candidates: candidates(saved), requests: REQUESTS, inEvent: REQUESTS, feedback: [], dismissed: [], similar: SYNTHETIC_SIMILAR,
    preferences: { genres: [], decades: ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"], artists: [], ...(fit ? { fit } : {}) },
    controls: DEFAULT_REC_CONTROLS, limit: 14,
  };
}
export const AFTER_FIT: EventFit = { familiarity: "familiar", avoidSlow: true };

export function runComparison(saved = false) {
  const before = recommend(input(undefined, saved)), after = recommend(input(AFTER_FIT, saved));
  return { before, after };
}

const label = (r: Recommendation) => `${r.artist} – ${r.song}`;
export function report(saved = false): string {
  const { before, after } = runComparison(saved);
  const all = rows as { artist: string; song: string; heldOut: boolean }[];
  const held = new Set(all.filter(r => r.heldOut).map(r => `${r.artist}|${r.song}`));
  const row = (r: Recommendation, i: number) => {
    const k = `${r.artist}|${r.song}`;
    return `| ${i + 1} | ${label(r)} | ${held.has(k) ? "held-out" : "baseline"} | ${BASELINE_RATINGS[k] ?? "—"} | ${r.score} | ${explainTop(r, 3).replace(/\|/g, "/")} |`;
  };
  const head = "| # | Track | Set | Saved rating (report only) | Score | Top reasons |\n|---|---|---|---|---|---|";
  const bk = new Set(before.items.map(label)), ak = new Set(after.items.map(label));
  return [
    `# Event-fit BEFORE/AFTER — identical explicit fixture${saved ? " (saved-event metadata for Let It Be / Chasing Cars)" : ""}`, "",
    `Pool: ${all.length} candidates (14 saved-baseline additions + ${held.size} held-out), evidence from a read-only snapshot of the metadata cache. Similarity entries are synthetic and identical in both runs. Only \`preferences.fit\` differs.`, "",
    "## BEFORE (no fit choice — legacy behaviour)", head, ...before.items.map(row), "",
    `Hidden: ${JSON.stringify(before.hidden)}`, "",
    `## AFTER (fit = ${JSON.stringify(AFTER_FIT)})`, head, ...after.items.map(row), "",
    `Hidden: ${JSON.stringify(after.hidden)}`, "",
    "## Changes", `Dropped: ${[...bk].filter(x => !ak.has(x)).join("; ") || "none"}`, "", `Added: ${[...ak].filter(x => !bk.has(x)).join("; ") || "none"}`, "",
  ].join("\n");
}
