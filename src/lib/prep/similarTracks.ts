import { songIdentity } from "./knowledge";

/**
 * Last.fm track.getSimilar evidence, aggregated across distinct client requests.
 * Pure helpers shared by the server function, the recommendation panel and automatic expansion.
 * Only bounded artist/title seeds ever leave the app; never event names, notes, paths or library contents.
 */
export interface TrackSeed { artist: string; title: string }
export interface SimilarTrackRow { artist: string; title: string; match: number }
export type SeedStatus = "ok" | "notFound" | "error";
export interface SeedResult { seed: TrackSeed; status: SeedStatus; similar: SimilarTrackRow[] }
/** Overall availability, reported truthfully to the user. */
export type SimilarAvailability = "ok" | "partial" | "missingKey" | "rateLimited" | "unavailable" | "noSeeds";
export interface SimilarTracksResponse { availability: SimilarAvailability; seeds: SeedResult[] }

/** One candidate track supported by one or more distinct requested tracks. */
export interface SimilarTrackEvidence {
  key: string; artist: string; song: string;
  /** Distinct requested-track labels ("Artist – Title"); duplicate requests never add support. */
  seeds: string[];
  bestMatch: number;
}

export const SIMILAR_LIMITS = { seeds: 20, perSeed: 30, concurrency: 3, timeoutMs: 6000 };

const clean = (s: string, max = 150) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u001F\u007F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Distinct requested tracks only (exact song identity), bounded. Rows without artist and title are skipped. */
export function seedsFromRequests(requests: readonly { artist?: string; song?: string; title?: string }[]): TrackSeed[] {
  const seen = new Set<string>(), out: TrackSeed[] = [];
  for (const r of requests) {
    const artist = clean(r.artist ?? ""), title = clean(r.title ?? r.song ?? "");
    if (!artist || !title) continue;
    const k = songIdentity(artist, title);
    if (seen.has(k)) continue;
    seen.add(k); out.push({ artist, title });
    if (out.length >= SIMILAR_LIMITS.seeds) break;
  }
  return out;
}

/** Parses one track.getsimilar JSON body. Last.fm reports errors inside a 200 body with an `error` code. */
export function parseSimilarBody(body: unknown, perSeed = SIMILAR_LIMITS.perSeed): { status: SeedStatus | "rateLimited" | "badKey"; similar: SimilarTrackRow[] } {
  if (!body || typeof body !== "object") return { status: "error", similar: [] };
  const o = body as Record<string, unknown>;
  if (o.error !== undefined) {
    const code = Number(o.error);
    if (code === 29) return { status: "rateLimited", similar: [] };
    if (code === 10 || code === 26) return { status: "badKey", similar: [] };
    if (code === 6) return { status: "notFound", similar: [] };
    return { status: "error", similar: [] };
  }
  // Only a genuine Last.fm success envelope may mean "no similar tracks"; anything else is an outage, never cached.
  if (!o.similartracks || typeof o.similartracks !== "object") return { status: "error", similar: [] };
  const raw = (o.similartracks as { track?: unknown }).track;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const similar: SimilarTrackRow[] = [];
  for (const t of list) {
    const r = t as { name?: unknown; match?: unknown; artist?: { name?: unknown } | string };
    const title = clean(String(r?.name ?? ""));
    const artist = clean(typeof r?.artist === "string" ? r.artist : String(r?.artist?.name ?? ""));
    const match = Math.max(0, Math.min(1, Number(r?.match) || 0));
    if (!title || !artist) continue;
    similar.push({ artist, title, match });
    if (similar.length >= perSeed) break;
  }
  return { status: similar.length ? "ok" : "notFound", similar };
}

/** Combines per-seed statuses into a truthful overall availability. */
export function overallAvailability(statuses: readonly (SeedStatus | "rateLimited" | "badKey")[]): SimilarAvailability {
  if (!statuses.length) return "noSeeds";
  if (statuses.every(s => s === "badKey")) return "missingKey";
  const answered = statuses.filter(s => s === "ok" || s === "notFound").length;
  if (answered === statuses.length) return "ok";
  if (answered > 0) return "partial";
  return statuses.some(s => s === "rateLimited") ? "rateLimited" : "unavailable";
}

/**
 * Aggregates per-seed results by exact song identity (versions stay distinct).
 * Support = number of distinct requested tracks that list the candidate; repeated or duplicate seeds never count twice,
 * and a requested track never supports itself.
 */
export function aggregateSimilar(results: readonly SeedResult[]): SimilarTrackEvidence[] {
  const bySeed = new Map<string, SeedResult>();
  for (const r of results) { const k = songIdentity(r.seed.artist, r.seed.title); if (!bySeed.has(k)) bySeed.set(k, r); }
  const out = new Map<string, SimilarTrackEvidence & { seedKeys: Set<string> }>();
  for (const [seedKey, r] of bySeed) {
    if (r.status !== "ok") continue;
    for (const s of r.similar) {
      const key = songIdentity(s.artist, s.title);
      if (bySeed.has(key)) continue;
      const cur = out.get(key) ?? { key, artist: s.artist, song: s.title, seeds: [], bestMatch: 0, seedKeys: new Set<string>() };
      if (!cur.seedKeys.has(seedKey)) { cur.seedKeys.add(seedKey); cur.seeds.push(`${r.seed.artist} – ${r.seed.title}`); }
      cur.bestMatch = Math.max(cur.bestMatch, s.match);
      out.set(key, cur);
    }
  }
  return [...out.values()].map(({ seedKeys: _s, ...e }) => e)
    .sort((a, b) => b.seeds.length - a.seeds.length || b.bestMatch - a.bestMatch || a.key.localeCompare(b.key));
}

/** Readable, non-percentage availability note. */
export function availabilityNote(a: SimilarAvailability, seedCount: number): string {
  switch (a) {
    case "ok": return `Using Last.fm similar tracks for ${seedCount} requested track${seedCount === 1 ? "" : "s"}.`;
    case "partial": return "Last.fm answered for some requested tracks only; the rest use other evidence.";
    case "missingKey": return "Last.fm isn't configured for this app; recommendations use other evidence.";
    case "rateLimited": return "Last.fm is busy (rate limited); recommendations use other evidence. Try again later.";
    case "unavailable": return "Couldn't reach Last.fm; recommendations use other evidence.";
    case "noSeeds": return "No client requests with both artist and title to compare with yet.";
  }
}

/** Points for track-level evidence: always stronger than the artist-only Last.fm neighbour (max 2). */
export const similarTrackPoints = (e: SimilarTrackEvidence) => 2.5 + 1 * Math.min(3, e.seeds.length - 1) + e.bestMatch;

export type SimilarCache = Map<string, { at: number; value: SeedResult }>;
type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;
const CACHE_MS = 6 * 60 * 60 * 1000;

/**
 * Server-side worker for track.getSimilar (testable with a fake fetch). Bounded concurrency and per-call timeout;
 * successful/not-found answers are cached, failures never are. A rate limit stops further calls this run.
 */
export async function runSimilarTracks(key: string | undefined, rawSeeds: readonly TrackSeed[], perSeed: number, fetchImpl: FetchLike, cache: SimilarCache, now = () => Date.now()): Promise<SimilarTracksResponse> {
  const seeds = seedsFromRequests(rawSeeds);
  if (!seeds.length) return { availability: "noSeeds", seeds: [] };
  if (!key) return { availability: "missingKey", seeds: [] };
  const statuses: Array<SeedStatus | "rateLimited" | "badKey"> = [];
  const results: SeedResult[] = [];
  const queue = [...seeds];
  let stop = false;
  const worker = async () => {
    for (;;) {
      const seed = queue.shift();
      if (!seed) return;
      if (stop) { statuses.push("rateLimited"); results.push({ seed, status: "error", similar: [] }); continue; }
      const ck = `${songIdentity(seed.artist, seed.title)}|${perSeed}`;
      const hit = cache.get(ck);
      if (hit && now() - hit.at < CACHE_MS) { statuses.push(hit.value.status); results.push(hit.value); continue; }
      let body: unknown = null;
      try {
        const url = new URL("https://ws.audioscrobbler.com/2.0/");
        for (const [k, v] of Object.entries({ method: "track.getsimilar", artist: seed.artist, track: seed.title, autocorrect: "0", limit: String(perSeed), api_key: key, format: "json" })) url.searchParams.set(k, v);
        const res = await fetchImpl(url.toString(), { headers: { "User-Agent": "DancefloorBuilder/1.0" }, signal: AbortSignal.timeout(SIMILAR_LIMITS.timeoutMs) });
        if (res.status === 429) body = { error: 29 };
        else {
          const json = await res.json().catch(() => null);
          // Non-2xx responses count only through an explicit Last.fm API error code; otherwise they are failures.
          body = res.status >= 200 && res.status < 300 ? json : json && typeof json === "object" && (json as { error?: unknown }).error !== undefined ? json : null;
        }
      } catch { body = null; }
      const parsed = parseSimilarBody(body, perSeed);
      if (parsed.status === "rateLimited") stop = true;
      statuses.push(parsed.status);
      const value: SeedResult = { seed, status: parsed.status === "ok" || parsed.status === "notFound" ? parsed.status : "error", similar: parsed.similar };
      if (parsed.status === "ok" || parsed.status === "notFound") cache.set(ck, { at: now(), value });
      results.push(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIMILAR_LIMITS.concurrency, queue.length) }, worker));
  return { availability: overallAvailability(statuses), seeds: results };
}
