import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SIMILAR_LIMITS, runSimilarTracks, type SimilarCache, type SimilarTracksResponse } from "@/lib/prep/similarTracks";

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
import { emptyCounts, type ReuseCounts } from "./songInformation/schema";
import { informationKey } from './songInformation/schema';
import { createEvidenceReuse, createSharedWork, createRequestEvidenceStorage, type Storage } from './songInformation/reuse';
const shared = createSharedWork();

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
  dispatch:()=>void,
): Promise<Record<string, unknown> | null> {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);
  url.searchParams.set("format", "json");
  try {
    dispatch();
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
  storage:Storage,
  end:number,
): Promise<{value:ArtistCrowd|null;counts:ReuseCounts;updatedAt:number;stale:boolean} | null> {
  try {
  const reused = await createEvidenceReuse(storage, shared)<ArtistCrowd>('artist', informationKey('artist', artist, '', String(perArtistSimilar)), async dispatch => {

  const [info, sim] = await Promise.all([
    callLastfm(key, { method: "artist.getinfo", artist, autocorrect: "0" },dispatch),
    perArtistSimilar > 0
      ? callLastfm(key, {
          method: "artist.getsimilar",
          artist,
          autocorrect: "0",
          limit: String(perArtistSimilar),
        },dispatch)
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

  if (!value || (perArtistSimilar > 0 && !sim)) throw new Error('Artist information unavailable');
  return value;
  }, end);
  return {value:reused.value,counts:reused.counts,updatedAt:reused.at,stale:reused.stale};
  } catch (error) {return {value:null,counts:(error as {reuse?:ReuseCounts}).reuse??{...emptyCounts(),refreshFailed:1},updatedAt:0,stale:false}; }
}

export const getArtistCrowdData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<{ available: boolean; artists: ArtistCrowd[]; reuse?: ReuseCounts; evidence?: Array<{artist:string;at:number;stale:boolean}> }> => {
    const key = process.env["LASTFM_API_KEY"];
    if (!key) return { available: false, artists: [] };

    const artists = [...new Map(data.artists.map(a=>sanitize(a)).filter(Boolean).map(a=>[informationKey('artist',a,'',String(data.perArtistSimilar)),a])).values()].slice(0,40);
    if (!artists.length) return { available: true, artists: [] };

    // Keep Last.fm happy: small concurrency instead of 80 parallel requests.
    const {createEvidenceStorage}=await import('./songInformation/cache.server');
    const hydrated=await createRequestEvidenceStorage(createEvidenceStorage(),artists.map(a=>informationKey('artist',a,'',String(data.perArtistSimilar))),Date.now()+9000);
    const out: ArtistCrowd[] = []; const counts=hydrated.counts;const evidence: Array<{artist:string;at:number;stale:boolean}>=[];
    const queue = [...artists];
    const workers = Array.from({ length: Math.min(5, queue.length) }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const got = await fetchArtist(key, next, data.perArtistSimilar,hydrated.storage,Date.now()+9000);
        if (got) {if(got.value){out.push(got.value);evidence.push({artist:next,at:got.updatedAt,stale:got.stale});}for(const k of Object.keys(counts) as Array<keyof ReuseCounts>)counts[k]+=got.counts[k]??0;}else counts.refreshFailed++;
      }
    });
    await Promise.all(workers);

    return { available: true, artists: out, reuse:counts,evidence };
  });

// ---- Track-level similarity (track.getSimilar) -------------------------------------------

const TrackSeedsSchema = z.object({
  seeds: z.array(z.object({ artist: z.string().max(150), title: z.string().max(150) })).max(SIMILAR_LIMITS.seeds),
  perSeed: z.number().int().min(1).max(SIMILAR_LIMITS.perSeed).default(20),
});
// Each request hydrates an isolated bounded map; storage is not worker-lifetime state.
async function durableSimilar(key: string | undefined, seeds: Array<{artist:string;title:string}>, perSeed: number): Promise<SimilarTracksResponse & {reuse:ReuseCounts;evidence?:Array<{artist:string;title:string;at:number;stale:boolean}>}> {
  if (!key) return {availability:'missingKey',seeds:[],reuse:emptyCounts()};
  const { similarEvidence } = await import('./songInformation/lastfm.server');
  const queue=[...seeds], runs: SimilarTracksResponse['seeds']=[];const reuse=emptyCounts(),evidence:Array<{artist:string;title:string;at:number;stale:boolean}>=[];
  await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{
    for (;;) {const seed=queue.shift();if(!seed)return;
      try {const result=await similarEvidence(key,seed.artist,seed.title,Date.now()+6500);for(const k of Object.keys(reuse) as Array<keyof ReuseCounts>)reuse[k]+=result.counts[k]??0;evidence.push({...seed,at:result.at,stale:result.stale});runs.push({...result.value,similar:result.value.similar.slice(0,perSeed)});}
      catch (error) {const counts=(error as {reuse?:ReuseCounts}).reuse;if(counts)for(const k of Object.keys(reuse) as Array<keyof ReuseCounts>)reuse[k]+=counts[k]??0;runs.push({seed,status:'error',similar:[]});}
    }
  }));
  return {availability:runs.every(r=>r.status!=='error')?'ok':runs.some(r=>r.status!=='error')?'partial':'unavailable',seeds:runs,reuse,evidence};
}

export const getSimilarTracks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => TrackSeedsSchema.parse(data))
  .handler(async ({ data }) =>
    durableSimilar(process.env["LASTFM_API_KEY"], data.seeds, data.perSeed));
