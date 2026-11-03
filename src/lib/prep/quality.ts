/**
 * Recommendation quality review samples. Separate from saved events and the music library: a sample is a small,
 * frozen copy of a recommendation list and the request/context it was ranked for, plus the user's own ratings.
 * Stored only inside the account-scoped preparation notes (optional `quality` field; absent in older data).
 * No file paths or file identities are stored. Ratings never change Never/favourite feedback or event rows.
 */
export type QualityRating = "good" | "maybe" | "poor";
export const QUALITY_RATINGS: { value: QualityRating; label: string }[] = [{ value: "good", label: "Good fit" }, { value: "maybe", label: "Maybe" }, { value: "poor", label: "Poor fit" }];
type Src = "tags" | "virtualdj" | "filename" | "estimate" | "catalogue" | "ai" | "provider" | "user" | "measured";
const SOURCES: Src[] = ["tags", "virtualdj", "filename", "estimate", "catalogue", "ai", "provider", "user", "measured"];
export interface QualityCandidate {
  artist: string; song: string; origin: "library" | "catalogue" | "ai";
  genre?: string; genreSource?: Src; decade?: string; decadeSource?: Src; owned?: boolean; playCount?: number;
  /** Requested tracks Last.fm listed this exact track as similar to, and the best match value. */
  lastfmSeeds?: string[]; lastfmMatch?: number;
  /** Artist-level Last.fm similarity at capture time. */ similarTo?: string; similarMatch?: number;
  tags?: string[]; favored?: boolean;
  /** Deterministic tie order among captured files with equal score/artist/title (an ordinal, never a path). */
  tie?: number;
  /** Score when captured, to detect a genuine ranking change on replay. */
  score?: number;
  rating?: QualityRating;
}
export interface QualityControls { familiarity: number; clientSimilarity: number; artistVariety: number; ownedOnly: boolean }
export interface QualityRequest { artist: string; song: string; genre?: string; decade?: string }
export interface QualitySample {
  id: string; name: string; createdAt: number;
  requests: QualityRequest[]; preferences: { genres: string[]; decades: string[]; artists: string[] }; eventTags: string[];
  candidates: QualityCandidate[];
  /** Ranking controls active at capture. Absent on samples saved before full context was recorded. */
  controls?: QualityControls;
  /** Per-artist counts already in the event at capture (artist names only), for artist variety. */
  artistUse?: { artist: string; count: number }[];
  /** True when context exceeded storage limits, so an exact replay is impossible and comparison is unavailable. */
  truncated?: boolean;
}
export const QUALITY_LIMITS = { samples: 30, candidates: 20, requests: 300, prefs: 30, seeds: 20, tags: 30, text: 300, artists: 300 };

const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !v.includes("\0") ? v : null;
const strs = (v: unknown, maxLen: number, maxEach: number): string[] => { if (!Array.isArray(v) || v.length > maxLen) throw 0; return v.map(x => { const s = str(x, maxEach); if (s === null) throw 0; return s; }); };
const finite = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const DECADE = /^\d{4}s$/;
const opt = <T,>(o: Record<string, unknown>, k: string, ok: (v: unknown) => boolean, out: Record<string, unknown>) => { if (o[k] === undefined) return; if (!ok(o[k])) throw 0; out[k] = o[k] as T; };

function readCandidate(v: unknown): QualityCandidate {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
  const o = v as Record<string, unknown>;
  const artist = str(o.artist, QUALITY_LIMITS.text), song = str(o.song, QUALITY_LIMITS.text);
  if (artist === null || song === null || (o.origin !== "library" && o.origin !== "catalogue" && o.origin !== "ai")) throw 0;
  const out: Record<string, unknown> = { artist, song, origin: o.origin };
  opt(o, "genre", x => str(x, 60) !== null, out);
  opt(o, "genreSource", x => SOURCES.includes(x as Src), out);
  opt(o, "decade", x => typeof x === "string" && DECADE.test(x), out);
  opt(o, "decadeSource", x => SOURCES.includes(x as Src), out);
  opt(o, "owned", x => typeof x === "boolean", out);
  opt(o, "playCount", x => finite(x, 0, 1e7) && Number.isInteger(x), out);
  if (o.lastfmSeeds !== undefined) out.lastfmSeeds = strs(o.lastfmSeeds, QUALITY_LIMITS.seeds, QUALITY_LIMITS.text);
  opt(o, "lastfmMatch", x => finite(x, 0, 1), out);
  opt(o, "similarTo", x => str(x, QUALITY_LIMITS.text) !== null, out);
  opt(o, "similarMatch", x => finite(x, 0, 1), out);
  if (o.tags !== undefined) out.tags = strs(o.tags, QUALITY_LIMITS.tags, 60);
  opt(o, "favored", x => typeof x === "boolean", out);
  opt(o, "tie", x => finite(x, 0, 1000) && Number.isInteger(x), out);
  opt(o, "score", x => finite(x, -1000, 1000), out);
  opt(o, "rating", x => QUALITY_RATINGS.some(r => r.value === x), out);
  return out as unknown as QualityCandidate;
}

/** Strict, bounded read; throws on anything unexpected so the caller keeps the original bytes untouched. */
export function readQualitySamples(v: unknown): QualitySample[] {
  if (!Array.isArray(v) || v.length > QUALITY_LIMITS.samples) throw 0;
  const ids = new Set<string>();
  return v.map(x => {
    if (!x || typeof x !== "object" || Array.isArray(x)) throw 0;
    const o = x as Record<string, unknown>;
    const id = str(o.id, 80), name = str(o.name, 120);
    if (!id || ids.has(id) || name === null || !finite(o.createdAt, 0, 1e15)) throw 0;
    ids.add(id);
    if (!Array.isArray(o.requests) || o.requests.length > QUALITY_LIMITS.requests) throw 0;
    const requests = o.requests.map(r => {
      const q = r as Record<string, unknown>; const artist = str(q?.artist, QUALITY_LIMITS.text), song = str(q?.song, QUALITY_LIMITS.text);
      if (artist === null || song === null) throw 0;
      const out: Record<string, unknown> = { artist, song };
      opt(q, "genre", y => str(y, 60) !== null, out); opt(q, "decade", y => typeof y === "string" && DECADE.test(y), out);
      return out as unknown as QualityRequest;
    });
    const p = o.preferences as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") throw 0;
    const preferences = { genres: strs(p.genres, QUALITY_LIMITS.prefs, 60), decades: strs(p.decades, QUALITY_LIMITS.prefs, 20), artists: strs(p.artists, QUALITY_LIMITS.prefs, QUALITY_LIMITS.text) };
    const eventTags = strs(o.eventTags, QUALITY_LIMITS.tags, 60);
    if (!Array.isArray(o.candidates) || o.candidates.length < 1 || o.candidates.length > QUALITY_LIMITS.candidates) throw 0;
    const out: QualitySample = { id, name, createdAt: o.createdAt as number, requests, preferences, eventTags, candidates: o.candidates.map(readCandidate) };
    if (o.controls !== undefined) {
      const c = o.controls as Record<string, unknown>;
      if (!c || typeof c !== "object" || !finite(c.familiarity, -1, 1) || !finite(c.clientSimilarity, 0, 1) || !finite(c.artistVariety, 0, 1) || typeof c.ownedOnly !== "boolean" || Object.keys(c).length !== 4) throw 0;
      out.controls = { familiarity: c.familiarity as number, clientSimilarity: c.clientSimilarity as number, artistVariety: c.artistVariety as number, ownedOnly: c.ownedOnly };
    }
    if (o.artistUse !== undefined) {
      if (!Array.isArray(o.artistUse) || o.artistUse.length > QUALITY_LIMITS.artists) throw 0;
      out.artistUse = o.artistUse.map(a => { const artist = str(a?.artist, QUALITY_LIMITS.text); if (artist === null || !finite(a?.count, 1, 10000) || !Number.isInteger(a.count)) throw 0; return { artist, count: a.count }; });
    }
    if (o.truncated !== undefined) { if (typeof o.truncated !== "boolean") throw 0; out.truncated = o.truncated; }
    return out;
  });
}

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
type WithQuality = { quality?: QualitySample[] };

/** Adds a sample (always unrated). Input is bounded/validated; nothing else in the knowledge changes. */
export function addQualitySample<K extends WithQuality>(k: K, s: Omit<QualitySample, "id" | "createdAt">): K {
  const list = k.quality ?? [];
  if (list.length >= QUALITY_LIMITS.samples) throw Error(`You can keep up to ${QUALITY_LIMITS.samples} review samples. Delete one first.`);
  const name = s.name.replace(/[\r\n\t]+/g, " ").trim().slice(0, 120) || "Recommendation sample";
  const unrated = s.candidates.slice(0, QUALITY_LIMITS.candidates).map(c => { const { rating: _r, ...rest } = c; return rest; });
  if (!unrated.length) throw Error("There are no recommendations to review yet.");
  // Context beyond limits is never silently dropped: the sample is marked so comparisons say they are unavailable.
  const truncated = s.truncated || s.requests.length > QUALITY_LIMITS.requests || (s.artistUse?.length ?? 0) > QUALITY_LIMITS.artists || s.candidates.length > QUALITY_LIMITS.candidates;
  const sample: QualitySample = { ...structuredClone({ ...s, candidates: unrated }), requests: s.requests.slice(0, QUALITY_LIMITS.requests), ...(s.artistUse ? { artistUse: s.artistUse.slice(0, QUALITY_LIMITS.artists) } : {}), ...(truncated ? { truncated: true } : {}), name, id: uid(), createdAt: Date.now() };
  readQualitySamples([sample]); // throws if anything is out of bounds
  return { ...k, quality: [...list, sample] };
}
/** Sets or clears (null) one rating. Only that sample's candidate changes. */
export function rateQualityCandidate<K extends WithQuality>(k: K, sampleId: string, index: number, rating: QualityRating | null): K {
  const list = k.quality ?? [];
  const s = list.find(x => x.id === sampleId); if (!s || !s.candidates[index]) throw Error("That review sample is no longer available.");
  return { ...k, quality: list.map(x => x.id !== sampleId ? x : { ...x, candidates: x.candidates.map((c, i) => { if (i !== index) return c; const { rating: _r, ...rest } = c; return rating ? { ...rest, rating } : rest; }) }) };
}
export function deleteQualitySample<K extends WithQuality>(k: K, sampleId: string): K {
  const list = k.quality ?? [];
  return { ...k, quality: list.filter(x => x.id !== sampleId) };
}
export const ratingCounts = (s: QualitySample) => {
  const c = { good: 0, maybe: 0, poor: 0, unrated: 0 };
  for (const x of s.candidates) c[x.rating ?? "unrated"]++;
  return { ...c, reviewed: c.good + c.maybe + c.poor, total: s.candidates.length };
};
