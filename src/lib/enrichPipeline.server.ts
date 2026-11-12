/**
 * Online metadata enrichment pipeline (ReccoBeats + MusicBrainz, AI gap estimates, shared cache) with
 * per-attribute provenance. Storage is injected so the real pipeline runs in isolated tests.
 */
import { toCamelot } from "./musicTheory";
import { normalizeKey } from "./danceFloor";
import { decodeCacheSource, encodeCacheSource, sourceRank, type MetaProv } from "./prep/provenance";
import { ENRICH_SERVER_DEADLINE_MS } from "./prep/factsGather";
import { createProviderLane, ENRICH_PROVIDER_CONCURRENCY, MUSICBRAINZ_GROUP, MUSICBRAINZ_INTERVAL_MS } from "./enrichScheduling.server";

export type EnrichSource =
  | "ReccoBeats+MusicBrainz"
  | "ReccoBeats"
  | "MusicBrainz"
  | "AI"
  | "cache"
  | "none";

export interface EnrichedSong {
  artist: string;
  song: string;
  energy?: number;
  danceability?: number;
  valence?: number;
  popularity?: number;
  bpm?: number;
  camelot?: string;
  genre?: string;
  year?: number;
  source: EnrichSource;
  /** Per-attribute provenance. Absent from older servers; clients then decode `source` conservatively. */
  prov?: MetaProv;
  /** The online lookup for this song didn't finish in time; values (if any) are only what was already known. */
  incomplete?: boolean;
}

const CACHE_TTL_DAYS = 90;
// Bounded parallelism + hard budget keep generation responsive; anything not
// enriched in time falls back to VirtualDJ metadata / heuristics.
// Independent lanes use at most five outbound provider connections, leaving one for storage.

/**
 * End-to-end server deadlines. The WHOLE call (cache read, provider fetches, AI estimate, cache write, assembly) finishes
 * by `totalMs`, which sits a fixed margin below the client's per-chunk cutoff so completed results (cache hits included)
 * always reach the client instead of being discarded with a hung miss. Every phase is raced against its own deadline,
 * in-flight work is aborted where the transport allows, and late results are fenced out.
 */
export interface EnrichLimits { totalMs: number; cacheReadMs: number; aiMs: number; upsertMs: number; requestMs: number; assemblyMs: number }
export const ENRICH_LIMITS: EnrichLimits = { totalMs: ENRICH_SERVER_DEADLINE_MS, cacheReadMs: 3_000, aiMs: 4_000, upsertMs: 1_000, requestMs: 6_000, assemblyMs: 250 };
export type EnrichPhase = "cacheRead" | "fetch" | "ai" | "upsert";
export interface EnrichStatus {
  /** True only when every phase finished in time and every looked-up song got a full provider/AI attempt. */
  complete: boolean;
  timedOut: EnrichPhase[];
  /** Songs whose online lookup didn't finish; they return only what was already known (cache/partial), never invented. */
  unfinished: number;
  /** Storage failures are distinct from ordinary misses; provider facts remain usable. */
  failed?: EnrichPhase[];
  /** Pause subsequent serial chunks after provider rate pressure; no failed recording is replayed. */
  retryAfterMs?: number;
}

interface FetchCtx { signal: AbortSignal; until: number; requestMs: number; now: () => number; lane?: ReturnType<typeof createProviderLane>; failed?: boolean; timedOut?: boolean }

async function fetchWithTimeout(url: string, init: RequestInit, ctx?: FetchCtx): Promise<Response> {
  if (ctx?.lane && !(await ctx.lane.ready())) { ctx.failed = true; throw new Error("Provider paused"); }
  const ctrl = new AbortController();
  const ms = ctx ? Math.max(1, Math.min(ctx.requestMs, ctx.until - ctx.now())) : ENRICH_LIMITS.requestMs;
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (ctx?.signal.aborted) ctrl.abort(); else ctx?.signal.addEventListener("abort", onAbort);
  try {
    const response = await within(fetch(url, { ...init, signal: ctrl.signal }), Date.now() + ms, Date.now);
    if (response === LATE) { if (ctx) ctx.timedOut = true; ctrl.abort(); throw new Error("Provider request deadline"); }
    ctx?.lane?.response(response);
    if (ctx && !response.ok) ctx.failed = true;
    return response;
  } catch (err) {
    if (ctx) ctx.failed = true;
    if (ctx && ctrl.signal.aborted) ctx.timedOut = true;
    throw err;
  } finally {
    clearTimeout(timer);
    ctx?.signal.removeEventListener("abort", onAbort);
  }
}

const LATE = Symbol("late");
/** Race `p` against an absolute deadline; the timer is always cleared and a late rejection never goes unhandled. */
async function within<T>(p: Promise<T>, until: number, now: () => number): Promise<T | typeof LATE> {
  p.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<typeof LATE>((res) => { timer = setTimeout(() => res(LATE), Math.max(0, until - now())); })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ReccoBeats: 0..1 continuous → app's 1..10 integer scale (matches intensityOf).
function toScore10(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const clamped = Math.max(0, Math.min(1, v));
  return Math.max(1, Math.min(10, Math.round(clamped * 9 + 1)));
}

// ReccoBeats popularity is already 0..100. Rescale to 1..10.
function popularityTo10(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const clamped = Math.max(0, Math.min(100, v));
  return Math.max(1, Math.min(10, Math.round(clamped / 10)));
}

function parseYear(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^(\d{4})/);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (n < 1900 || n > 2099) return undefined;
  return n;
}

/**
 * Fuzzy artist match: at least one shared normalized token OR one contains
 * the other. Guards against ReccoBeats returning "Adele Roberts" when we
 * searched for "Adele".
 */
function artistLooseMatch(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  for (const t of ta) if (t.length >= 3 && tb.has(t)) return true;
  return false;
}

interface ReccoBeatsFeatures {
  energy?: number;
  danceability?: number;
  valence?: number;
  popularity?: number;
  bpm?: number;
  camelot?: string;
  /** True only when the matched catalogue title and version equal the requested ones. */
  exact: boolean;
}

/** Full-title identity: case/accents/punctuation normalised, every word kept (remixer names included). */
export function fullTitleKey(title: string): string {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
/** Verified recording title: the complete version descriptor must match ("Tiesto Remix" ≠ "David Guetta Remix").
 * Anything looser stays an estimate (false negatives preferred over false verification). */
export function sameRecordingTitle(want: string, got: string): boolean {
  const w = fullTitleKey(want);
  return !!w && w === fullTitleKey(got);
}
/** Verified artist identity: an exact (normalised) credit for the requested artist, its primary artist or the whole
 * joined credit. Token overlap ("Adele" vs "Adele Roberts") never counts. */
export function exactArtistCredit(credits: readonly string[], want: string): boolean {
  const keys = credits.map(fullTitleKey).filter(Boolean);
  if (!keys.length) return false;
  const full = fullTitleKey(want);
  const primary = fullTitleKey(want.split(/\s*(?:,|&| x | feat\.?| ft\.?| featuring| and )\s*/i)[0] || want);
  return keys.includes(full) || (!!primary && keys.includes(primary)) || fullTitleKey(credits.join(" ")) === full;
}

/**
 * Strip version/feature noise so ReccoBeats' title-only search can hit.
 * "Yeah! (feat. Lil Jon) [Clean Radio Edit]" → "Yeah!"
 */
export function cleanTitleForSearch(song: string): string {
  return song
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")
    .replace(/\s+(feat\.?|ft\.?|featuring|with)\s+.*$/i, " ")
    .replace(/\s+-\s+.*(edit|mix|version|remaster|remastered|clean|dirty|live|intro|extended).*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type RbItem = {
  id?: string;
  trackTitle?: string;
  artists?: Array<{ name?: string }>;
  popularity?: number;
};

async function searchReccoBeats(text: string, page = 0, ctx?: FetchCtx): Promise<RbItem[]> {
  const q = encodeURIComponent(text);
  const res = await fetchWithTimeout(
    `https://api.reccobeats.com/v1/track/search?searchText=${q}&size=25&page=${page}`,
    { headers: { Accept: "application/json" } },
    ctx,
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { content?: RbItem[] };
  return json.content ?? [];
}

async function fetchReccoBeats(
  artist: string,
  song: string,
  ctx?: FetchCtx,
): Promise<ReccoBeatsFeatures | null> {
  try {
    // ReccoBeats indexes titles only — never send "title artist".
    const clean = cleanTitleForSearch(song) || song.trim();
    const wantTitle = normalizeKey(clean);
    const primaryArtist = artist.split(/\s*(?:,|&| x | feat\.?| ft\.?| featuring| and )\s*/i)[0] || artist;
    const names = (it: RbItem) => (it.artists ?? []).map((a) => a?.name ?? "").filter(Boolean);
    const isExact = (it: RbItem) => exactArtistCredit(names(it), artist) && sameRecordingTitle(song, it.trackTitle ?? "");
    const pick = (items: RbItem[]) => {
      // An exact artist+full-title candidate always wins over the first loose base-title candidate.
      const exactHit = items.find(isExact);
      if (exactHit) return exactHit;
      const byArtist = items.filter((it) =>
        (it.artists ?? []).some((a) => a?.name && (artistLooseMatch(a.name, artist) || artistLooseMatch(a.name, primaryArtist))),
      );
      return (
        byArtist.find((it) => normalizeKey(cleanTitleForSearch(it.trackTitle ?? "")) === wantTitle) ??
        byArtist[0]
      );
    };
    let match = pick(await searchReccoBeats(clean, 0, ctx));
    if (!match && !ctx?.signal.aborted) match = pick(await searchReccoBeats(clean, 1, ctx));
    if (!match?.id) return null;

    let featRes: Response;
    try { featRes = await fetchWithTimeout(
      `https://api.reccobeats.com/v1/track/${encodeURIComponent(match.id)}/audio-features`,
      { headers: { Accept: "application/json" } },
      ctx,
    ); } catch { return { popularity: popularityTo10(match.popularity), exact: isExact(match) }; }
    const exact = isExact(match);
    if (!featRes.ok) {
      // Popularity alone is still useful.
      return { popularity: popularityTo10(match.popularity), exact };
    }
    const feat = (await featRes.json()) as {
      energy?: number;
      danceability?: number;
      valence?: number;
      tempo?: number;
      key?: number; // 0..11 pitch class
      mode?: number; // 0 minor, 1 major
    };
    // Convert Spotify key/mode → musical → Camelot.
    let camelot: string | undefined;
    if (typeof feat.key === "number" && feat.key >= 0 && feat.key <= 11) {
      const pcs = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const isMinor = feat.mode === 0;
      camelot = toCamelot(pcs[feat.key] + (isMinor ? "m" : ""));
    }
    return {
      energy: toScore10(feat.energy),
      danceability: toScore10(feat.danceability),
      valence: toScore10(feat.valence),
      popularity: popularityTo10(match.popularity),
      bpm:
        typeof feat.tempo === "number" && feat.tempo > 0
          ? Math.round(feat.tempo)
          : undefined,
      camelot,
      exact,
    };
  } catch {
    return null;
  }
}

interface MusicBrainzInfo {
  genre?: string;
  year?: number;
  exact?: boolean;
  incomplete?: boolean;
}

/** OR groups reduce rate-limited recording searches; each result is independently identity-checked.
 * Never label a truncated group response as a definitive miss. */
async function fetchMusicBrainzGroup(songs: Array<{ artist: string; song: string }>, ctx: FetchCtx): Promise<Array<MusicBrainzInfo | null> | null> {
  try {
    const escape = (s: string) => s.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, " ").trim();
    const q = songs.map(s => `(artist:"${escape(s.artist)}" AND recording:"${escape(s.song)}")`).join(" OR ");
    const res = await fetchWithTimeout(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=100`, {
      headers: { Accept: "application/json", "User-Agent": "DancefloorBuilder/1.0 (https://dancefloor-builder.lovable.app)" },
    }, ctx);
    if (!res.ok) return null;
    const json = await res.json() as { count?: number; recordings?: Array<{ title?: string; "artist-credit"?: Array<{ name?: string; artist?: { name?: string } }>; "first-release-date"?: string; tags?: Array<{ name?: string; count?: number }> }> };
    const recs = json.recordings ?? [];
    return songs.map(s => {
      const credits = (r: typeof recs[number]) => (r["artist-credit"] ?? []).map(c => c.name ?? c.artist?.name ?? "").filter(Boolean);
      const exact = recs.find(r => exactArtistCredit(credits(r), s.artist) && sameRecordingTitle(s.song, r.title ?? ""));
      // Group searches must not lend a different song's facts merely because its artist matches.
      const match = exact ?? recs.find(r => (sameRecordingTitle(s.song, r.title ?? "") || (songs.length === 1 && normalizeKey(cleanTitleForSearch(s.song)) === normalizeKey(cleanTitleForSearch(r.title ?? "")))) && credits(r).some(n => artistLooseMatch(n, s.artist)));
      if (!match) return (json.count ?? recs.length) >= 100 ? { exact: false, incomplete: true } : null;
      return { year: parseYear(match["first-release-date"]), genre: (match.tags ?? []).filter(t => t.name).sort((a,b) => (b.count ?? 0) - (a.count ?? 0))[0]?.name, exact: !!exact };
    });
  } catch { return null; }
}

interface AiEstimate {
  energy?: number;
  danceability?: number;
  valence?: number;
  bpm?: number;
  genre?: string;
  year?: number;
}

/**
 * Fallback acoustic profiler: one batched AI call estimating 1–10 Energy,
 * Danceability and Valence for songs no catalog covers. Returns one entry
 * per input (null when the model skipped it). Failures return all-null.
 */
async function estimateWithAi(
  songs: Array<{ artist: string; song: string; genre?: string; year?: number; bpm?: number }>,
  signal?: AbortSignal,
  onItem?: (index: number, value: AiEstimate) => void,
): Promise<Array<AiEstimate | null>> {
  const out: Array<AiEstimate | null> = songs.map(() => null);
  const key = process.env.LOVABLE_API_KEY;
  if (!songs.length) return out;
  if (!key) throw new Error("AI estimate unavailable");
  try {
    const { streamText } = await import("ai");
    const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
    const gateway = createLovableAiGatewayProvider(key);
    const clean = (s: string) => s.replace(/[\u0000-\u001F<>]/g, " ").slice(0, 150);
    const lines = songs
      .map((s, i) => `${i}. ${clean(s.artist)} — ${clean(s.song)}${s.genre ? ` | genre: ${clean(s.genre)}` : ""}${s.year ? ` | ${s.year}` : ""}${s.bpm ? ` | ${s.bpm} BPM` : ""}`)
      .join("\n");
    const prompt = `You are a DJ audio analyst. For each song, estimate Spotify-style audio features on a 1-10 integer scale: energy, danceability, valence (musical positivity). Also give bpm (integer), a short genre, and release year if you know them. Base it on your knowledge of the actual recording.
Return ONLY JSON: {"items":[{"i":0,"energy":7,"danceability":8,"valence":6,"bpm":120,"genre":"Pop","year":2004}, ...]} with one item per song.

${lines}`;
    const result = streamText({
      model: gateway("openai/gpt-6-astra"),
      prompt,
      providerOptions: { lovable: { reasoningEffort: "low" } },
      abortSignal: signal,
      maxRetries: 0,
    });
    let text = "";
    const delivered = new Set<number>();
    const emit = () => {
      for (const m of text.matchAll(/\{[^{}]*"i"\s*:\s*\d+[^{}]*\}/g)) {
        try {
          const item = JSON.parse(m[0]);
          const i = item.i;
          if (!Number.isInteger(i) || i < 0 || i >= songs.length || delivered.has(i)) continue;
          const score = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v <= 1 ? toScore10(v) : Math.max(1, Math.min(10, Math.round(v))) : undefined;
          const value = { energy: score(item.energy), danceability: score(item.danceability), valence: score(item.valence), bpm: typeof item.bpm === "number" && item.bpm > 40 && item.bpm < 250 ? Math.round(item.bpm) : undefined, year: typeof item.year === "number" && item.year >= 1900 && item.year <= 2099 ? Math.round(item.year) : undefined, genre: typeof item.genre === "string" ? item.genre.slice(0,60) : undefined };
          out[i] = value; delivered.add(i); onItem?.(i, value);
        } catch { /* incomplete frame */ }
      }
    };
    for await (const delta of result.textStream) { text += delta; emit(); }

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI estimate unavailable");
    const parsed = JSON.parse(text.slice(start, end + 1)) as { items?: Array<Record<string, unknown>> };
    const score = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v)
        ? v <= 1 ? toScore10(v) : Math.max(1, Math.min(10, Math.round(v)))
        : undefined;
    for (const it of parsed.items ?? []) {
      const i = typeof it.i === "number" ? it.i : -1;
      if (i < 0 || i >= songs.length) continue;
      const bpm = typeof it.bpm === "number" && it.bpm > 40 && it.bpm < 250 ? Math.round(it.bpm) : undefined;
      const year = typeof it.year === "number" && it.year >= 1900 && it.year <= 2099 ? Math.round(it.year) : undefined;
      out[i] = {
        energy: score(it.energy),
        danceability: score(it.danceability),
        valence: score(it.valence),
        bpm,
        genre: typeof it.genre === "string" ? it.genre.slice(0, 60) : undefined,
        year,
      };
    }
  } catch (err) {
    console.warn("[enrichSongs] AI estimate unavailable; completed estimates retained");
    throw new Error("AI estimate unavailable");
  }
  return out;
}

function pickSource(
  hasFeatures: boolean,
  hasMb: boolean,
): EnrichSource {
  if (hasFeatures && hasMb) return "ReccoBeats+MusicBrainz";
  if (hasFeatures) return "ReccoBeats";
  if (hasMb) return "MusicBrainz";
  return "none";
}


export interface CacheRow {
  artist_key: string; song_key: string; energy: number | null; danceability: number | null; valence: number | null;
  popularity: number | null; bpm: number | null; camelot: string | null; genre: string | null; year: number | null;
  source: string; fetched_at: string | null;
}
/** Internal error with optional recovered rows; never print this object or its payload. */
export class EnrichCacheError extends Error {
  constructor(readonly rows: CacheRow[] | null = null) { super('Metadata cache unavailable'); }
}
export interface EnrichDeps {
  readRows(artistKeys: string[], songKeys: string[]): Promise<CacheRow[] | null>;
  upsert(rows: Array<Omit<CacheRow, "fetched_at"> & { fetched_at: string }>): Promise<void>;
  estimate?: (songs: Parameters<typeof estimateWithAi>[0], signal?: AbortSignal, onItem?: (index: number, value: AiEstimate) => void) => ReturnType<typeof estimateWithAi>;
  /** Test/override hooks: phase limits and clock. Production uses ENRICH_LIMITS + Date.now. */
  limits?: Partial<EnrichLimits>;
  now?: () => number;
}
export interface EnrichOptions {
  /** Active familiarity choice: a fresh cache row lacking track popularity is a partial hit worth one bounded lookup. */
  needPopularity?: boolean;
}

export async function runEnrichment(songs: Array<{ artist: string; song: string }>, deps: EnrichDeps, opts: EnrichOptions = {}): Promise<{ results: EnrichedSong[]; status: EnrichStatus }> {
  const status: EnrichStatus = { complete: true, timedOut: [], unfinished: 0 };
  if (!songs.length) return { results: [] as EnrichedSong[], status };
  const L: EnrichLimits = { ...ENRICH_LIMITS, ...(deps.limits ?? {}) };
  const now = deps.now ?? Date.now;
  const start = now();
  const end = start + L.totalMs - L.assemblyMs; // everything must settle before assembly
  const timeout = (ph: EnrichPhase) => {
    status.complete = false;
    if (!status.timedOut.includes(ph)) status.timedOut.push(ph);
    if (ph === 'cacheRead' || ph === 'upsert') console.warn(`[enrichSongs] metadata cache ${ph} timed out; bounded fallback retained`);
  };
  const cacheFailure = (ph: EnrichPhase) => {
    status.complete = false;
    (status.failed ??= []).push(ph);
    console.warn(`[enrichSongs] metadata cache ${ph} failed; bounded fallback retained`);
  };

  // Build normalized keys and de-dupe (multiple identical songs in one batch).
  type Query = { original: { artist: string; song: string }; artistKey: string; songKey: string };
  const queries: Query[] = songs.map((s) => ({ original: s, artistKey: normalizeKey(s.artist), songKey: normalizeKey(s.song) }));

  // 1) Cache read (bounded; a hung read means "no cache knowledge", never a fabricated hit).
  const cacheKeys = Array.from(new Set(queries.filter((q) => q.artistKey && q.songKey).map((q) => `${q.artistKey}\u0000${q.songKey}`)));
  const cache = new Map<string, EnrichedSong>();
  if (cacheKeys.length) {
    const artistKeys = Array.from(new Set(queries.map((q) => q.artistKey))).filter(Boolean);
    const songKeys = Array.from(new Set(queries.map((q) => q.songKey))).filter(Boolean);
    let rows: CacheRow[] | null = null;
    try {
      const got = await within(Promise.resolve().then(() => deps.readRows(artistKeys, songKeys)), Math.min(end, start + L.cacheReadMs), now);
      if (got === LATE) timeout("cacheRead"); else rows = got;
    } catch (err) {
      cacheFailure('cacheRead');
      rows = err instanceof EnrichCacheError ? err.rows : null;
    }
    const cutoffMs = Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    for (const row of rows ?? []) {
      const fetchedMs = row.fetched_at ? new Date(row.fetched_at).getTime() : 0;
      if (fetchedMs < cutoffMs) continue; // stale — force refetch
      const values = {
        energy: row.energy ?? undefined, danceability: row.danceability ?? undefined, valence: row.valence ?? undefined,
        popularity: row.popularity ?? undefined, bpm: row.bpm ?? undefined, camelot: row.camelot ?? undefined,
        genre: row.genre ?? undefined, year: row.year ?? undefined,
      };
      // Cached rows keep their recorded per-attribute provenance (legacy rows decode conservatively).
      const { summary, prov } = decodeCacheSource(row.source, values);
      cache.set(`${row.artist_key}\u0000${row.song_key}`, { artist: "", song: "", ...values, source: (summary as EnrichSource) || "none", prov });
    }
  }

  // 2) Misses. Rows without energy/danceability are partial hits (re-fetch to upgrade); with an active familiarity choice,
  //    rows lacking track popularity are partial too. Priority is deterministic: true misses / energy gaps first (input
  //    order), popularity-only upgrades last. Partials always keep their cached values if the upgrade doesn't finish.
  const partial = new Map<string, EnrichedSong>();
  const popOnly = new Set<string>();
  for (const [k, c] of cache) {
    if (c.energy == null || c.danceability == null) { partial.set(k, c); cache.delete(k); }
    else if (opts.needPopularity && c.popularity == null) { partial.set(k, c); popOnly.add(k); cache.delete(k); }
  }
  const missSet = new Set<string>();
  const first: Query[] = [], last: Query[] = [];
  for (const q of queries) {
    const k = `${q.artistKey}\u0000${q.songKey}`;
    if (!q.artistKey || !q.songKey || cache.has(k) || missSet.has(k)) continue;
    missSet.add(k);
    (popOnly.has(k) ? last : first).push(q);
  }
  const missOrder = [...first, ...last];

  // 3) Provider fetches: bounded pool, closes early enough to leave room for the AI estimate and the cache write.
  //    In-flight requests are aborted at the phase deadline and their late results are fenced out.
  const fetched = new Map<string, EnrichedSong>();
  const fresh = new Set<string>(); // keys that gained provider/AI data this call (only these are written back)
  const fetchUntil = Math.max(now(), end - L.upsertMs - (missOrder.length ? Math.min(L.aiMs, Math.floor((end - now()) / 3)) : 0));
  const fetchCtrl = new AbortController();
  const ctx: FetchCtx = { signal: fetchCtrl.signal, until: fetchUntil, requestMs: L.requestMs, now };
  const recoCtx = { ...ctx, lane: createProviderLane(now, fetchUntil, fetchCtrl.signal) };
  const mbCtx = { ...ctx, lane: createProviderLane(now, fetchUntil, fetchCtrl.signal, MUSICBRAINZ_INTERVAL_MS) };
  let fetchClosed = false;
  const recoDone = new Map<string, ReccoBeatsFeatures | null>();
  const mbDone = new Map<string, MusicBrainzInfo | null>();
  const open = () => !fetchClosed && now() < fetchUntil;
  const reusesMb = (prev: EnrichedSong | undefined) => !!(prev && (prev.genre || prev.year));
  let recoCursor = 0;
  const providerIncomplete = new Set<string>();
  const providerTimeout = new Set<string>();
  const recoWorker = async () => {
    while (open()) {
      const q = missOrder[recoCursor++];
      if (!q) return;
      const k = `${q.artistKey}\u0000${q.songKey}`;
      const songCtx = { ...recoCtx, failed: false };
      const r = await fetchReccoBeats(q.original.artist, q.original.song, songCtx);
      if (open()) { recoDone.set(k, r); if (songCtx.failed) providerIncomplete.add(k); if (songCtx.timedOut) providerTimeout.add(k); }
      if (recoCtx.lane.pausedUntil >= fetchUntil) return;
    }
  };
  const mbWorker = async () => {
    const todo = missOrder.filter(q => !reusesMb(partial.get(`${q.artistKey}\u0000${q.songKey}`)));
    for (let i = 0; i < todo.length && open(); i += MUSICBRAINZ_GROUP) {
      const group = todo.slice(i, i + MUSICBRAINZ_GROUP);
      const groupCtx = { ...mbCtx, failed: false, timedOut: false };
      const rows = await fetchMusicBrainzGroup(group.map(q => q.original), groupCtx);
      if (open() && groupCtx.failed) for (const q of group) { const k = `${q.artistKey}\u0000${q.songKey}`; providerIncomplete.add(k); if (groupCtx.timedOut) providerTimeout.add(k); mbDone.set(k, null); }
      if (open() && rows) group.forEach((q, j) => { const k = `${q.artistKey}\u0000${q.songKey}`; mbDone.set(k, rows[j] ?? null); if (rows[j]?.incomplete) providerIncomplete.add(k); });
      if (mbCtx.lane.pausedUntil >= fetchUntil) return;
    }
  };
  if (missOrder.length) {
    const pool = Promise.all([mbWorker(), ...Array.from({ length: Math.min(ENRICH_PROVIDER_CONCURRENCY.recco, missOrder.length) }, recoWorker)]);
    const got = await within(pool, fetchUntil, now);
    fetchClosed = true;
    fetchCtrl.abort();
    if (got === LATE) timeout("fetch");
    status.retryAfterMs = Math.max(0, recoCtx.lane.pausedUntil - now(), mbCtx.lane.pausedUntil - now());
  }
  // Assemble from whatever each provider completed. Per-field provenance priority: a fresh value replaces a known one
  // only when its source ranks at least as high, so a loose-match estimate never downgrades cached provider facts.
  const unfinished = new Set<string>(providerIncomplete);
  if (providerTimeout.size) timeout("fetch");
  if (providerIncomplete.size > providerTimeout.size) { status.complete = false; (status.failed ??= []).push("fetch"); }
  for (const q of missOrder) {
    const k = `${q.artistKey}\u0000${q.songKey}`;
    if (fetched.has(k)) continue;
    const prev = partial.get(k);
    const reusedMb = reusesMb(prev);
    const hasReco = recoDone.has(k), hasMb = reusedMb || mbDone.has(k);
    if (!hasReco || !hasMb) {
      unfinished.add(k);
      if (now() >= fetchUntil) timeout("fetch");
      else { status.complete = false; if (!status.failed?.includes("fetch")) (status.failed ??= []).push("fetch"); }
    }
    if (!hasReco && !(mbDone.has(k))) {
      if (prev) fetched.set(k, { ...prev, artist: q.original.artist, song: q.original.song, source: prev.energy != null ? prev.source : "MusicBrainz" });
      continue;
    }
    const reco = recoDone.get(k) ?? null;
    const mb = reusedMb ? null : mbDone.get(k) ?? null;
    const rs = reco?.exact ? "provider" : "estimate";
    const ms = mb?.exact ? "provider" : "estimate";
    const prov: MetaProv = {};
    let gained = false;
    const take = <A extends keyof MetaProv>(a: A, freshV: unknown, src: MetaProv[A], old: unknown) => {
      const oldSrc = old != null ? prev?.prov?.[a] ?? "estimate" : undefined;
      if (freshV != null && (old == null || sourceRank(src) >= sourceRank(oldSrc))) { prov[a] = src; gained = true; return freshV; }
      if (old != null) { prov[a] = oldSrc; return old; }
      return undefined;
    };
    const energy = take("energy", reco?.energy, rs, prev?.energy) as number | undefined;
    const e: EnrichedSong = {
      artist: q.original.artist,
      song: q.original.song,
      energy,
      danceability: take("danceability", reco?.danceability, rs, prev?.danceability) as number | undefined,
      valence: take("valence", reco?.valence, rs, prev?.valence) as number | undefined,
      popularity: take("popularity", reco?.popularity, rs, prev?.popularity) as number | undefined,
      bpm: take("bpm", reco?.bpm, rs, prev?.bpm) as number | undefined,
      camelot: take("camelot", reco?.camelot, rs, prev?.camelot) as string | undefined,
      genre: take("genre", mb?.genre, ms, prev?.genre) as string | undefined,
      year: take("year", mb?.year, ms, prev?.year) as number | undefined,
      source: "none",
      prov,
    };
    const recoEnergy = reco?.energy != null && prov.energy === rs;
    e.source = prev?.energy != null && !recoEnergy ? prev.source : pickSource(reco?.energy != null, !!(mb?.genre || mb?.year));
    fetched.set(k, e);
    if (gained) fresh.add(k);
  }

  // 3b) AI acoustic estimate for anything still missing energy/danceability — bounded and abortable; a late answer is ignored.
  const needAi = missOrder
    .map((q) => ({ q, k: `${q.artistKey}\u0000${q.songKey}` }))
    .filter(({ k }) => { const e = fetched.get(k); return !e || e.energy == null || e.danceability == null; });
  const aiUntil = end - L.upsertMs;
  if (needAi.length && now() < aiUntil) {
    const aiCtrl = new AbortController();
    let aiClosed = false;
    const completed: Array<AiEstimate | null> = needAi.map(() => null);
    const work = async () => {
      for (let offset = 0; offset < needAi.length && !aiClosed; offset += 8) {
        const group = needAi.slice(offset, offset + 8);
        const items = await (deps.estimate ?? estimateWithAi)(
          group.map(({ q, k }) => { const e = fetched.get(k); return { artist: q.original.artist, song: q.original.song, genre: e?.genre, year: e?.year, bpm: e?.bpm }; }),
          aiCtrl.signal,
          (i, value) => { if (!aiClosed && i >= 0 && i < group.length) completed[offset + i] = value; },
        );
        if (!aiClosed) items.forEach((item, i) => { if (i < group.length && item) completed[offset + i] = item; });
      }
    };
    let late = false;
    // Reuse unused provider time; never extend the fixed request end. A healthy 6–12s
    // estimate can finish after a quick provider miss instead of always losing at 4s.
    try { late = await within(work(), aiUntil, now) === LATE; }
    catch { (status.failed ??= []).push("ai"); status.complete = false; for (const { k } of needAi) unfinished.add(k); }
    aiClosed = true;
    if (late) { aiCtrl.abort(); timeout("ai"); for (const { k } of needAi) unfinished.add(k); }
    const est = completed;
    needAi.forEach(({ q, k }, idx) => {
      const a = (est as Array<AiEstimate | null>)[idx];
      if (!a) return;
      const e: EnrichedSong = fetched.get(k) ?? { artist: q.original.artist, song: q.original.song, source: "none" as const };
      // AI only fills gaps and every filled attribute is labelled an AI estimate.
      const prov: MetaProv = { ...(e.prov ?? {}) };
      let filled = false;
      const fill = <A extends "energy" | "danceability" | "valence" | "bpm" | "genre" | "year">(attr: A) => {
        if (e[attr] != null) return e[attr];
        if (a[attr] != null) { prov[attr] = "ai"; filled = true; }
        return a[attr];
      };
      fetched.set(k, {
        ...e,
        energy: fill("energy") as number | undefined,
        danceability: fill("danceability") as number | undefined,
        valence: fill("valence") as number | undefined,
        bpm: fill("bpm") as number | undefined,
        genre: fill("genre") as string | undefined,
        year: fill("year") as number | undefined,
        source: e.source === "none" || e.source === "MusicBrainz" ? "AI" : e.source,
        prov,
      });
      if (filled) fresh.add(k);
    });
  } else if (needAi.length) {
    timeout("ai");
    for (const { k } of needAi) unfinished.add(k);
  }

  // 4) Upsert data gained this call (service role bypasses RLS). Bounded: the response never waits on a hung write;
  //    unchanged partial rows are not rewritten (that would only refresh their TTL without new evidence).
  const toUpsert = Array.from(fetched.entries())
    .filter(([k, e]) => fresh.has(k) && e.source !== "none")
    .map(([k, e]) => {
      const [artist_key, song_key] = k.split("\u0000");
      return {
        artist_key, song_key,
        energy: e.energy ?? null, danceability: e.danceability ?? null, valence: e.valence ?? null, popularity: e.popularity ?? null,
        bpm: e.bpm ?? null, camelot: e.camelot ?? null, genre: e.genre ?? null, year: e.year ?? null,
        source: encodeCacheSource(e.source, e.prov ?? {}),
        fetched_at: new Date().toISOString(),
      };
    });
  if (toUpsert.length) {
    try {
      const got = await within(Promise.resolve().then(() => deps.upsert(toUpsert)), Math.min(end, now() + L.upsertMs), now);
      if (got === LATE) timeout("upsert");
    } catch {
      // Cache write failure is non-fatal — we still return the fresh data.
      cacheFailure('upsert');
    }
  }

  // 5) Assemble per-input results (preserves order + duplicates). Snapshot copies so nothing late can mutate them.
  status.unfinished = unfinished.size;
  if (unfinished.size) status.complete = false;
  const results: EnrichedSong[] = queries.map((q) => {
    const k = `${q.artistKey}\u0000${q.songKey}`;
    const cached = cache.get(k);
    if (cached) return { ...cached, prov: cached.prov && { ...cached.prov }, artist: q.original.artist, song: q.original.song };
    const got = fetched.get(k);
    const inc = unfinished.has(k) ? { incomplete: true as const } : {};
    if (got) return { ...got, prov: got.prov && { ...got.prov }, ...inc };
    return { artist: q.original.artist, song: q.original.song, source: "none" as const, ...inc };
  });
  return { results, status };
}
