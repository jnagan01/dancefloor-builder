import { songIdentity, type Feedback, type Dismissal, type TrackNote } from "./knowledge";
import { matchesFilter, type FilterFacts, type FilterState } from "./filters";
import { similarTrackPoints, type SimilarTrackEvidence } from "./similarTracks";
import { TIER_WEIGHT, sourceLabel, tierOf } from "./metaConfidence";
import { evaluateFit, type EventFit, type FitFacts } from "./eventFit";

/**
 * Shared deterministic ranking engine for the preparation panel AND every automatic expansion source
 * (owned library, built-in catalogue, AI candidates). Sources may differ in how candidates are found,
 * but eligibility is checked first and the same context always produces the same score and explanation.
 */
export interface Candidate {
  artist: string; song: string; facts: FilterFacts; trackId?: string; playCount?: number;
  origin: "library" | "catalogue" | "ai";
  /** Optional track-level fit evidence (popularity/energy/danceability with provenance). Absent = unknown. */
  fit?: FitFacts;
  /** Caller's opaque position, carried through so pooled sources can map results back. */
  ref?: number;
}
export interface ClientRequest { artist: string; song: string; genre?: string; decade?: string }
export interface SimilarArtistEvidence { artist: string; similarTo: string; match: number }
export interface RecControls {
  /** -1 = discovery (prefer unplayed), 0 = neutral, 1 = familiar (prefer played). */ familiarity: number;
  /** 0..1 weight of client-request similarity evidence. */ clientSimilarity: number;
  /** 0..1 strength of the same-artist penalty. */ artistVariety: number;
  ownedOnly: boolean;
}
/** The panel's starting controls are also the controls automatic expansion uses, so both rank alike. */
export const DEFAULT_REC_CONTROLS: RecControls = { familiarity: 0, clientSimilarity: 1, artistVariety: 0.5, ownedOnly: false };
/** Explicit choices from the event's own form (not inferred). */
export interface EventPreferences { genres?: string[]; decades?: string[]; artists?: string[]; /** Optional event-scoped fit choices; absent = no-op. */ fit?: EventFit }
export type EvidenceKind = "artist" | "genre" | "decade" | "lastfm" | "lastfmTrack" | "familiar" | "discovery" | "favor" | "tag" | "variety" | "prefGenre" | "prefDecade" | "prefArtist" | "familiarTrack" | "unfamiliarTrack" | "slowEstimate" | "discoveryTrack";
export interface Evidence { kind: EvidenceKind; text: string; points: number }
export interface Recommendation extends Candidate { key: string; score: number; evidence: Evidence[]; /** Unverified aspects of active event-fit choices (display only). */ uncertain?: string[] }
export interface RecInput {
  candidates: Candidate[]; requests: ClientRequest[]; inEvent: { artist: string; song: string }[];
  /** Exact case-sensitive file identities already selected by event rows (primary + explicit extras). */
  inEventTrackIds?: Iterable<string>;
  feedback: Feedback[]; dismissed: Dismissal[]; notes?: Map<string, TrackNote>; eventTags?: string[];
  similar?: SimilarArtistEvidence[];
  /** Last.fm track.getSimilar evidence aggregated across distinct requested tracks. */ similarTracks?: SimilarTrackEvidence[];
  preferences?: EventPreferences;
  /** Extra per-artist use counts for variety (a frozen review sample's event context); added to `inEvent` counts. */
  artistUse?: readonly { artist: string; count: number }[];
  controls: RecControls; filter?: FilterState; limit?: number;
}
export interface RecOutput { items: Recommendation[]; hidden: { dismissed: number; never: number; inEvent: number; filtered: number; notOwned: number; /** Excluded by the event's avoid-slow choice on strong evidence. */ slow?: number } }

const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 100) / 100;
/** The single strongest Last.fm artist-similarity entry per normalised artist, exactly as the scorer selects it. */
export function strongestSimilar(list: readonly SimilarArtistEvidence[]): Map<string, SimilarArtistEvidence> {
  const similar = new Map<string, SimilarArtistEvidence>();
  for (const s of list) { const k = norm(s.artist); const o = similar.get(k); if (!o || o.match < s.match || (o.match === s.match && s.similarTo < o.similarTo)) similar.set(k, s); }
  return similar;
}
export const artistKey = (a: string) => norm(a);
const genreHit = (g: string, wants: string[]) => { const x = g.toLowerCase(); return wants.find(w => x.includes(w) || w.includes(x)); };

/** Distinct requests by exact song identity, so a request repeated in several sections counts once. */
export function distinctRequests(requests: readonly ClientRequest[]): ClientRequest[] {
  const seen = new Set<string>(), out: ClientRequest[] = [];
  for (const r of requests) { if (!r.artist && !r.song) continue; const k = songIdentity(r.artist, r.song); if (seen.has(k)) continue; seen.add(k); out.push(r); }
  return out;
}

/**
 * Ranks from explicit inputs only. Each point added to a score is also recorded as an Evidence line,
 * so explanations are exactly the rank inputs. Play counts are labelled as personal familiarity,
 * never as crowd suitability. AI origin earns nothing by itself. Client requests are never candidates to remove.
 */
export function recommend(input: RecInput): RecOutput {
  const c = { familiarity: clamp(input.controls.familiarity, -1, 1), clientSimilarity: clamp(input.controls.clientSimilarity, 0, 1), artistVariety: clamp(input.controls.artistVariety, 0, 1) };
  const never = new Set(input.feedback.filter(f => f.kind === "never").map(f => f.key));
  const favor = new Set(input.feedback.filter(f => f.kind === "favor").map(f => f.key));
  const dismissed = new Set(input.dismissed.map(d => d.key));
  const inEvent = new Set(input.inEvent.map(s => songIdentity(s.artist, s.song)));
  const inEventFiles = new Set(input.inEventTrackIds ?? []);
  const requests = distinctRequests(input.requests);
  const reqArtists = new Map<string, ClientRequest>();
  const genreCount = new Map<string, number>(), decadeCount = new Map<string, number>();
  for (const r of requests) {
    if (r.artist && !reqArtists.has(norm(r.artist))) reqArtists.set(norm(r.artist), r);
    if (r.genre) genreCount.set(r.genre.toLowerCase(), (genreCount.get(r.genre.toLowerCase()) ?? 0) + 1);
    if (r.decade) decadeCount.set(r.decade, (decadeCount.get(r.decade) ?? 0) + 1);
  }
  const similar = strongestSimilar(input.similar ?? []);
  const simTracks = new Map<string, SimilarTrackEvidence>((input.similarTracks ?? []).map(e => [e.key, e]));
  const prefGenres = (input.preferences?.genres ?? []).map(g => g.toLowerCase().trim()).filter(Boolean);
  const prefDecades = new Set((input.preferences?.decades ?? []).filter(Boolean));
  const prefArtists = new Map((input.preferences?.artists ?? []).filter(Boolean).map(a => [norm(a), a]));
  const reqCount = Math.max(1, requests.length);
  const hidden: RecOutput["hidden"] = { dismissed: 0, never: 0, inEvent: 0, filtered: 0, notOwned: 0 };
  const fitChoice = input.preferences?.fit;
  if (fitChoice?.avoidSlow) hidden.slow = 0;
  const scored: Recommendation[] = [];
  const seen = new Set<string>();
  for (const cand of input.candidates) {
    const key = songIdentity(cand.artist, cand.song);
    if (inEvent.has(key) || (cand.trackId !== undefined && inEventFiles.has(cand.trackId))) { hidden.inEvent++; continue; }
    if (never.has(key)) { hidden.never++; continue; }
    if (dismissed.has(key)) { hidden.dismissed++; continue; }
    if (input.controls.ownedOnly && !cand.facts.owned) { hidden.notOwned++; continue; }
    if (input.filter && !matchesFilter(cand.facts, input.filter, "recommendation")) { hidden.filtered++; continue; }
    // Known exclusions beat similarity: strong slow evidence removes an automatic candidate before any scoring.
    const fitR = evaluateFit(fitChoice, cand);
    if (fitR.exclude) { hidden.slow = (hidden.slow ?? 0) + 1; continue; }
    const dedupe = cand.trackId ? `f:${cand.trackId}` : `s:${key}`;
    if (seen.has(dedupe)) continue; seen.add(dedupe);
    const ev: Evidence[] = [];
    const push = (kind: EvidenceKind, text: string, points: number) => { if (points > 0.001 || points < -0.001) ev.push({ kind, text, points: round(points) }); };
    const gt = tierOf(cand.facts.genreSource ?? "estimate", !!cand.facts.genre);
    const dt = tierOf(cand.facts.decadeSource ?? "estimate", !!cand.facts.decade);
    // Familiar-hits intent: artist-level similarity alone must not dominate; without track-level familiarity evidence it counts half.
    const damp = fitChoice?.familiarity === "familiar" && !fitR.familiarEvidence ? 0.5 : 1;
    const dampNote = damp < 1 ? " — counted half: no track-level familiarity evidence" : "";
    if (c.clientSimilarity > 0) {
      const req = reqArtists.get(norm(cand.artist));
      if (req) push("artist", `Same artist as client request “${req.artist} – ${req.song}”${dampNote}`, 3 * c.clientSimilarity * damp);
      const g = cand.facts.genre?.toLowerCase(), gn = g ? genreCount.get(g) ?? 0 : 0;
      if (gn && gt !== "unknown") push("genre", `Genre “${cand.facts.genre}” (${sourceLabel(cand.facts.genreSource ?? "estimate")}) matches ${gn} of ${requests.length} client requests`, 2 * (gn / reqCount) * c.clientSimilarity * TIER_WEIGHT[gt]);
      const dn = cand.facts.decade ? decadeCount.get(cand.facts.decade) ?? 0 : 0;
      if (dn && dt !== "unknown") push("decade", `${cand.facts.decade} (${sourceLabel(cand.facts.decadeSource ?? "estimate")}) matches ${dn} of ${requests.length} client requests`, 1.5 * (dn / reqCount) * c.clientSimilarity * TIER_WEIGHT[dt]);
      const st = simTracks.get(key);
      if (st) push("lastfmTrack", st.seeds.length > 1
        ? `Last.fm lists this exact track as similar to ${st.seeds.length} requested tracks: ${st.seeds.slice(0, 3).map(x => `“${x}”`).join(", ")}${st.seeds.length > 3 ? "…" : ""}`
        : `Last.fm lists this exact track as similar to requested “${st.seeds[0]}”`, similarTrackPoints(st) * c.clientSimilarity);
      const sim = req || st ? undefined : similar.get(norm(cand.artist));
      if (sim) push("lastfm", `Last.fm lists ${cand.artist} as similar to ${sim.similarTo} (artist-level)${dampNote}`, 2 * sim.match * c.clientSimilarity * damp);
    }
    const pa = prefArtists.get(norm(cand.artist));
    if (pa) push("prefArtist", `${pa} is a favourite artist for this event`, 1.5);
    const pg = cand.facts.genre && gt !== "unknown" ? genreHit(cand.facts.genre, prefGenres) : undefined;
    if (pg) push("prefGenre", `Genre “${cand.facts.genre}” (${sourceLabel(cand.facts.genreSource ?? "estimate")}) is a preferred genre for this event`, 1 * TIER_WEIGHT[gt]);
    if (cand.facts.decade && dt !== "unknown" && prefDecades.has(cand.facts.decade)) push("prefDecade", `${cand.facts.decade} (${sourceLabel(cand.facts.decadeSource ?? "estimate")}) is a preferred decade for this event`, 0.75 * TIER_WEIGHT[dt]);
    if (c.familiarity !== 0 && cand.origin === "library") {
      const plays = cand.playCount ?? 0;
      if (c.familiarity > 0 && plays > 0) push("familiar", `You've played it ${plays} time${plays === 1 ? "" : "s"} in VirtualDJ (your familiarity, not crowd data)`, c.familiarity * Math.min(2, Math.log10(plays + 1)));
      if (c.familiarity < 0 && plays === 0 && cand.playCount !== undefined) push("discovery", "Never played in your VirtualDJ history (discovery)", -c.familiarity * 1);
    }
    // Popularity alone is not event fit: without any link to this event's requests/preferences, positive familiarity counts half.
    const linked = ev.some(e => e.points > 0 && e.kind !== "familiar" && e.kind !== "discovery");
    for (const l of fitR.lines) {
      const half = l.points > 0 && l.kind === "familiarTrack" && !linked;
      push(l.kind, half ? `${l.text} — counted half: no link to this event's requests or preferences` : l.text, half ? l.points / 2 : l.points);
    }
    if (favor.has(key)) push("favor", "You marked this as a favourite to recommend", 1.5);
    const note = cand.trackId ? input.notes?.get(cand.trackId) : undefined;
    const tagHits = note && input.eventTags?.length ? note.tags.filter(t => input.eventTags!.includes(t)) : [];
    if (tagHits.length) push("tag", `Your tag${tagHits.length > 1 ? "s" : ""} ${tagHits.map(t => `“${t}”`).join(", ")} match this event`, 1 * tagHits.length);
    const score = round(ev.reduce((n, e) => n + e.points, 0));
    scored.push({ ...cand, key, score, evidence: ev, ...(fitR.uncertain?.length ? { uncertain: fitR.uncertain } : {}) });
  }
  // Deterministic tie-break: score, then artist, title, file identity, then caller position.
  scored.sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist) || a.song.localeCompare(b.song) || (a.trackId ?? "").localeCompare(b.trackId ?? "") || (a.ref ?? 0) - (b.ref ?? 0));
  // Greedy artist-variety rerank over a bounded pool; penalty counts event songs (including additions already chosen) and earlier picks.
  const limit = input.limit ?? 50, pool = scored.slice(0, Math.max(limit * 6, 300));
  const artistUse = new Map<string, number>();
  for (const s of input.inEvent) artistUse.set(norm(s.artist), (artistUse.get(norm(s.artist)) ?? 0) + 1);
  for (const a of input.artistUse ?? []) if (a.count > 0) artistUse.set(norm(a.artist), (artistUse.get(norm(a.artist)) ?? 0) + Math.floor(a.count));
  const out: Recommendation[] = [];
  while (out.length < limit && pool.length) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i].score - c.artistVariety * 1.5 * (artistUse.get(norm(pool[i].artist)) ?? 0);
      if (s > bestScore + 1e-9) { bestScore = s; best = i; }
    }
    const [pick] = pool.splice(best, 1);
    const uses = artistUse.get(norm(pick.artist)) ?? 0;
    const penalty = c.artistVariety * 1.5 * uses;
    const final = penalty ? { ...pick, score: round(pick.score - penalty), evidence: [...pick.evidence, { kind: "variety" as const, text: `${pick.artist} already appears ${uses} time${uses === 1 ? "" : "s"} in this event or above`, points: -round(penalty) }] } : pick;
    out.push(final);
    artistUse.set(norm(pick.artist), uses + 1);
  }
  return { items: out, hidden };
}

/** Plain-language summary of the strongest positive reasons (no point values), for result rows. */
export function explainTop(r: { evidence: Evidence[]; uncertain?: string[] }, n = 3): string {
  const top = r.evidence.filter(e => e.points > 0).slice().sort((a, b) => b.points - a.points).slice(0, n);
  const base = top.length ? top.map(e => e.text).join(" · ") : "No specific evidence beyond your event rules.";
  // Fit caveats (negative slow/unfamiliar evidence and unverified choices) always stay visible, even when positives fill the limit.
  const caveats = [...r.evidence.filter(e => e.points < 0 && (e.kind === "slowEstimate" || e.kind === "unfamiliarTrack")).map(e => e.text), ...(r.uncertain ?? [])].join(" · ").slice(0, 600);
  return caveats ? `${base.slice(0, 897 - caveats.length)} · ${caveats}` : base.slice(0, 900);
}

export type RankContext = Omit<RecInput, "candidates" | "limit" | "filter" | "controls"> & { controls?: RecControls };

/**
 * Rank any source's pool with the shared engine. `toCandidate` maps each item to its facts; eligibility
 * (policy, strict limits, feedback) must already be checked by the caller and is re-applied here for feedback.
 * Returns items in rank order with their recommendation (score + evidence). Never pads.
 */
export function rankPool<T>(items: readonly T[], toCandidate: (t: T) => Omit<Candidate, "ref">, ctx: RankContext, limit = items.length, stats?: { hidden?: RecOutput["hidden"] }): { item: T; rec: Recommendation }[] {
  if (!items.length || limit <= 0) return [];
  const candidates = items.map((t, i) => ({ ...toCandidate(t), ref: i }));
  const out = recommend({ ...ctx, controls: ctx.controls ?? DEFAULT_REC_CONTROLS, candidates, limit });
  if (stats) stats.hidden = out.hidden;
  return out.items.map(rec => ({ item: items[rec.ref!], rec }));
}
