import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseCommunityTrackInfo, providerQueryTitle, type CommunityEvidence } from "./communityEvidence";

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

const LATE = Symbol("late");
/** Resolves to the value, or LATE once `ms` passes (timer always cleared; a later rejection is swallowed). */
function within<T>(p: Promise<T>, ms: number, onLate: () => void): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  p.catch(() => {});
  return Promise.race([p, new Promise<typeof LATE>(r => { timer = setTimeout(() => { onLate(); r(LATE); }, Math.max(0, ms)); })]).finally(() => clearTimeout(timer));
}

export async function runCommunityBatch(songs: Array<{ artist: string; song: string }>, key: string | undefined, fetcher: typeof fetch = fetch, deadlineMs = 9000, callMs = 4000): Promise<CommunityRow[]> {
  if (!key) return songs.map(s => ({ ...s, status: "disabled" as const }));
  const out: CommunityRow[] = songs.map(s => ({ ...s, status: "timeout" as const }));
  const end = Date.now() + deadlineMs;
  let stopped = false; // set at the overall deadline: no scheduling, cache writes or result writes afterwards
  const live = new Set<AbortController>();
  let next = 0;
  const worker = async () => {
    while (!stopped && next < songs.length) {
      if (Date.now() >= end) { stopped = true; return; } // overall deadline reached: never schedule another call
      const i = next++, s = songs[i]!;
      const ck = `${s.artist.toLowerCase()}||${s.song.toLowerCase()}`;
      const hit = cache.get(ck);
      if (hit && Date.now() - hit.at < CACHE_MS) { out[i] = hit.v ? { ...s, status: "found", evidence: hit.v } : { ...s, status: "none" }; continue; }
      const ac = new AbortController(); live.add(ac);
      const callEnd = Math.min(end, Date.now() + callMs);
      const left = () => callEnd - Date.now();
      let callTimedOut = false;
      const late = () => { callTimedOut = true; ac.abort(); };
      try {
        const u = new URL("https://ws.audioscrobbler.com/2.0/");
        // Query drops only clean/radio labels; the reply is validated against the ORIGINAL artist/title (exact version).
        for (const [a, b] of Object.entries({ method: "track.getInfo", artist: s.artist, track: providerQueryTitle(s.song), autocorrect: "0", api_key: key, format: "json" })) u.searchParams.set(a, b);
        // Wall-clock guard after every await: a microtask may resolve past the cutoff before the timer callback runs.
        // Overall cutoff => stop (no writes, no scheduling); per-call cutoff => abort, record timeout, never cache.
        const pastCutoff = (): "stop" | "late" | null => {
          const now = Date.now();
          if (stopped || now >= end) { stopped = true; ac.abort(); return "stop"; }
          if (now >= callEnd) { ac.abort(); return "late"; }
          return null;
        };
        const res = await within(Promise.resolve().then(() => fetcher(u, { headers: { "User-Agent": "SetArchitect/1.2" }, signal: ac.signal })), left(), late);
        let g = pastCutoff();
        if (g === "stop") return;
        if (res === LATE || g === "late") { out[i] = { ...s, status: "timeout" }; continue; }
        if (!res.ok) { out[i] = { ...s, status: "failed" }; continue; }
        const j = await within(Promise.resolve().then(() => res.json() as Promise<Record<string, unknown>>), left(), late);
        g = pastCutoff();
        if (g === "stop") return;
        if (j === LATE || g === "late") { out[i] = { ...s, status: "timeout" }; continue; }
        if (typeof j.error === "number") { if (j.error === 6) { cache.set(ck, { at: Date.now(), v: null }); out[i] = { ...s, status: "none" }; } else out[i] = { ...s, status: "failed" }; continue; }
        const ev = parseCommunityTrackInfo(j, s.artist, s.song) ?? null;
        if (cache.size > 5000) cache.clear();
        cache.set(ck, { at: Date.now(), v: ev });
        out[i] = ev ? { ...s, status: "found", evidence: ev } : { ...s, status: "none" };
      } catch {
        if (stopped) return;
        out[i] = { ...s, status: callTimedOut ? "timeout" : "failed" };
      } finally { live.delete(ac); }
    }
  };
  let overall: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(Array.from({ length: Math.min(4, songs.length) }, worker)), new Promise<void>(r => { overall = setTimeout(r, Math.max(0, end - Date.now())); })]);
  clearTimeout(overall);
  stopped = true;
  for (const ac of live) ac.abort();
  return out.map(r => ({ ...r })); // snapshot; workers can no longer write after `stopped`
}

/** Test-only: clears the in-memory cache. */
export const __resetCommunityCache = () => cache.clear();

export const lookupCommunityBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => runCommunityBatch(data.songs, process.env["LASTFM_API_KEY"]));
