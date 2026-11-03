import { eventPrep, type PrepKnowledge } from "./knowledge";
import { DEFAULT_REC_CONTROLS, type Candidate, type ClientRequest, type EventPreferences, type RankContext, type SimilarArtistEvidence } from "./recommend";
import type { SimilarTrackEvidence } from "./similarTracks";
import { attrSource, type ProvRow } from "./provenance";
import type { MetaSource } from "./metaConfidence";
import type { FactSource } from "./filters";
import { fitFactsFromRow } from "./eventFit";

/**
 * Glue that lets automatic expansion use the exact ranking context the preparation panel uses.
 * AI-supplied genre/year are AI estimates (weak); the curated catalogue is a verified genre/year source.
 */
const decadeOf = (year: unknown) => typeof year === "number" && year >= 1900 && year <= 2100 ? `${Math.floor(year / 10) * 10}s` : undefined;

export const aiCandidate = (s: { artist: string; song: string; genre?: string; year?: number }): Omit<Candidate, "ref"> => {
  const decade = decadeOf(s.year);
  return { artist: s.artist, song: s.song, origin: "ai", facts: { genre: s.genre || undefined, genreSource: s.genre ? "ai" : undefined, decade, decadeSource: decade ? "ai" : undefined } };
};
export const catalogueCandidate = (s: { artist: string; song: string; genre?: string; year?: number }): Omit<Candidate, "ref"> => {
  const decade = decadeOf(s.year);
  return { artist: s.artist, song: s.song, origin: "catalogue", facts: { genre: s.genre || undefined, genreSource: s.genre ? "catalogue" : undefined, decade, decadeSource: decade ? "catalogue" : undefined } };
};

/** Last.fm similar-artist answers become evidence only for requested artists, matching the panel. */
export function similarArtistEvidence(crowd: readonly { name: string; similar: readonly { name: string; match: number }[] }[], requestArtists: readonly string[]): SimilarArtistEvidence[] {
  const wanted = new Set(requestArtists.map(a => a.toLowerCase().trim()).filter(Boolean));
  return crowd.filter(c => wanted.has(c.name.toLowerCase().trim())).flatMap(c => c.similar.map(s => ({ artist: s.name, similarTo: c.name, match: s.match })));
}

export function expansionRankContext(a: {
  knowledge: PrepKnowledge | null; eventId: string | null | undefined; requests: ClientRequest[]; rows: readonly { artist: string; song: string }[];
  similar?: SimilarArtistEvidence[]; similarTracks?: SimilarTrackEvidence[]; preferences?: EventPreferences;
}): RankContext {
  const ep = a.knowledge && a.eventId ? eventPrep(a.knowledge, a.eventId) : null;
  return {
    requests: a.requests, inEvent: a.rows.map(r => ({ artist: r.artist, song: r.song })),
    feedback: a.knowledge?.feedback ?? [], dismissed: ep?.dismissed ?? [],
    notes: a.knowledge ? new Map(a.knowledge.tracks.map(n => [n.id, n])) : undefined, eventTags: ep?.tags ?? [],
    similar: a.similar ?? [], similarTracks: a.similarTracks ?? [], preferences: a.preferences, controls: DEFAULT_REC_CONTROLS,
  };
}

/** Places ranked items in rank order, cycling across sections that still have room. Never pads or relaxes anything. */
export function placeRanked<T, K extends string>(ranked: readonly T[], keys: readonly K[], hasRoom: (k: K) => boolean, put: (k: K, item: T) => void): number {
  let placed = 0, at = 0;
  for (const item of ranked) {
    let tries = 0;
    while (tries < keys.length && !hasRoom(keys[at % keys.length])) { at++; tries++; }
    if (tries >= keys.length) break;
    put(keys[at % keys.length], item); placed++; at++;
  }
  return placed;
}

/**
 * Ranking candidate from a result row's per-attribute provenance, so equivalent facts score the same whichever
 * source found the row. Unknown provenance stays an estimate; missing values stay unknown.
 */
export function rowCandidate(row: ProvRow & { artist: string; song: string; genre?: string; year?: number }, origin: Candidate["origin"]): Omit<Candidate, "ref"> {
  const gs = attrSource(row, "genre"), ys = attrSource(row, "year");
  const decade = decadeOf(row.year);
  const fact = (s: MetaSource): FactSource | undefined => s === "unknown" ? undefined : s === "virtualdj" || s === "tags" || s === "filename" || s === "estimate" || s === "catalogue" || s === "ai" || s === "provider" || s === "user" || s === "measured" ? s : "estimate";
  return { artist: row.artist, song: row.song, origin, facts: {
    genre: gs !== "unknown" ? row.genre : undefined, genreSource: row.genre ? fact(gs) : undefined,
    decade: ys !== "unknown" ? decade : undefined, decadeSource: decade && ys !== "unknown" ? fact(ys) : undefined,
  }, ...withFit(row) };
}

/** Adds row fit facts only when present, so candidates without evidence are unchanged. */
export const withFit = (row: ProvRow) => { const fit = fitFactsFromRow(row); return fit ? { fit } : {}; };
