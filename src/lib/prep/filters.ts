import { cleanBpm, type VdjTrack } from "@/lib/virtualDj";

/** Unknown values are never guessed: each field says whether unknowns are kept, dropped or the only ones shown. */
export type UnknownMode = "include" | "exclude" | "only";
export type FilterContext = "library" | "recommendation";
export type CleanValue = "clean" | "explicit";
export type FieldSource = "tags" | "virtualdj" | "filename" | "estimate" | "catalogue";

export interface FilterState {
  genres: string[]; genreUnknown: UnknownMode;
  decades: string[]; decadeUnknown: UnknownMode;
  bpm: [number, number] | null; bpmUnknown: UnknownMode;
  duration: [number, number] | null; durationUnknown: UnknownMode; // seconds
  energy: [number, number] | null; energyUnknown: UnknownMode; // recommendation context only
  clean: CleanValue | null; cleanUnknown: UnknownMode;
  owned: "owned" | "notOwned" | null; // recommendation context only
}
export const EMPTY_FILTER: FilterState = {
  genres: [], genreUnknown: "include", decades: [], decadeUnknown: "include",
  bpm: null, bpmUnknown: "include", duration: null, durationUnknown: "include",
  energy: null, energyUnknown: "include", clean: null, cleanUnknown: "include", owned: null,
};

/** Facts a filter can test. `undefined` always means unknown. */
export interface FilterFacts {
  genre?: string; decade?: string; bpm?: number; durationSec?: number; energy?: number;
  clean?: CleanValue; cleanSource?: FieldSource; owned?: boolean;
}

const CLEAN_RE = /(?:^|[\s([_-])(clean(?:\s+(?:edit|version))?|radio\s+clean)(?=$|[\s)\]_.-])/i;
const EXPLICIT_RE = /(?:^|[\s([_-])(dirty|explicit|uncensored)(?=$|[\s)\]_.-])/i;
/** Labels from title/remix/filename text are inferred, never verified. */
export function inferCleanFromText(...texts: (string | undefined)[]): CleanValue | undefined {
  const text = texts.filter(Boolean).join(" ");
  const c = CLEAN_RE.test(text), e = EXPLICIT_RE.test(text);
  if (c === e) return undefined; // neither, or contradictory → unknown
  return c ? "clean" : "explicit";
}

export const normGenre = (g?: string) => (g ?? "").trim().replace(/\s+/g, " ");
const decadeOf = (t: VdjTrack) => t.decade || (t.year && /^\d{4}/.test(t.year) ? `${t.year.slice(0, 3)}0s` : undefined);

export function trackFacts(t: VdjTrack): FilterFacts {
  const bpm = Number(cleanBpm(t.bpm));
  const len = Number(t.songLength);
  const base = (t.filePath.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");
  const clean = inferCleanFromText(t.title, t.remix, base);
  return {
    genre: normGenre(t.genre) || undefined, decade: decadeOf(t),
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : undefined,
    durationSec: Number.isFinite(len) && len > 0 ? len : undefined,
    energy: undefined, // local files carry no energy; never derived from BPM
    clean, cleanSource: clean ? "filename" : undefined, owned: true,
  };
}

function unknownGate(mode: UnknownMode, known: boolean): boolean | null {
  if (!known) return mode !== "exclude";
  if (mode === "only") return false;
  return null; // known value: defer to the value test
}
const inRange = (v: number, r: [number, number] | null) => !r || (v >= r[0] && v <= r[1]);

export function matchesFilter(f: FacetsLike, s: FilterState, ctx: FilterContext): boolean {
  const g = unknownGate(s.genreUnknown, f.genre !== undefined);
  if (g === false || (g === null && s.genres.length && !s.genres.some(x => x.toLowerCase() === f.genre!.toLowerCase()))) return false;
  const d = unknownGate(s.decadeUnknown, f.decade !== undefined);
  if (d === false || (d === null && s.decades.length && !s.decades.includes(f.decade!))) return false;
  const b = unknownGate(s.bpmUnknown, f.bpm !== undefined);
  if (b === false || (b === null && !inRange(f.bpm!, s.bpm))) return false;
  const du = unknownGate(s.durationUnknown, f.durationSec !== undefined);
  if (du === false || (du === null && !inRange(f.durationSec!, s.duration))) return false;
  const c = unknownGate(s.cleanUnknown, f.clean !== undefined);
  if (c === false || (c === null && s.clean && f.clean !== s.clean)) return false;
  if (ctx === "recommendation") {
    const e = unknownGate(s.energyUnknown, f.energy !== undefined);
    if (e === false || (e === null && !inRange(f.energy!, s.energy))) return false;
    if (s.owned === "owned" && f.owned !== true) return false;
    if (s.owned === "notOwned" && f.owned !== false) return false;
  }
  return true;
}
type FacetsLike = FilterFacts;

export interface Chip { id: keyof FilterState; label: string }
const unk = (m: UnknownMode) => m === "include" ? "" : m === "exclude" ? " · unknown excluded" : "unknown only";
const join = (value: string, m: UnknownMode) => m === "only" ? unk(m) : value + unk(m);
export function activeChips(s: FilterState, ctx: FilterContext): Chip[] {
  const out: Chip[] = [];
  if (s.genres.length || s.genreUnknown !== "include") out.push({ id: "genres", label: `Genre: ${join(s.genres.join(", ") || "any", s.genreUnknown)}` });
  if (s.decades.length || s.decadeUnknown !== "include") out.push({ id: "decades", label: `Decade: ${join(s.decades.join(", ") || "any", s.decadeUnknown)}` });
  if (s.bpm || s.bpmUnknown !== "include") out.push({ id: "bpm", label: `BPM: ${join(s.bpm ? `${s.bpm[0]}–${s.bpm[1]}` : "any", s.bpmUnknown)}` });
  if (s.duration || s.durationUnknown !== "include") out.push({ id: "duration", label: `Length: ${join(s.duration ? `${fmtDur(s.duration[0])}–${fmtDur(s.duration[1])}` : "any", s.durationUnknown)}` });
  if (s.clean || s.cleanUnknown !== "include") out.push({ id: "clean", label: `Clean/explicit: ${join(s.clean ?? "any", s.cleanUnknown)}` });
  if (ctx === "recommendation") {
    if (s.energy || s.energyUnknown !== "include") out.push({ id: "energy", label: `Energy: ${join(s.energy ? `${s.energy[0]}–${s.energy[1]}` : "any", s.energyUnknown)}` });
    if (s.owned) out.push({ id: "owned", label: s.owned === "owned" ? "Owned files only" : "Not owned only" });
  }
  return out;
}
export function clearChip(s: FilterState, id: keyof FilterState): FilterState {
  const n = { ...s };
  switch (id) {
    case "genres": n.genres = []; n.genreUnknown = "include"; break;
    case "decades": n.decades = []; n.decadeUnknown = "include"; break;
    case "bpm": n.bpm = null; n.bpmUnknown = "include"; break;
    case "duration": n.duration = null; n.durationUnknown = "include"; break;
    case "clean": n.clean = null; n.cleanUnknown = "include"; break;
    case "energy": n.energy = null; n.energyUnknown = "include"; break;
    case "owned": n.owned = null; break;
  }
  return n;
}
export function fmtDur(sec: number) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return `${m}:${String(s).padStart(2, "0")}`; }

/** Option lists drawn only from values that exist, with counts; unknown counted separately. */
export function facetOptions(facts: FilterFacts[]) {
  const genres = new Map<string, { label: string; n: number }>(), decades = new Map<string, number>();
  let genreUnknown = 0, decadeUnknown = 0, bpmKnown = 0, durationKnown = 0, cleanKnown = 0, energyKnown = 0, owned = 0;
  for (const f of facts) {
    if (f.genre) { const k = f.genre.toLowerCase(); const e = genres.get(k); if (e) e.n++; else genres.set(k, { label: f.genre, n: 1 }); } else genreUnknown++;
    if (f.decade) decades.set(f.decade, (decades.get(f.decade) ?? 0) + 1); else decadeUnknown++;
    if (f.bpm !== undefined) bpmKnown++;
    if (f.durationSec !== undefined) durationKnown++;
    if (f.clean) cleanKnown++;
    if (f.energy !== undefined) energyKnown++;
    if (f.owned) owned++;
  }
  return {
    genres: [...genres.values()].sort((a, b) => b.n - a.n).slice(0, 200),
    decades: [...decades.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, n]) => ({ label, n })),
    genreUnknown, decadeUnknown, total: facts.length, bpmKnown, durationKnown, cleanKnown, energyKnown, owned,
  };
}

const MODES: UnknownMode[] = ["include", "exclude", "only"];
const range = (v: unknown, lo: number, hi: number): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every(n => typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi) && v[0] <= v[1] ? [v[0], v[1]] : null;
/** Sanitize persisted filters; anything malformed falls back to the neutral value. */
export function readFilter(v: unknown): FilterState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const mode = (k: string): UnknownMode => MODES.includes(o[k] as UnknownMode) ? o[k] as UnknownMode : "include";
  const strs = (k: string) => Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string" && x.length <= 200).slice(0, 100) : [];
  return {
    genres: strs("genres"), genreUnknown: mode("genreUnknown"), decades: strs("decades"), decadeUnknown: mode("decadeUnknown"),
    bpm: range(o.bpm, 0, 400), bpmUnknown: mode("bpmUnknown"), duration: range(o.duration, 0, 7200), durationUnknown: mode("durationUnknown"),
    energy: range(o.energy, 0, 10), energyUnknown: mode("energyUnknown"),
    clean: o.clean === "clean" || o.clean === "explicit" ? o.clean : null, cleanUnknown: mode("cleanUnknown"),
    owned: o.owned === "owned" || o.owned === "notOwned" ? o.owned : null,
  };
}
