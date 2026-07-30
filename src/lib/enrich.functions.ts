/**
 * Song metadata enrichment from online sources.
 *
 * Sources (both keyless, public APIs):
 *  - ReccoBeats (https://reccobeats.com) — Spotify-derived audio features:
 *    energy, danceability, valence, popularity, tempo (BPM), musical key.
 *  - MusicBrainz (https://musicbrainz.org) — genre tags + release year.
 *
 * Results are cached in `public.song_metadata_cache` (keyed by normalized
 * artist + song) so repeat lookups across workflows and users skip the
 * network entirely. Cache TTL: 90 days.
 *
 * Auth: `requireSupabaseAuth` — same posture as the AI recommender. Cache
 * upserts use the service role since the SELECT policy is authenticated-
 * read only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toCamelot } from "./musicTheory";
import { normalizeKey } from "./danceFloor";

const InputSchema = z.object({
  songs: z
    .array(
      z.object({
        artist: z.string().max(300),
        song: z.string().max(300),
      }),
    )
    .max(200),
});

export type EnrichSource =
  | "ReccoBeats+MusicBrainz"
  | "ReccoBeats"
  | "MusicBrainz"
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
}

const CACHE_TTL_DAYS = 90;
// Bounded parallelism + hard budget keep generation responsive; anything not
// enriched in time falls back to VirtualDJ metadata / heuristics.
const FETCH_CONCURRENCY = 8;
const FETCH_BUDGET_MS = 20_000;
const REQUEST_TIMEOUT_MS = 6_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
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
}

async function fetchReccoBeats(
  artist: string,
  song: string,
): Promise<ReccoBeatsFeatures | null> {
  try {
    const q = encodeURIComponent(`${song} ${artist}`.trim());
    const searchRes = await fetchWithTimeout(
      `https://api.reccobeats.com/v1/track/search?searchText=${q}&limit=10`,
      { headers: { Accept: "application/json" } },
    );
    if (!searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as {
      content?: Array<{
        id?: string;
        trackTitle?: string;
        artists?: Array<{ name?: string }>;
        popularity?: number;
      }>;
    };
    const items = searchJson.content ?? [];
    // Pick the first result whose artist matches loosely.
    const match = items.find((it) => {
      const artistNames = (it.artists ?? [])
        .map((a) => a?.name ?? "")
        .filter(Boolean);
      return artistNames.some((n) => artistLooseMatch(n, artist));
    });
    if (!match?.id) return null;

    const featRes = await fetchWithTimeout(
      `https://api.reccobeats.com/v1/track/${encodeURIComponent(match.id)}/audio-features`,
      { headers: { Accept: "application/json" } },
    );
    if (!featRes.ok) {
      // Popularity alone is still useful.
      return { popularity: popularityTo10(match.popularity) };
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
    };
  } catch {
    return null;
  }
}

interface MusicBrainzInfo {
  genre?: string;
  year?: number;
}

async function fetchMusicBrainz(
  artist: string,
  song: string,
): Promise<MusicBrainzInfo | null> {
  try {
    // MusicBrainz Lucene query — quoted terms escape reserved chars.
    const escape = (s: string) => s.replace(/["\\]/g, " ").trim();
    const q = `artist:"${escape(artist)}" AND recording:"${escape(song)}"`;
    const res = await fetchWithTimeout(
      `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=5`,
      {
        headers: {
          Accept: "application/json",
          // MusicBrainz requires a descriptive UA identifying the app.
          "User-Agent":
            "DancefloorBuilder/1.0 (https://dancefloor-builder.lovable.app)",
        },
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      recordings?: Array<{
        title?: string;
        "artist-credit"?: Array<{ name?: string; artist?: { name?: string } }>;
        "first-release-date"?: string;
        tags?: Array<{ name?: string; count?: number }>;
      }>;
    };
    const recs = json.recordings ?? [];
    const match = recs.find((r) => {
      const credits = (r["artist-credit"] ?? [])
        .map((c) => c?.name ?? c?.artist?.name ?? "")
        .filter(Boolean);
      return credits.some((n) => artistLooseMatch(n, artist));
    });
    if (!match) return null;
    const year = parseYear(match["first-release-date"]);
    const topTag = (match.tags ?? [])
      .filter((t) => t?.name)
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0]?.name;
    return { year, genre: topTag };
  } catch {
    return null;
  }
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

export const enrichSongs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (!data.songs.length) return { results: [] as EnrichedSong[] };

    // Build normalized keys and de-dupe (multiple identical songs in one batch).
    type Query = {
      original: { artist: string; song: string };
      artistKey: string;
      songKey: string;
    };
    const queries: Query[] = data.songs.map((s) => ({
      original: s,
      artistKey: normalizeKey(s.artist),
      songKey: normalizeKey(s.song),
    }));

    // 1) Cache read.
    const cacheKeys = Array.from(
      new Set(queries.filter((q) => q.artistKey && q.songKey).map((q) => `${q.artistKey}\u0000${q.songKey}`)),
    );
    const cache = new Map<string, EnrichedSong>();
    if (cacheKeys.length) {
      const artistKeys = Array.from(new Set(queries.map((q) => q.artistKey))).filter(Boolean);
      const songKeys = Array.from(new Set(queries.map((q) => q.songKey))).filter(Boolean);
      const { data: rows } = await context.supabase
        .from("song_metadata_cache")
        .select(
          "artist_key, song_key, energy, danceability, valence, popularity, bpm, camelot, genre, year, source, fetched_at",
        )
        .in("artist_key", artistKeys)
        .in("song_key", songKeys);
      const cutoffMs = Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
      for (const row of rows ?? []) {
        const fetchedMs = row.fetched_at ? new Date(row.fetched_at).getTime() : 0;
        if (fetchedMs < cutoffMs) continue; // stale — force refetch
        cache.set(`${row.artist_key}\u0000${row.song_key}`, {
          artist: "", // filled in from query
          song: "",
          energy: row.energy ?? undefined,
          danceability: row.danceability ?? undefined,
          valence: row.valence ?? undefined,
          popularity: row.popularity ?? undefined,
          bpm: row.bpm ?? undefined,
          camelot: row.camelot ?? undefined,
          genre: row.genre ?? undefined,
          year: row.year ?? undefined,
          source: "cache",
        });
      }
    }

    // 2) Determine misses (unique per normalized key).
    const missSet = new Set<string>();
    const missOrder: Query[] = [];
    for (const q of queries) {
      const k = `${q.artistKey}\u0000${q.songKey}`;
      if (!q.artistKey || !q.songKey) continue;
      if (cache.has(k)) continue;
      if (missSet.has(k)) continue;
      missSet.add(k);
      missOrder.push(q);
    }

    // 3) Fetch misses with a bounded worker pool and an overall deadline.
    //    Previously this ran strictly sequentially with a 1.1s spacer, so a
    //    single 200-song batch cost 220s+. Providers tolerate modest
    //    concurrency; anything that fails or runs past the deadline simply
    //    falls back to VirtualDJ/heuristic data on the caller side.
    const fetched = new Map<string, EnrichedSong>();
    const deadline = Date.now() + FETCH_BUDGET_MS;
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= missOrder.length) return;
        if (Date.now() > deadline) return;
        const q = missOrder[i];
        const [reco, mb] = await Promise.all([
          fetchReccoBeats(q.original.artist, q.original.song),
          fetchMusicBrainz(q.original.artist, q.original.song),
        ]);
        fetched.set(`${q.artistKey}\u0000${q.songKey}`, {
          artist: q.original.artist,
          song: q.original.song,
          energy: reco?.energy,
          danceability: reco?.danceability,
          valence: reco?.valence,
          popularity: reco?.popularity,
          bpm: reco?.bpm,
          camelot: reco?.camelot,
          genre: mb?.genre,
          year: mb?.year,
          source: pickSource(!!reco, !!mb),
        });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, missOrder.length) }, worker),
    );
    if (fetched.size < missOrder.length) {
      console.warn(
        `[enrichSongs] enriched ${fetched.size}/${missOrder.length} misses before budget (${FETCH_BUDGET_MS}ms)`,
      );
    }

    // 4) Upsert successful fetches into the cache (service role bypasses RLS).
    const toUpsert = Array.from(fetched.entries())
      .filter(([, e]) => e.source !== "none")
      .map(([k, e]) => {
        const [artist_key, song_key] = k.split("\u0000");
        return {
          artist_key,
          song_key,
          energy: e.energy ?? null,
          danceability: e.danceability ?? null,
          valence: e.valence ?? null,
          popularity: e.popularity ?? null,
          bpm: e.bpm ?? null,
          camelot: e.camelot ?? null,
          genre: e.genre ?? null,
          year: e.year ?? null,
          source: e.source,
          fetched_at: new Date().toISOString(),
        };
      });
    if (toUpsert.length) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin
          .from("song_metadata_cache")
          .upsert(toUpsert, { onConflict: "artist_key,song_key" });
      } catch (err) {
        // Cache write failure is non-fatal — we still return the fresh data.
        console.warn("[enrichSongs] cache upsert failed", err);
      }
    }

    // 5) Assemble per-input results (preserves order + duplicates).
    const results: EnrichedSong[] = queries.map((q) => {
      const k = `${q.artistKey}\u0000${q.songKey}`;
      const cached = cache.get(k);
      if (cached) {
        return { ...cached, artist: q.original.artist, song: q.original.song };
      }
      const got = fetched.get(k);
      if (got) return got;
      return {
        artist: q.original.artist,
        song: q.original.song,
        source: "none" as const,
      };
    });
    return { results };
  });
