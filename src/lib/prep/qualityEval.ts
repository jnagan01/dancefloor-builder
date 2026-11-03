import { songIdentity, type Feedback, type TrackNote } from "./knowledge";
import { DEFAULT_REC_CONTROLS, recommend, distinctRequests, strongestSimilar, artistKey, type Candidate, type RecInput, type RecOutput, type Recommendation } from "./recommend";
import type { SimilarTrackEvidence } from "./similarTracks";
import type { FitFacts } from "./eventFit";
import { QUALITY_LIMITS, ratingCounts, type QualityCandidate, type QualityRating, type QualitySample } from "./quality";

/**
 * Deterministic offline evaluation of a frozen review sample under a ranking revision.
 * Metrics use ONLY candidates the user rated; unrated candidates are reported as missing coverage.
 * With fewer than MIN_RATED ratings, or when the sample's context could not be stored faithfully, no comparison is made.
 */
export const MIN_RATED = 3;
const GAIN: Record<QualityRating, number> = { good: 2, maybe: 1, poor: 0 };
export type RankFn = (input: RecInput) => RecOutput;
const DECADE = /^\d{4}s$/;

/**
 * Builds a frozen, path-free sample from the exact ranking input and output the panel showed.
 * Captures active controls, event artist counts, every distinct request, full Last.fm seed lists,
 * the scorer's own strongest artist-similarity choice and a tie ordinal for same-title files.
 */
export function captureFromRanking(input: RecInput, items: readonly Recommendation[], name: string, n = 10): Omit<QualitySample, "id" | "createdAt"> {
  let truncated = false;
  const fit = (v: string | undefined, max: number) => { if (v === undefined) return undefined; if (v.length > max) { truncated = true; return undefined; } return v; };
  const top = items.slice(0, n);
  const simTracks = new Map((input.similarTracks ?? []).map(e => [e.key, e]));
  const simArtist = strongestSimilar(input.similar ?? []);
  const favored = new Set(input.feedback.filter(f => f.kind === "favor").map(f => f.key));
  const tieOrder = [...new Set(top.map(r => r.trackId).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  const candidates: QualityCandidate[] = top.map(r => {
    const f = r.facts, c: QualityCandidate = { artist: r.artist, song: r.song, origin: r.origin, score: r.score - r.evidence.filter(e => e.kind === "variety").reduce((x, e) => x + e.points, 0) };
    if (r.artist.length > QUALITY_LIMITS.text || r.song.length > QUALITY_LIMITS.text) truncated = true;
    const genre = fit(f.genre, 60); if (genre) { c.genre = genre; if (f.genreSource) c.genreSource = f.genreSource; }
    if (f.decade) { if (DECADE.test(f.decade)) { c.decade = f.decade; if (f.decadeSource) c.decadeSource = f.decadeSource; } else truncated = true; }
    if (f.owned !== undefined) c.owned = f.owned;
    if (r.playCount !== undefined) { if (Number.isInteger(r.playCount) && r.playCount >= 0 && r.playCount <= 1e7) c.playCount = r.playCount; else truncated = true; }
    const st = simTracks.get(r.key);
    if (st) { if (st.seeds.length > QUALITY_LIMITS.seeds || st.seeds.some(x => x.length > QUALITY_LIMITS.text)) truncated = true; c.lastfmSeeds = st.seeds.slice(0, QUALITY_LIMITS.seeds); c.lastfmMatch = st.bestMatch; }
    const sa = simArtist.get(artistKey(r.artist)); if (sa) { c.similarTo = sa.similarTo.slice(0, QUALITY_LIMITS.text); c.similarMatch = sa.match; }
    const tags = r.trackId ? input.notes?.get(r.trackId)?.tags : undefined; if (tags?.length) c.tags = tags.slice(0, QUALITY_LIMITS.tags);
    if (favored.has(r.key)) c.favored = true;
    const ff = r.fit; if (ff) for (const a of ["popularity", "energy", "danceability"] as const) { const v = ff[a], src = ff[`${a}Source` as const]; if (v !== undefined && src && src !== "unknown") { c[a] = v; c[`${a}Source` as const] = src as QualityCandidate["genreSource"]; } }
    if (r.trackId) c.tie = tieOrder.indexOf(r.trackId);
    return c;
  });
  const reqs = distinctRequests(input.requests);
  const requests = reqs.map(r => {
    if (r.artist.length > QUALITY_LIMITS.text || r.song.length > QUALITY_LIMITS.text) truncated = true;
    const g = fit(r.genre, 60), d = r.decade && DECADE.test(r.decade) ? r.decade : (r.decade ? (truncated = true, undefined) : undefined);
    return { artist: r.artist.slice(0, QUALITY_LIMITS.text), song: r.song.slice(0, QUALITY_LIMITS.text), ...(g ? { genre: g } : {}), ...(d ? { decade: d } : {}) };
  });
  const use = new Map<string, { artist: string; count: number }>();
  for (const s of input.inEvent) { const k = artistKey(s.artist); const u = use.get(k) ?? { artist: s.artist.slice(0, QUALITY_LIMITS.text), count: 0 }; u.count++; use.set(k, u); }
  const pref = (v: string[] | undefined, max: number) => { const x = (v ?? []).filter(Boolean); if (x.length > QUALITY_LIMITS.prefs || x.some(y => y.length > max)) truncated = true; return x.slice(0, QUALITY_LIMITS.prefs).map(y => y.slice(0, max)); };
  const c = input.controls;
  return {
    name, requests, candidates, eventTags: (input.eventTags ?? []).slice(0, QUALITY_LIMITS.tags),
    preferences: { genres: pref(input.preferences?.genres, 60), decades: pref(input.preferences?.decades, 20), artists: pref(input.preferences?.artists, QUALITY_LIMITS.text), ...(input.preferences?.fit ? { fit: { ...input.preferences.fit } } : {}) },
    controls: { familiarity: c.familiarity, clientSimilarity: c.clientSimilarity, artistVariety: c.artistVariety, ownedOnly: c.ownedOnly },
    artistUse: [...use.values()],
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Rebuilds the ranking input exactly from what the sample captured (no live library, no network). */
export function sampleInput(s: QualitySample): RecInput {
  const notes = new Map<string, TrackNote>();
  const feedback: Feedback[] = [];
  const similarTracks: SimilarTrackEvidence[] = [];
  const candidates: Candidate[] = s.candidates.map((c, i) => {
    // Tie ordinals keep the captured file order; zero-padded so string order equals captured order.
    const trackId = c.tie !== undefined ? `t${String(c.tie).padStart(4, "0")}` : c.origin === "library" ? `x${String(i).padStart(4, "0")}` : undefined;
    if (trackId && c.tags?.length) notes.set(trackId, { id: trackId, tags: c.tags, note: "", updatedAt: 0 });
    if (c.favored) feedback.push({ key: songIdentity(c.artist, c.song), label: `${c.artist} – ${c.song}`, kind: "favor", at: 0 });
    if (c.lastfmSeeds?.length) similarTracks.push({ key: songIdentity(c.artist, c.song), artist: c.artist, song: c.song, seeds: c.lastfmSeeds, bestMatch: c.lastfmMatch ?? 0 });
    return {
      artist: c.artist, song: c.song, origin: c.origin, trackId, playCount: c.playCount, ref: i,
      facts: { genre: c.genre, genreSource: c.genreSource, decade: c.decade, decadeSource: c.decadeSource, owned: c.owned },
      ...(sampleFit(c) ? { fit: sampleFit(c) } : {}),
    };
  });
  const similar = s.candidates.flatMap(c => c.similarTo && c.similarMatch !== undefined ? [{ artist: c.artist, similarTo: c.similarTo, match: c.similarMatch }] : []);
  return {
    candidates, requests: s.requests, inEvent: [], artistUse: s.artistUse ?? [], feedback, dismissed: [], notes, eventTags: s.eventTags,
    similar, similarTracks, preferences: s.preferences, controls: s.controls ?? DEFAULT_REC_CONTROLS, limit: s.candidates.length,
  };
}

/** Whether replaying this sample can be exact: full context recorded and nothing truncated. */
export const replayable = (s: QualitySample) => !!s.controls && !s.truncated;

export interface SampleEvaluation {
  /** Candidate indexes in ranked order. */ order: number[];
  total: number; rated: number; unrated: number;
  /** False when fewer than MIN_RATED candidates are rated; metrics are then undefined. */ enough: boolean;
  /** Good fits among RATED candidates in the top k (maybe/poor count as not good). */ topK?: { k: number; good: number; rated: number };
  /** Internal regression measure over rated candidates only (Good=2, Maybe=1, Poor=0); 1 = ideal order. Not shown to users. */ gain?: number;
}

export function evaluateSample(s: QualitySample, rank: RankFn = recommend, k = 5): SampleEvaluation {
  const out = rank(sampleInput(s));
  const order = out.items.map(r => r.ref!).filter(i => i !== undefined);
  for (let i = 0; i < s.candidates.length; i++) if (!order.includes(i)) order.push(i); // never drop a captured candidate
  const counts = ratingCounts(s);
  const base: SampleEvaluation = { order, total: counts.total, rated: counts.reviewed, unrated: counts.unrated, enough: counts.reviewed >= MIN_RATED };
  if (!base.enough) return base;
  const top = order.slice(0, k).map(i => s.candidates[i].rating).filter((r): r is QualityRating => !!r);
  const gains = order.map(i => s.candidates[i].rating).filter((r): r is QualityRating => !!r).map(r => GAIN[r]);
  const dcg = (g: number[]) => g.reduce((n, x, i) => n + x / Math.log2(i + 2), 0);
  const ideal = dcg([...gains].sort((a, b) => b - a));
  return { ...base, topK: { k, good: top.filter(r => r === "good").length, rated: top.length }, gain: ideal > 0 ? Math.round((dcg(gains) / ideal) * 1000) / 1000 : undefined };
}

export interface Comparison {
  /** "unavailable" when the sample can't be replayed exactly. */
  status: "unavailable" | "unchanged" | "changed";
  captured: SampleEvaluation; revision?: SampleEvaluation;
}
/** Saved order (index order) versus a ranking revision on the same frozen sample. */
export function compareRevisions(s: QualitySample, revision: RankFn = recommend, k = 5): Comparison {
  const capturedRank: RankFn = input => ({ items: input.candidates.map(c => ({ ...c, key: songIdentity(c.artist, c.song), score: 0, evidence: [] })), hidden: { dismissed: 0, never: 0, inEvent: 0, filtered: 0, notOwned: 0 } });
  const captured = evaluateSample(s, capturedRank, k);
  if (!replayable(s)) return { status: "unavailable", captured };
  const rev = evaluateSample(s, revision, k);
  const raw = revision(sampleInput(s)).items;
  const scoresSame = s.candidates.every((c, i) => c.score === undefined || raw.find(r => r.ref === i && Math.abs((r.score - r.evidence.filter(e => e.kind === "variety").reduce((x, e) => x + e.points, 0)) - c.score!) < 0.011));
  const same = rev.order.every((v, i) => v === i) && scoresSame;
  return { status: same ? "unchanged" : "changed", captured, revision: rev };
}

/** Plain-language summary for the review tab; no technical scores. */
export function describeComparison(c: Comparison, s: QualitySample): string[] {
  const n = ratingCounts(s);
  const lines = [`${n.reviewed} of ${n.total} tracks rated (${n.good} good fit, ${n.maybe} maybe, ${n.poor} poor fit).`];
  if (c.status === "unavailable") {
    lines.push(s.controls ? "Comparison unavailable: this sample had more context than can be stored, so it can't be replayed exactly." : "Comparison unavailable: this sample was saved before the app recorded full ranking context.");
    return lines;
  }
  lines.push(c.status === "unchanged" ? "The current ranking gives the same order and reasons as when you saved it." : "The current ranking orders these tracks differently from when you saved it.");
  if (!c.captured.enough) { lines.push(`Rate at least ${MIN_RATED} tracks to see which order puts your good fits higher.`); return lines; }
  const a = c.captured.topK!, b = c.revision!.topK!;
  lines.push(`Good fits in the top ${a.k}: ${a.good} as saved, ${b.good} now (counting only rated tracks).`);
  return lines;
}

function sampleFit(c: QualityCandidate): FitFacts | undefined {
  const f: FitFacts = {};
  for (const a of ["popularity", "energy", "danceability"] as const) { const v = c[a], src = c[`${a}Source` as const]; if (v !== undefined && src) { f[a] = v; f[`${a}Source` as const] = src; } }
  return Object.keys(f).length ? f : undefined;
}
