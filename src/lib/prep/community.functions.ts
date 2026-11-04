import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseCommunityTrackInfo, type CommunityEvidence } from "./communityEvidence";

/**
 * Bounded exact-track Last.fm community lookup (track.getInfo, autocorrect OFF) for ranking candidates.
 * Uses the existing server-only LASTFM_API_KEY; missing key = provider disabled (everything stays unknown).
 * Bounds: ≤ COMMUNITY_BATCH songs/request, ≤ 4 calls in flight, 4 s per call, whole request ends by 9 s so the
 * client (12 s cutoff) always receives completed results. No retries; failures/timeouts stay unknown.
 */
export const COMMUNITY_BATCH = 20;
const Input = z.object({ songs: z.array(z.object({ artist: z.string().max(200), song: z.string().max(300) })).max(COMMUNITY_BATCH) });
export type CommunityStatus = "found" | "none" | "failed" | "timeout" | "disabled";
export interface CommunityRow { artist: string; song: string; status: CommunityStatus; evidence?: CommunityEvidence }
const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; v: CommunityEvidence | null }>();

export async function runCommunityBatch(songs: Array<{ artist: string; song: string }>, key: string | undefined, fetcher: typeof fetch = fetch, deadlineMs = 9000, callMs = 4000): Promise<CommunityRow[]> {
  if (!key) return songs.map(s => ({ ...s, status: "disabled" as const }));
  const out: CommunityRow[] = songs.map(s => ({ ...s, status: "timeout" as const }));
  const end = Date.now() + deadlineMs;
  let next = 0;
  const worker = async () => {
    while (next < songs.length && Date.now() < end) {
      const i = next++, s = songs[i]!;
      const ck = `${s.artist.toLowerCase()}||${s.song.toLowerCase()}`;
      const hit = cache.get(ck);
      if (hit && Date.now() - hit.at < CACHE_MS) { out[i] = hit.v ? { ...s, status: "found", evidence: hit.v } : { ...s, status: "none" }; continue; }
      try {
        const u = new URL("https://ws.audioscrobbler.com/2.0/");
        for (const [a, b] of Object.entries({ method: "track.getInfo", artist: s.artist, track: s.song, autocorrect: "0", api_key: key, format: "json" })) u.searchParams.set(a, b);
        const res = await fetcher(u, { headers: { "User-Agent": "SetArchitect/1.2" }, signal: AbortSignal.timeout(Math.max(1, Math.min(callMs, end - Date.now()))) });
        if (!res.ok) { out[i] = { ...s, status: "failed" }; continue; }
        const j = await res.json() as Record<string, unknown>;
        if (typeof j.error === "number") { if (j.error === 6) { cache.set(ck, { at: Date.now(), v: null }); out[i] = { ...s, status: "none" }; } else out[i] = { ...s, status: "failed" }; continue; }
        const ev = parseCommunityTrackInfo(j, s.artist, s.song) ?? null;
        if (cache.size > 5000) cache.clear();
        cache.set(ck, { at: Date.now(), v: ev });
        out[i] = ev ? { ...s, status: "found", evidence: ev } : { ...s, status: "none" };
      } catch (e) {
        out[i] = { ...s, status: (e as Error)?.name === "TimeoutError" || Date.now() >= end ? "timeout" : "failed" };
      }
    }
  };
  await Promise.race([Promise.all(Array.from({ length: Math.min(4, songs.length) }, worker)), new Promise(r => setTimeout(r, deadlineMs))]);
  return out.map(r => ({ ...r })); // snapshot: late completions cannot mutate a returned result
}

export const lookupCommunityBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => runCommunityBatch(data.songs, process.env["LASTFM_API_KEY"]));
