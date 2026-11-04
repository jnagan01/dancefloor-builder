/** Frozen pre-change scoring at 110eb351f30ecd03e61f830cbdf52666f16e8746; test/report only. */
import { attrSource, type ProvRow } from "../../../src/lib/prep/provenance";
import { sourceLabel, tierOf, type MetaSource } from "../../../src/lib/prep/metaConfidence";
import { additionKeys } from "../../../src/lib/additionIdentity";
import { SONG_LIBRARY } from "../../../src/lib/songLibrary";

/**
 * Optional, event-scoped "event fit" choices for AUTOMATIC additions and the preparation panel.
 * Absent (every legacy and fresh event) = no-op: ranking is byte-for-byte the previous behaviour.
 * Client requests are never candidates, so these choices can never remove or rewrite a request.
 *
 * Evidence rules (no fabricated metadata; unknown stays unknown and earns nothing):
 * - Guest familiarity uses only track-level, audience-wide evidence: a VERIFIED (exact-match) provider popularity for the
 *   track, or membership in the app's curated built-in crowd-standards catalogue (labelled as curation, not charts).
 *   File ownership, artist popularity, artist similarity and your personal play counts are NOT guest familiarity.
 * - Slow/ballad avoidance needs BOTH low energy and low danceability. Verified values (provider/measured/your edit/
 *   file tags) can exclude; estimates (AI, heuristics, catalogue feel values) only lower the score. BPM is never
 *   used: half/double-time tempo makes it unreliable for ballad detection.
 */
export type FamiliarityMode = "familiar" | "discovery";
export interface EventFit { familiarity?: FamiliarityMode; avoidSlow?: boolean }
export interface FitFacts {
  popularity?: number; popularitySource?: MetaSource;
  energy?: number; energySource?: MetaSource;
  danceability?: number; danceabilitySource?: MetaSource;
}

/** Strict reader for persisted inputs / backups / quality samples. Returns undefined for absent or empty choices. */
export function readEventFit(v: unknown): EventFit | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid event fit");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "familiarity" && k !== "avoidSlow") throw new Error("Invalid event fit");
  if (o.familiarity !== undefined && o.familiarity !== "familiar" && o.familiarity !== "discovery") throw new Error("Invalid event fit");
  if (o.avoidSlow !== undefined && typeof o.avoidSlow !== "boolean") throw new Error("Invalid event fit");
  return normalizeEventFit(o as EventFit);
}
/** Drops no-op fields so "nothing chosen" is always represented as undefined. */
export function normalizeEventFit(f: EventFit | undefined): EventFit | undefined {
  if (!f) return undefined;
  const out: EventFit = {};
  if (f.familiarity) out.familiarity = f.familiarity;
  if (f.avoidSlow) out.avoidSlow = true;
  return Object.keys(out).length ? out : undefined;
}

const num10 = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10 ? v : undefined;
/** Fit facts from a row's per-attribute provenance; legacy rows without provenance stay estimates. */
export function fitFactsFromRow(row: ProvRow): FitFacts | undefined {
  const f: FitFacts = {};
  for (const a of ["popularity", "energy", "danceability"] as const) {
    const v = num10(row[a]); const s = attrSource(row, a);
    if (v === undefined || s === "unknown") continue;
    f[a] = v; f[`${a}Source` as const] = s;
  }
  return Object.keys(f).length ? f : undefined;
}

const STRONG = new Set<MetaSource>(["provider", "measured", "user", "tags", "virtualdj"]);
/** Guest (audience-wide) popularity: ONLY a verified music-data-provider metric. User ratings, file tags, VirtualDJ
 *  and "measured" values are personal/local, never crowd data, so they are treated as unknown for familiarity. */
const POP_STRONG = new Set<MetaSource>(["provider"]);
const POP_ADVISORY = new Set<MetaSource>(["estimate", "ai", "catalogue"]);
/** Track-level strength: catalogue feel values are curated estimates, not measurements. */
const strength = (src: MetaSource | undefined, has: boolean, strong: Set<MetaSource> = STRONG): "strong" | "estimate" | "unknown" => {
  const t = tierOf(src, has);
  if (t === "unknown") return "unknown";
  return src && strong.has(src) ? "strong" : "estimate";
};
const popStrength = (src: MetaSource | undefined, has: boolean) => {
  const s = strength(src, has, POP_STRONG);
  return s === "estimate" && !(src && POP_ADVISORY.has(src)) ? "unknown" : s;
};

let catKeys: Set<string> | undefined;
/** Exact, version-aware membership in the built-in crowd-standards catalogue, independent of where the candidate came
 *  from (owned file, catalogue, AI). Live/remix/acoustic/extended descriptors are kept, so they never match the
 *  original; only clean/dirty/radio-edit labels and featured-credit brackets are ignored. */
export function inCrowdCatalogue(artist: string, song: string): boolean {
  catKeys ??= new Set(SONG_LIBRARY.flatMap(s => additionKeys(s.artist, s.song)));
  const keys = catKeys;
  return additionKeys(artist, song).some(k => keys.has(k));
}
/** Fit facts for a built-in catalogue entry: curated feel values, always labelled "catalogue" (advisory estimate). */
export function catalogueFitFacts(s: { energy?: number; danceability?: number }): FitFacts | undefined {
  const f: FitFacts = {};
  const e = num10(s.energy), d = num10(s.danceability);
  if (e !== undefined) { f.energy = e; f.energySource = "catalogue"; }
  if (d !== undefined) { f.danceability = d; f.danceabilitySource = "catalogue"; }
  return Object.keys(f).length ? f : undefined;
}

export interface FitResult {
  /** Reason the candidate is excluded (strong evidence only), else undefined. */ exclude?: string;
  /** Evidence lines to add (points may be negative). */ lines: { kind: "familiarTrack" | "unfamiliarTrack" | "slowEstimate" | "discoveryTrack"; text: string; points: number }[];
  /** True when there is positive track-level guest-familiarity evidence (used to keep similarity from dominating). */ familiarEvidence: boolean;
  /** Plain statements of what an active choice could NOT verify for this track (shown, never scored). */ uncertain?: string[];
  /** Active advisory low-both risk bounds ALL similarity points together, never excludes. */ similarityCap?: number;
}

export function evaluateFit(fit: EventFit | undefined, c: { origin: "library" | "catalogue" | "ai"; artist?: string; song?: string; fit?: FitFacts }): FitResult {
  const r: FitResult = { lines: [], familiarEvidence: false };
  if (!fit) return r;
  const f = c.fit ?? {};
  const pop = f.popularity, ps = popStrength(f.popularitySource, pop !== undefined);
  const popText = (p: number, s: MetaSource | undefined) => `Track popularity ${Math.round(p)}/10 (${sourceLabel(s)}, audience-wide)`;
  if (fit.familiarity === "familiar") {
    if (pop !== undefined && ps === "strong") {
      if (pop >= 7) { r.lines.push({ kind: "familiarTrack", text: `${popText(pop, f.popularitySource)} supports guest familiarity`, points: 2 }); r.familiarEvidence = true; }
      else if (pop >= 5) { r.lines.push({ kind: "familiarTrack", text: `${popText(pop, f.popularitySource)}: moderate familiarity evidence`, points: 0.75 }); r.familiarEvidence = true; }
      else if (pop <= 3) r.lines.push({ kind: "unfamiliarTrack", text: `${popText(pop, f.popularitySource)}: evidence it is not widely known`, points: -1.5 });
    } else if (pop !== undefined && ps === "estimate" && pop >= 7) {
      // Advisory only: small bonus, never treated as familiarity evidence that lifts similarity.
      r.lines.push({ kind: "familiarTrack", text: `${popText(pop, f.popularitySource)} (advisory estimate)`, points: 0.35 });
    }
    if (c.origin === "catalogue" || (c.artist && c.song && inCrowdCatalogue(c.artist, c.song))) { r.lines.push({ kind: "familiarTrack", text: "In the built-in crowd-standards catalogue (app curation, not chart data)", points: 1 }); r.familiarEvidence = true; }
  } else if (fit.familiarity === "discovery" && pop !== undefined && ps === "strong") {
    if (pop <= 5) r.lines.push({ kind: "discoveryTrack", text: `${popText(pop, f.popularitySource)}: less-common pick (discovery)`, points: 0.75 });
    else if (pop >= 8) r.lines.push({ kind: "discoveryTrack", text: `${popText(pop, f.popularitySource)}: very familiar, less of a discovery`, points: -0.75 });
  }
  if (fit.avoidSlow) {
    const e = f.energy, d = f.danceability;
    const es = strength(f.energySource, e !== undefined), ds = strength(f.danceabilitySource, d !== undefined);
    const lowE = e !== undefined && e <= 4, lowD = d !== undefined && d <= 4;
    if (lowE && lowD && es === "strong" && ds === "strong") r.exclude = `Low energy ${e}/10 and danceability ${d}/10 (${sourceLabel(f.energySource)}) — slow/ballad additions avoided for this event`;
    else if (lowE && lowD && es !== "unknown" && ds !== "unknown") {
      r.lines.push({ kind: "slowEstimate", text: `Energy ${e}/10 (${sourceLabel(f.energySource)}) and danceability ${d}/10 (${sourceLabel(f.danceabilitySource)}) suggest low-both slow risk — ranked lower, not confirmed slow (advisory)`, points: -3 });
      r.similarityCap = 1;
    }
    const conflict = e !== undefined && d !== undefined && ((e <= 4 && d >= 7) || (d <= 4 && e >= 7));
    if (conflict) (r.uncertain ??= []).push(`Energy ${e}/10 (${sourceLabel(f.energySource)}) and danceability ${d}/10 (${sourceLabel(f.danceabilitySource)}) conflict for slow avoidance: a groove is possible; not classified slow or penalised`);
    // Positive estimates cannot rescue questionable/unknown fit. Verified popularity still describes recognition,
    // not dance suitability; retain half of its familiarity points when upbeat support is absent.
    const supported = e !== undefined && d !== undefined && es !== "unknown" && ds !== "unknown" && e >= 5 && d >= 5 && (e >= 7 || d >= 7);
    for (const l of r.lines) if (l.kind === "familiarTrack" && l.points > 0 && /Track popularity/.test(l.text) && !supported) {
      if (ps === "estimate") { l.points = 0; (r.uncertain ??= []).push("Estimated popularity adds no familiarity points: upbeat fit is unknown, conflicting or weakly supported"); }
      else { l.points /= 2; l.text += " — counted half: recognition does not prove upbeat dance fit"; }
    }
    if (pop !== undefined && ps === "strong") (r.uncertain ??= []).push("Verified popularity supports recognition, not slow/ballad or dance suitability");
    if (!r.exclude && (es !== "strong" || ds !== "strong")) (r.uncertain ??= []).push(e === undefined && d === undefined ? "Slow/ballad status unknown: no energy or danceability data" : "Slow/ballad status unverified: energy/danceability are estimates or incomplete");
  }
  if (fit.familiarity === "familiar" && !r.familiarEvidence) (r.uncertain ??= []).push(pop === undefined || ps === "unknown" ? `Guest familiarity unknown: ${pop === undefined ? "no track popularity data" : `popularity ${Math.round(pop)}/10 is ${sourceLabel(f.popularitySource)}, not audience data`}` : `Guest familiarity unverified: popularity ${Math.round(pop)}/10 is ${ps === "estimate" ? "an estimate" : "not supportive"}`);
  return r;
}

/**
 * Conservative note reading: only SUGGESTS choices the user must apply explicitly. Never filters titles by keywords
 * and never applies anything automatically.
 */
export function suggestFitFromNotes(notes: string): EventFit | undefined {
  const t = notes.toLowerCase();
  const out: EventFit = {};
  if (/\b(familiar|crowd[- ]?pleas\w*|well[- ]known|sing[- ]?along|party favou?rites?|classic hits)\b/.test(t)) out.familiarity = "familiar";
  if (/\b(no|avoid|skip|without)\s+([\w-]+,?\s+){0,4}?(slow(\s+(songs?|ballads?))?|ballads?)\b/.test(t)) out.avoidSlow = true;
  return normalizeEventFit(out);
}
