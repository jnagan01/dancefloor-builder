import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Last.fm crowd data.
 *
 * Adds real-world listening data (how many people actually listen to an
 * artist, what the crowd tags them as, and which artists their audience also
 * plays) on top of the AI similarity cluster in neighbors.functions.ts.
 *
 * Needs LASTFM_API_KEY. Without it every call returns available:false and the
 * caller silently falls back to the AI-only path.
 */

const InputSchema = z.object({
  artists: z.array(z.string().max(150)).max(40).default([]),
  perArtistSimilar: z.number().int().min(0).max(20).default(10),
});

export interface SimilarArtist {
  name: string;
  /** 0–1 similarity score reported by Last.fm. */
  match: number;
}

export interface ArtistCrowd {
  name: string;
  /** Unique listeners on Last.fm (popularity proxy). */
  listeners: number;
  /** Total scrobbles (play volume proxy). */
  playcount: number;
  /** Crowd-applied tags, most used first (genre / vibe signal). */
  tags: string[];
  similar: SimilarArtist[];
}

const API = "https://ws.audioscrobbler.com/2.0/";
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: ArtistCrowd | null }>();

const sanitize = (s: string, max = 150): string =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

async function callLastfm(
  key: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "DancefloorBuilder/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchArtist(
  key: string,
  artist: string,
  perArtistSimilar: number,
): Promise<ArtistCrowd | null> {
  const cacheKey = `${artist.toLowerCase()}|${perArtistSimilar}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const [info, sim] = await Promise.all([
    callLastfm(key, { method: "artist.getinfo", artist, autocorrect: "1" }),
    perArtistSimilar > 0
      ? callLastfm(key, {
          method: "artist.getsimilar",
          artist,
          autocorrect: "1",
          limit: String(perArtistSimilar),
        })
      : Promise.resolve(null),
  ]);

  let value: ArtistCrowd | null = null;
  const a = (info?.["artist"] ?? null) as
    | {
        name?: string;
        stats?: { listeners?: unknown; playcount?: unknown };
        tags?: { tag?: Array<{ name?: string }> | { name?: string } };
      }
    | null;

  if (a) {
    const rawTags = a.tags?.tag;
    const tagList = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
    const similarRaw =
      ((sim?.["similarartists"] as { artist?: Array<{ name?: string; match?: unknown }> } | undefined)
        ?.artist) ?? [];
    value = {
      name: sanitize(a.name || artist),
      listeners: num(a.stats?.listeners),
      playcount: num(a.stats?.playcount),
      tags: tagList
        .map((t) => sanitize(String(t?.name ?? ""), 40))
        .filter(Boolean)
        .slice(0, 6),
      similar: (Array.isArray(similarRaw) ? similarRaw : [])
        .map((s) => ({
          name: sanitize(String(s?.name ?? "")),
          match: Math.max(0, Math.min(1, Number(s?.match) || 0)),
        }))
        .filter((s) => s.name)
        .slice(0, perArtistSimilar),
    };
  }

  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export const getArtistCrowdData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<{ available: boolean; artists: ArtistCrowd[] }> => {
    const key = process.env["LASTFM_API_KEY"];
    if (!key) return { available: false, artists: [] };

    const artists = data.artists.map((a) => sanitize(a)).filter(Boolean).slice(0, 40);
    if (!artists.length) return { available: true, artists: [] };

    // Keep Last.fm happy: small concurrency instead of 80 parallel requests.
    const out: ArtistCrowd[] = [];
    const queue = [...artists];
    const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const got = await fetchArtist(key, next, data.perArtistSimilar);
        if (got) out.push(got);
      }
    });
    await Promise.all(workers);

    return { available: true, artists: out };
  });
