/**
 * Deterministic metadata-TIMING comparison on ONE identical explicit fixture (NOT an exact replay, NOT live Mac generation).
 * Candidates are treated as owned-library rows, as in the saved run.
 * - OLD timing: owned rows reach ranking with file-tag facts only (energy/danceability/popularity absent), exactly what the
 *   route's pre-rank lookup gave owned rows before the fix; values were attached only after ranking.
 * - NEW timing: the same rows reach ranking with the facts the lookup returns (honest legacy sources: estimate/ai).
 * Evidence: tests/fit/realCacheRows.json plus the user-reported saved metadata for Let It Be / Chasing Cars. Similarity
 * entries are the same synthetic links as fitComparison. Ratings are attached for REPORTING ONLY.
 */
import rows from "./realCacheRows.json";
import { recommend, explainTop, DEFAULT_REC_CONTROLS, type Recommendation } from "../../src/lib/prep/recommend";
import { rowCandidate } from "../../src/lib/prep/expansionRanking";
import type { EventFit } from "../../src/lib/prep/eventFit";
import { REQUESTS, SYNTHETIC_SIMILAR, BASELINE_RATINGS, SAVED_EVENT_ROWS, AFTER_FIT } from "./fitComparison";

type Raw = { artist: string; song: string; heldOut: boolean; metaProv?: Record<string, string>; [k: string]: unknown };
/** Latest published fit rerun (user-reported): 10 retained baseline rows + 4 new rows not present in this fixture pool. */
export const PUBLISHED_RERUN_NEW = ["Stevie Wonder|Signed, Sealed, Delivered I'm Yours", "The Jackson 5|I Want You Back", "Bee Gees|Stayin' Alive (Clean Radio Edit)", "Harry Styles|As It Was"];
const REMOVED_IN_RERUN = new Set(["Toni Braxton|Another Sad Love Song", "Mariah Carey|A No No", "Zara Larsson|Don't Let Me Be Yours", "Kool & The Gang|Celebration"]);
export const PUBLISHED_RERUN = [...Object.keys(BASELINE_RATINGS).filter(k => !REMOVED_IN_RERUN.has(k)), ...PUBLISHED_RERUN_NEW];

const LATE = ["energy", "danceability", "popularity"] as const;
function pool(timing: "old" | "new") {
  return (rows as Raw[]).map(r0 => { const o = SAVED_EVENT_ROWS[`${r0.artist}|${r0.song}`]; return (o ? { artist: r0.artist, song: r0.song, heldOut: r0.heldOut, ...o } : r0) as Raw; }).map((r, i) => {
    let row: Raw = r;
    if (timing === "old") { row = { ...r, metaProv: { ...(r.metaProv ?? {}) } }; for (const k of LATE) { delete row[k]; delete row.metaProv![k]; } }
    return { ...rowCandidate(row as never, "library"), ref: i };
  });
}
const label = (r: Recommendation) => `${r.artist}|${r.song}`;
function run(timing: "old" | "new", fit: EventFit | undefined) {
  return recommend({ candidates: pool(timing), requests: REQUESTS, inEvent: REQUESTS, feedback: [], dismissed: [], similar: SYNTHETIC_SIMILAR,
    preferences: { genres: [], decades: ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"], artists: [], ...(fit ? { fit } : {}) }, controls: DEFAULT_REC_CONTROLS, limit: 999 });
}
export const TIMING_LIMITATIONS = [
  "Controlled fixture, not an exact replay of the saved run and not live native/Mac generation: the original full candidate pool was not captured.",
  "The 4 new rows of the published fit rerun are not in this pool (no captured metadata); their overlap is reported as not-in-pool, never invented.",
  "All energy/danceability/popularity values are legacy estimates/AI; they can lower ranks but never exclude, and are not ballad proof.",
  "Similarity links are synthetic and identical in every run. Ratings are reporting-only and never ranking input.",
];
export function timingData() {
  const variant = (fit: EventFit | undefined) => {
    const o = run("old", fit).items, n = run("new", fit).items;
    const rankOf = (xs: Recommendation[]) => new Map(xs.map((r, i) => [label(r), i + 1]));
    const ro = rankOf(o), rn = rankOf(n);
    const top = (xs: Recommendation[]) => xs.slice(0, 14).map(label);
    const overlap = (xs: string[], ref: string[]) => xs.filter(x => ref.includes(x)).length;
    const tally = (xs: string[]) => { const t: Record<string, number> = { Good: 0, Fair: 0, Poor: 0, Unfamiliar: 0, Unrated: 0 }; for (const x of xs) t[BASELINE_RATINGS[x] ?? "Unrated"]++; return t; };
    return {
      fit: fit ?? null,
      oldTop14: top(o), newTop14: top(n),
      overlapWithSavedBaseline14: { old: overlap(top(o), Object.keys(BASELINE_RATINGS)), new: overlap(top(n), Object.keys(BASELINE_RATINGS)) },
      overlapWithPublishedRerun14: { old: overlap(top(o), PUBLISHED_RERUN), new: overlap(top(n), PUBLISHED_RERUN), notInPool: PUBLISHED_RERUN_NEW.length },
      ratingsTop14ReportOnly: { old: tally(top(o)), new: tally(top(n)) },
      ranks: n.map(r => ({ track: label(r), oldRank: ro.get(label(r)) ?? null, newRank: rn.get(label(r))!, rating: BASELINE_RATINGS[label(r)] ?? null, newReasons: explainTop(r, 3) })),
    };
  };
  return { limitations: TIMING_LIMITATIONS, noFit: variant(undefined), fit: variant(AFTER_FIT) };
}
export function timingMarkdown(): string {
  const d = timingData();
  const sec = (name: string, v: ReturnType<typeof timingData>["fit"]) => [
    `## ${name}`, "",
    `Overlap with saved baseline 14: OLD ${v.overlapWithSavedBaseline14.old} → NEW ${v.overlapWithSavedBaseline14.new}. Overlap with published rerun 14: OLD ${v.overlapWithPublishedRerun14.old} → NEW ${v.overlapWithPublishedRerun14.new} (${v.overlapWithPublishedRerun14.notInPool} rerun rows not in pool).`, "",
    `Top-14 ratings (report only): OLD ${JSON.stringify(v.ratingsTop14ReportOnly.old)} → NEW ${JSON.stringify(v.ratingsTop14ReportOnly.new)}.`, "",
    "| Track | OLD rank | NEW rank | Rating (report only) | NEW reasons |", "|---|---|---|---|---|",
    ...v.ranks.map(r => `| ${r.track.replace("|", " – ")} | ${r.oldRank}${(r.oldRank ?? 99) <= 14 ? "*" : ""} | ${r.newRank}${r.newRank <= 14 ? "*" : ""} | ${r.rating ?? "—"} | ${r.newReasons.replace(/\|/g, "/")} |`), ""].join("\n");
  return ["# Metadata timing comparison (deterministic fixture, regenerated by tests)", "", "`*` = within the 14 selected additions.", "", "## Limitations", ...d.limitations.map(l => `- ${l}`), "", sec("No fit choices", d.noFit), sec(`Fit = ${JSON.stringify(AFTER_FIT)}`, d.fit)].join("\n");
}
