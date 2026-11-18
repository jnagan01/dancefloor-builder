import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createThrottle, parseLastfm, parseMbRecordings, type LastfmTrackInfo, type MbCandidate } from "./lookupParse";
export type { LastfmTrackInfo, MbCandidate } from "./lookupParse";

/**
 * On-demand song information for the track details panel.
 * - MusicBrainz recording search (keyless; 1 request/second policy, identifying User-Agent).
 * - Last.fm track tags + similar tracks via the existing LASTFM_API_KEY (server only).
 * Results are suggestions; nothing here writes tags or saved data.
 */
const Input = z.object({ artist: z.string().max(200), title: z.string().max(300) });
const clean = (s: unknown, max = 300) => String(s ?? "").replace(/[\u0000-\u001F\u007F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
import { informationKey, type ReuseCounts } from '../songInformation/schema';
import { createEvidenceReuse, createSharedWork } from '../songInformation/reuse';
const shared = createSharedWork();
async function evidence<T>(kind: 'mb' | 'lastfm', artist: string, title: string, load: () => Promise<T>, end: number) {
  const { createEvidenceStorage } = await import('../songInformation/cache.server');
  return createEvidenceReuse(createEvidenceStorage(), shared)<T>(kind, informationKey(kind, artist, title), load, end);
}

export type LookupResult<T> = { ok: true; items: T; cached: boolean; updatedAt?: number; reuse?: ReuseCounts } | { ok: false; error: string; retryable: boolean };

const mbGate = createThrottle(1100, 4000);

export const lookupMusicBrainz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<LookupResult<MbCandidate[]>> => {
    const artist = clean(data.artist, 200), title = clean(data.title);
    if (!title) return { ok: false, error: "A title is needed to search MusicBrainz.", retryable: false };
    const end = Date.now() + 14_000;
    const q = (s: string) => `"${s.replace(/["\\]/g, " ")}"`;
    const url = new URL("https://musicbrainz.org/ws/2/recording");
    url.searchParams.set("query", artist ? `recording:${q(title)} AND artist:${q(artist)}` : `recording:${q(title)}`);
    url.searchParams.set("fmt", "json"); url.searchParams.set("limit", "8");
    try {
      const reused = await evidence("mb", artist, title, async () => {
      if (!(await mbGate())) throw new Error("MusicBrainz busy");
      const res = await fetch(url, { headers: { "User-Agent": "SetArchitect/1.2 ( https://dancefloor-builder.lovable.app )", Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
      if (res.status === 503 || res.status === 429) throw new Error("MusicBrainz busy");
      if (!res.ok) throw new Error("MusicBrainz unavailable");
      const body = await res.json() as { recordings?: Array<Record<string, unknown>> };
      const items = parseMbRecordings(body);
      if (!Array.isArray(body.recordings)) throw new Error("Invalid recording response");
      return items;
      }, end);
      return { ok: true, items: reused.value, cached: reused.counts.database > 0, updatedAt: reused.at, reuse: reused.counts };
    } catch (e) {
      console.error("MusicBrainz lookup failed", e);
      return { ok: false, error: "Couldn't reach MusicBrainz. Check your connection and try again.", retryable: true };
    }
  });

export const lookupLastfmTrack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<LookupResult<LastfmTrackInfo>> => {
    const key = process.env["LASTFM_API_KEY"];
    if (!key) return { ok: true, cached: false, items: { available: false, tags: [], similar: [], url: null } };
    const artist = clean(data.artist, 200), title = clean(data.title);
    if (!artist || !title) return { ok: false, error: "Artist and title are both needed for Last.fm.", retryable: false };
    const end = Date.now() + 9000;
    const call = async (method: string, extra: Record<string, string> = {}) => {
      const u = new URL("https://ws.audioscrobbler.com/2.0/");
      for (const [a, b] of Object.entries({ method, artist, track: title, autocorrect: "0", api_key: key, format: "json", ...extra })) u.searchParams.set(a, b);
      const res = await fetch(u, { headers: { "User-Agent": "SetArchitect/1.2" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) { const t = await res.text(); console.error(`Last.fm ${method} ${res.status}: ${t.slice(0, 300)}`); throw Object.assign(Error(`Last.fm returned an error (${res.status}).`), { retryable: res.status === 429 || res.status >= 500 }); }
      const j = await res.json() as Record<string, unknown>;
      if (typeof j.error === "number") { if (j.error === 6) return null; throw Object.assign(Error(`Last.fm: ${clean(j.message, 200)}`), { retryable: j.error === 29 || j.error === 11 || j.error === 16 }); }
      return j;
    };
    try {
      const reused = await evidence("lastfm", artist, title, async () => {
      const { similarEvidence, communityEvidence } = await import('../songInformation/lastfm.server');
      const [tags, similarity, community] = await Promise.all([
        call('track.gettoptags'), similarEvidence(key,artist,title,end), communityEvidence(key,artist,title,end).catch(()=>null),
      ]);
      if (!tags) throw new Error('Incomplete Last.fm response');
      const items = parseLastfm(tags, null, artist, title);
      items.similar = similarity.value.similar.slice(0,15);
      // Exact community information is cached by the common endpoint for later generation reuse.
      void community;
      return items;
      }, end);
      return { ok: true, items: reused.value, cached: reused.counts.database > 0, updatedAt: reused.at, reuse: reused.counts };
    } catch (e) {
      return { ok: false, error: (e as Error).message || "Couldn't reach Last.fm.", retryable: (e as { retryable?: boolean }).retryable ?? true };
    }
  });
