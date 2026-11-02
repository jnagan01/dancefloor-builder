import { songIdentity, type Feedback, type Dismissal, type TrackNote } from "./knowledge";
import { matchesFilter, type FilterFacts, type FilterState } from "./filters";

export interface Candidate { artist: string; song: string; facts: FilterFacts; trackId?: string; playCount?: number; origin: "library" | "catalogue" }
export interface ClientRequest { artist: string; song: string; genre?: string; decade?: string }
export interface SimilarArtistEvidence { artist: string; similarTo: string; match: number }
export interface RecControls {
  /** -1 = discovery (prefer unplayed), 0 = neutral, 1 = familiar (prefer played). */ familiarity: number;
  /** 0..1 weight of client-request similarity evidence. */ clientSimilarity: number;
  /** 0..1 strength of the same-artist penalty. */ artistVariety: number;
  ownedOnly: boolean;
}
export interface Evidence { kind: "artist" | "genre" | "decade" | "lastfm" | "familiar" | "discovery" | "favor" | "tag" | "variety"; text: string; points: number }
export interface Recommendation extends Candidate { key: string; score: number; evidence: Evidence[] }
export interface RecInput {
  candidates: Candidate[]; requests: ClientRequest[]; inEvent: { artist: string; song: string }[];
  feedback: Feedback[]; dismissed: Dismissal[]; notes?: Map<string, TrackNote>; eventTags?: string[];
  similar?: SimilarArtistEvidence[]; controls: RecControls; filter?: FilterState; limit?: number;
}
export interface RecOutput { items: Recommendation[]; hidden: { dismissed: number; never: number; inEvent: number; filtered: number; notOwned: number } }

const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Ranks from explicit inputs only. Each point added to a score is also recorded as an Evidence line,
 * so explanations are exactly the rank inputs. Play counts are labelled as personal familiarity,
 * never as crowd suitability. Client requests are never candidates to remove.
 */
export function recommend(input: RecInput): RecOutput {
  const c = { familiarity: clamp(input.controls.familiarity, -1, 1), clientSimilarity: clamp(input.controls.clientSimilarity, 0, 1), artistVariety: clamp(input.controls.artistVariety, 0, 1) };
  const never = new Set(input.feedback.filter(f => f.kind === "never").map(f => f.key));
  const favor = new Set(input.feedback.filter(f => f.kind === "favor").map(f => f.key));
  const dismissed = new Set(input.dismissed.map(d => d.key));
  const inEvent = new Set(input.inEvent.map(s => songIdentity(s.artist, s.song)));
  const reqArtists = new Map<string, ClientRequest>();
  const genreCount = new Map<string, number>(), decadeCount = new Map<string, number>();
  for (const r of input.requests) {
    if (r.artist && !reqArtists.has(norm(r.artist))) reqArtists.set(norm(r.artist), r);
    if (r.genre) genreCount.set(r.genre.toLowerCase(), (genreCount.get(r.genre.toLowerCase()) ?? 0) + 1);
    if (r.decade) decadeCount.set(r.decade, (decadeCount.get(r.decade) ?? 0) + 1);
  }
  const similar = new Map<string, SimilarArtistEvidence>();
  for (const s of input.similar ?? []) { const k = norm(s.artist); if (!similar.has(k) || similar.get(k)!.match < s.match) similar.set(k, s); }
  const reqCount = Math.max(1, input.requests.length);
  const hidden = { dismissed: 0, never: 0, inEvent: 0, filtered: 0, notOwned: 0 };
  const scored: Recommendation[] = [];
  const seen = new Set<string>();
  for (const cand of input.candidates) {
    const key = songIdentity(cand.artist, cand.song);
    if (inEvent.has(key)) { hidden.inEvent++; continue; }
    if (never.has(key)) { hidden.never++; continue; }
    if (dismissed.has(key)) { hidden.dismissed++; continue; }
    if (input.controls.ownedOnly && !cand.facts.owned) { hidden.notOwned++; continue; }
    if (input.filter && !matchesFilter(cand.facts, input.filter, "recommendation")) { hidden.filtered++; continue; }
    const dedupe = cand.trackId ? `f:${cand.trackId}` : `s:${key}`;
    if (seen.has(dedupe)) continue; seen.add(dedupe);
    const ev: Evidence[] = [];
    const push = (kind: Evidence["kind"], text: string, points: number) => { if (points !== 0) ev.push({ kind, text, points: Math.round(points * 100) / 100 }); };
    if (c.clientSimilarity > 0) {
      const req = reqArtists.get(norm(cand.artist));
      if (req) push("artist", `Same artist as client request “${req.artist} – ${req.song}”`, 3 * c.clientSimilarity);
      const g = cand.facts.genre?.toLowerCase(), gn = g ? genreCount.get(g) ?? 0 : 0;
      if (gn) push("genre", `Genre “${cand.facts.genre}” matches ${gn} of ${input.requests.length} client requests`, 2 * (gn / reqCount) * c.clientSimilarity);
      const dn = cand.facts.decade ? decadeCount.get(cand.facts.decade) ?? 0 : 0;
      if (dn) push("decade", `${cand.facts.decade} matches ${dn} of ${input.requests.length} client requests`, 1.5 * (dn / reqCount) * c.clientSimilarity);
      const sim = req ? undefined : similar.get(norm(cand.artist));
      if (sim) push("lastfm", `Last.fm lists ${cand.artist} as similar to ${sim.similarTo} (match ${sim.match.toFixed(2)})`, 2 * sim.match * c.clientSimilarity);
    }
    if (c.familiarity !== 0 && cand.origin === "library") {
      const plays = cand.playCount ?? 0;
      if (c.familiarity > 0 && plays > 0) push("familiar", `You've played it ${plays} time${plays === 1 ? "" : "s"} in VirtualDJ (your familiarity, not crowd data)`, c.familiarity * Math.min(2, Math.log10(plays + 1)));
      if (c.familiarity < 0 && plays === 0 && cand.playCount !== undefined) push("discovery", "Never played in your VirtualDJ history (discovery)", -c.familiarity * 1);
    }
    if (favor.has(key)) push("favor", "You marked this as a favourite to recommend", 1.5);
    const note = cand.trackId ? input.notes?.get(cand.trackId) : undefined;
    const tagHits = note && input.eventTags?.length ? note.tags.filter(t => input.eventTags!.includes(t)) : [];
    if (tagHits.length) push("tag", `Your tag${tagHits.length > 1 ? "s" : ""} ${tagHits.map(t => `“${t}”`).join(", ")} match this event`, 1 * tagHits.length);
    const score = ev.reduce((n, e) => n + e.points, 0);
    scored.push({ ...cand, key, score, evidence: ev });
  }
  scored.sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist) || a.song.localeCompare(b.song));
  // Greedy artist-variety rerank over a bounded pool; penalty counts event songs and earlier picks.
  const limit = input.limit ?? 50, pool = scored.slice(0, Math.max(limit * 6, 300));
  const artistUse = new Map<string, number>();
  for (const s of input.inEvent) artistUse.set(norm(s.artist), (artistUse.get(norm(s.artist)) ?? 0) + 1);
  const out: Recommendation[] = [];
  while (out.length < limit && pool.length) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i].score - c.artistVariety * 1.5 * (artistUse.get(norm(pool[i].artist)) ?? 0);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    const [pick] = pool.splice(best, 1);
    const uses = artistUse.get(norm(pick.artist)) ?? 0;
    const penalty = c.artistVariety * 1.5 * uses;
    const final = penalty ? { ...pick, score: pick.score - penalty, evidence: [...pick.evidence, { kind: "variety" as const, text: `${pick.artist} already appears ${uses} time${uses === 1 ? "" : "s"} in this event or above`, points: -Math.round(penalty * 100) / 100 }] } : pick;
    out.push(final);
    artistUse.set(norm(pick.artist), uses + 1);
  }
  return { items: out, hidden };
}
