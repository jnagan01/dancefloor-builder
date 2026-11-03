import { songIdentity, type Feedback, type TrackNote } from "./knowledge";
import { DEFAULT_REC_CONTROLS, recommend, type Candidate, type RecInput, type RecOutput } from "./recommend";
import type { SimilarTrackEvidence } from "./similarTracks";
import { ratingCounts, type QualityRating, type QualitySample } from "./quality";

/**
 * Deterministic offline evaluation of a frozen review sample under a ranking revision.
 * Metrics are computed ONLY over candidates the user rated; unrated candidates are reported as missing coverage,
 * never treated as good or poor. With fewer than MIN_RATED ratings no metric is reported at all.
 */
export const MIN_RATED = 3;
const GAIN: Record<QualityRating, number> = { good: 2, maybe: 1, poor: 0 };
export type RankFn = (input: RecInput) => RecOutput;

/** Rebuilds the ranking input exactly from what the sample captured (no live library, no network). */
export function sampleInput(s: QualitySample): RecInput {
  const notes = new Map<string, TrackNote>();
  const feedback: Feedback[] = [];
  const similarTracks: SimilarTrackEvidence[] = [];
  const candidates: Candidate[] = s.candidates.map((c, i) => {
    const trackId = `sample:${i}`;
    if (c.tags?.length) notes.set(trackId, { id: trackId, tags: c.tags, note: "", updatedAt: 0 });
    if (c.favored) feedback.push({ key: songIdentity(c.artist, c.song), label: `${c.artist} – ${c.song}`, kind: "favor", at: 0 });
    if (c.lastfmSeeds?.length) similarTracks.push({ key: songIdentity(c.artist, c.song), artist: c.artist, song: c.song, seeds: c.lastfmSeeds, bestMatch: c.lastfmMatch ?? 0 });
    return {
      artist: c.artist, song: c.song, origin: c.origin, trackId, playCount: c.playCount, ref: i,
      facts: { genre: c.genre, genreSource: c.genreSource, decade: c.decade, decadeSource: c.decadeSource, owned: c.owned },
    };
  });
  const similar = s.candidates.flatMap(c => c.similarTo && c.similarMatch !== undefined ? [{ artist: c.artist, similarTo: c.similarTo, match: c.similarMatch }] : []);
  return {
    candidates, requests: s.requests, inEvent: [], feedback, dismissed: [], notes, eventTags: s.eventTags,
    similar, similarTracks, preferences: s.preferences, controls: DEFAULT_REC_CONTROLS, limit: s.candidates.length,
  };
}

export interface SampleEvaluation {
  /** Candidate indexes in ranked order. */ order: number[];
  total: number; rated: number; unrated: number;
  /** False when fewer than MIN_RATED candidates are rated; metrics are then undefined. */ enough: boolean;
  /** Good fits among the RATED candidates that land in the top k (maybe/poor count as not good). */
  topK?: { k: number; good: number; rated: number };
  /** Normalised ranking gain over rated candidates only (Good=2, Maybe=1, Poor=0); 1 means rated tracks are in ideal order. */
  gain?: number;
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

/** Captured order (index order) versus a ranking revision, on the same frozen sample. */
export function compareRevisions(s: QualitySample, revision: RankFn = recommend, k = 5) {
  const captured: RankFn = input => ({ items: input.candidates.map(c => ({ ...c, key: songIdentity(c.artist, c.song), score: 0, evidence: [] })), hidden: { dismissed: 0, never: 0, inEvent: 0, filtered: 0, notOwned: 0 } });
  return { captured: evaluateSample(s, captured, k), revision: evaluateSample(s, revision, k) };
}

export function describeEvaluation(e: SampleEvaluation): string {
  if (!e.enough) return `Rate at least ${MIN_RATED} tracks to compare rankings (${e.rated} of ${e.total} rated).`;
  const t = e.topK!;
  return `Top ${t.k}: ${t.good} good fit of ${t.rated} rated · ranking gain ${e.gain ?? "n/a"} · based on ${e.rated} of ${e.total} rated tracks only.`;
}
