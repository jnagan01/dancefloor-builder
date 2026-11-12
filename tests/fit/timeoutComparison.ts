import { trackCell } from "./markdownCell";
/**
 * Deterministic metadata-TIMEOUT comparison on the SAME archived 31-candidate fixture as timingComparison (tests/fit/
 * realCacheRows.json + user-reported saved rows). NOT an exact replay of the saved run and NOT live native/Mac generation.
 *
 * Scenario (fake clock, identical for BEFORE and AFTER; partition by fixture index, never by title):
 * - index % 3 !== 2: fresh cache rows carrying the fixture's own values and per-field provenance (no provider upgrade).
 * - index % 3 === 2: cache misses whose provider lookups never reply (cannot be aborted).
 * - the cache read answers after 1s; the AI estimate never answers; the cache write never answers.
 * - songs go through the real client gatherer (20s per-chunk cutoff) in one chunk of 31.
 * BEFORE = archived f009f0a pipeline; AFTER = current pipeline. Facts that reached the client are merged onto tag-only rows
 * (energy/danceability/popularity removed, as owned rows had before lookup) and ranked by the real recommend().
 * Ratings are attached for REPORTING ONLY.
 */
import { vi } from "vitest";
import rows from "./realCacheRows.json";
import { recommend, DEFAULT_REC_CONTROLS, type Recommendation } from "./archived/recommend.543920d";
import { rowCandidate } from "../../src/lib/prep/expansionRanking";
import { mergeMeta, encodeCacheSource, decodeCacheSource } from "../../src/lib/prep/provenance";
import { normalizeKey } from "../../src/lib/danceFloor";
import { createFactsGatherer, factsKey, FACTS_TIMEOUT_MS } from "../../src/lib/prep/factsGather";
import { runEnrichment as afterRun, type CacheRow, type EnrichedSong } from "../../src/lib/enrichPipeline.server";
import { runEnrichment as beforeRun } from "./archived/enrichPipeline.f009f0a";
import { REQUESTS, SYNTHETIC_SIMILAR, BASELINE_RATINGS, SAVED_EVENT_ROWS, AFTER_FIT } from "./fitComparison";
import type { EventFit } from "../../src/lib/prep/eventFit";

type Raw = { artist: string; song: string; heldOut: boolean; metaProv?: Record<string, string>; [k: string]: unknown };
const LATE = ["energy", "danceability", "popularity"] as const;
const fixture = (): Raw[] => (rows as Raw[]).map(r0 => { const o = SAVED_EVENT_ROWS[`${r0.artist}|${r0.song}`]; return (o ? { artist: r0.artist, song: r0.song, heldOut: r0.heldOut, ...o } : r0) as Raw; });
const hung = (i: number) => i % 3 === 2;

function cacheRows(): CacheRow[] {
  return fixture().flatMap((r, i) => hung(i) ? [] : [{
    artist_key: normalizeKey(r.artist), song_key: normalizeKey(r.song),
    energy: (r.energy as number) ?? null, danceability: (r.danceability as number) ?? null, valence: null, popularity: (r.popularity as number) ?? null,
    bpm: (r.bpm as number) ?? null, camelot: null, genre: (r.genre as string) ?? null, year: (r.year as number) ?? null,
    source: encodeCacheSource("ReccoBeats", (r.metaProv ?? {}) as never), fetched_at: new Date().toISOString(),
  }]);
}

async function gatherWith(impl: "before" | "after") {
  vi.useFakeTimers();
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
  try {
    const deps = {
      readRows: () => new Promise<CacheRow[]>((res) => setTimeout(() => res(cacheRows()), 1000)),
      upsert: () => new Promise<void>(() => {}),
      estimate: () => new Promise<never>(() => {}),
    };
    const fn = impl === "after" ? (s: Array<{ artist: string; song: string }>) => afterRun(s, deps as never) : (s: Array<{ artist: string; song: string }>) => beforeRun(s, deps as never);
    // Freeze this historical comparison's original one-chunk protocol; new scheduling has separate evidence.
    const g = createFactsGatherer<EnrichedSong>(async (s) => (await fn(s)).results, factsKey, { batchSize: 200, concurrency: 2, isIncomplete: (e) => !!e.incomplete });
    const list = fixture().map(r => ({ artist: r.artist, song: r.song }));
    const run = g.gather(list);
    await vi.advanceTimersByTimeAsync(FACTS_TIMEOUT_MS + 5000);
    const report = await run;
    return { report, got: list.map(s => g.get(s)) };
  } finally {
    globalThis.fetch = prevFetch;
    vi.useRealTimers();
  }
}

const label = (r: { artist: string; song: string }) => `${r.artist}|${r.song}`;
async function variantData(impl: "before" | "after") {
  const { report, got } = await gatherWith(impl);
  const base = fixture().map(r => { const row: Raw = { ...r, metaProv: { ...(r.metaProv ?? {}) } }; for (const k of LATE) { delete row[k]; delete row.metaProv![k]; } return row; });
  const merged = base.map((row, i) => { const e = got[i]; return e && e.source !== "none" ? mergeMeta(row as never, e as never, e.prov ?? decodeCacheSource(e.source, e as never).prov) as Raw : row; });
  const coverage = {
    energyAndDanceability: merged.filter(r => r.energy != null && r.danceability != null).length,
    popularity: merged.filter(r => r.popularity != null).length,
    of: merged.length,
    completedCacheFactsAvailable: fixture().filter((r, i) => !hung(i) && r.energy != null).length,
  };
  const rank = (fit: EventFit | undefined) => recommend({
    candidates: merged.map((r, i) => ({ ...rowCandidate(r as never, "library"), ref: i })), requests: REQUESTS, inEvent: REQUESTS, feedback: [], dismissed: [], similar: SYNTHETIC_SIMILAR,
    preferences: { genres: [], decades: ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"], artists: [], ...(fit ? { fit } : {}) }, controls: DEFAULT_REC_CONTROLS, limit: 999,
  }).items;
  return { report, coverage, noFit: rank(undefined), fit: rank(AFTER_FIT) };
}

export const TIMEOUT_LIMITATIONS = [
  "Controlled fixture with deterministic fake delays, not an exact replay of the saved run and not live native/Mac generation; the original full candidate pool was not captured.",
  "Same 31 archived candidates/evidence as timing.json; which rows hang is decided by fixture index (every third), never by title or rating.",
  "Cached values keep the fixture's own legacy provenance (estimate/ai); nothing is upgraded to provider and hung rows stay unknown.",
  "Similarity links are synthetic and identical in every run. Ratings are reporting-only and never ranking input.",
];
export async function timeoutData() {
  const b = await variantData("before"), a = await variantData("after");
  const top = (xs: Recommendation[]) => xs.slice(0, 14).map(label);
  const tally = (xs: string[]) => { const t: Record<string, number> = { Good: 0, Fair: 0, Poor: 0, Unfamiliar: 0, Unrated: 0 }; for (const x of xs) t[BASELINE_RATINGS[x] ?? "Unrated"]++; return t; };
  const overlap = (xs: string[]) => xs.filter(x => x in BASELINE_RATINGS).length;
  const side = (fitKey: "noFit" | "fit") => {
    const ro = new Map(b[fitKey].map((r, i) => [label(r), i + 1])), rn = new Map(a[fitKey].map((r, i) => [label(r), i + 1]));
    return {
      beforeTop14: top(b[fitKey]), afterTop14: top(a[fitKey]),
      overlapWithSavedBaseline14: { before: overlap(top(b[fitKey])), after: overlap(top(a[fitKey])) },
      ratingsTop14ReportOnly: { before: tally(top(b[fitKey])), after: tally(top(a[fitKey])) },
      ranks: a[fitKey].map(r => ({ track: label(r), beforeRank: ro.get(label(r)) ?? null, afterRank: rn.get(label(r))!, rating: BASELINE_RATINGS[label(r)] ?? null })),
    };
  };
  return {
    limitations: TIMEOUT_LIMITATIONS,
    gather: { before: b.report, after: a.report },
    coverage: { before: b.coverage, after: a.coverage },
    noFit: side("noFit"), fit: { choices: AFTER_FIT, ...side("fit") },
  };
}
export async function timeoutMarkdown(): Promise<string> {
  const d = await timeoutData();
  const g = (r: typeof d.gather.before) => `found ${r.found}/${r.requested}, timed out ${r.timedOutSongs}, incomplete ${r.incompleteSongs}`;
  const c = (x: typeof d.coverage.before) => `energy+danceability ${x.energyAndDanceability}/${x.of}, popularity ${x.popularity}/${x.of}`;
  const sec = (name: string, v: typeof d.noFit) => [`## ${name}`, "",
    `Overlap with saved baseline 14: BEFORE ${v.overlapWithSavedBaseline14.before} → AFTER ${v.overlapWithSavedBaseline14.after}.`,
    `Top-14 ratings (report only): BEFORE ${JSON.stringify(v.ratingsTop14ReportOnly.before)} → AFTER ${JSON.stringify(v.ratingsTop14ReportOnly.after)}.`, "",
    "| Track | BEFORE rank | AFTER rank | Rating (report only) |", "|---|---|---|---|",
    ...v.ranks.map(r => `| ${trackCell(r.track)} | ${r.beforeRank}${(r.beforeRank ?? 99) <= 14 ? "*" : ""} | ${r.afterRank}${r.afterRank <= 14 ? "*" : ""} | ${r.rating ?? "—"} |`), ""].join("\n");
  return ["# Metadata timeout comparison (deterministic fixture, regenerated by tests)", "", "`*` = within the 14 selected additions.", "", "## Limitations", ...d.limitations.map(l => `- ${l}`), "",
    "## Lookup outcome", "", `- BEFORE (archived f009f0a pipeline): ${g(d.gather.before)}; ${c(d.coverage.before)}.`, `- AFTER (end-to-end deadlines): ${g(d.gather.after)}; ${c(d.coverage.after)}.`, `- Completed cache facts available in the scenario: ${d.coverage.after.completedCacheFactsAvailable}.`, "",
    sec("No fit choices", d.noFit), sec(`Fit = ${JSON.stringify(d.fit.choices)}`, d.fit)].join("\n");
}
