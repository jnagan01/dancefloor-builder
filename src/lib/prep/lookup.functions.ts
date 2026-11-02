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
const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
const cached = <T,>(k: string): T | undefined => { const h = cache.get(k); return h && Date.now() - h.at < CACHE_MS ? h.value as T : undefined; };
const store = (k: string, value: unknown) => { if (cache.size > 2000) cache.clear(); cache.set(k, { at: Date.now(), value }); };

export type LookupResult<T> = { ok: true; items: T; cached: boolean } | { ok: false; error: string; retryable: boolean };

const mbGate = createThrottle(1100, 4000);

export const lookupMusicBrainz = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<LookupResult<MbCandidate[]>> => {
    const artist = clean(data.artist, 200), title = clean(data.title);
    if (!title) return { ok: false, error: "A title is needed to search MusicBrainz.", retryable: false };
    const k = `mb|${artist.toLowerCase()}|${title.toLowerCase()}`;
    const hit = cached<MbCandidate[]>(k); if (hit) return { ok: true, items: hit, cached: true };
    const q = (s: string) => `"${s.replace(/["\\]/g, " ")}"`;
    const url = new URL("https://musicbrainz.org/ws/2/recording");
    url.searchParams.set("query", artist ? `recording:${q(title)} AND artist:${q(artist)}` : `recording:${q(title)}`);
    url.searchParams.set("fmt", "json"); url.searchParams.set("limit", "8");
    try {
      if (!(await mbGate())) return { ok: false, error: "Too many MusicBrainz lookups are queued. Wait a few seconds and try again.", retryable: true };
      const res = await fetch(url, { headers: { "User-Agent": "SetArchitect/1.2 ( https://dancefloor-builder.lovable.app )", Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
      if (res.status === 503 || res.status === 429) return { ok: false, error: "MusicBrainz is rate limiting requests. Try again in a few seconds.", retryable: true };
      if (!res.ok) { console.error(`MusicBrainz ${res.status}: ${(await res.text()).slice(0, 300)}`); return { ok: false, error: `MusicBrainz returned an error (${res.status}).`, retryable: res.status >= 500 }; }
      const body = await res.json() as { recordings?: Array<Record<string, unknown>> };
      const items = parseMbRecordings(body);
      store(k, items);
      return { ok: true, items, cached: false };
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
    const k = `lf|${artist.toLowerCase()}|${title.toLowerCase()}`;
    const hit = cached<LastfmTrackInfo>(k); if (hit) return { ok: true, items: hit, cached: true };
    const call = async (method: string, extra: Record<string, string> = {}) => {
      const u = new URL("https://ws.audioscrobbler.com/2.0/");
      for (const [a, b] of Object.entries({ method, artist, track: title, autocorrect: "1", api_key: key, format: "json", ...extra })) u.searchParams.set(a, b);
      const res = await fetch(u, { headers: { "User-Agent": "SetArchitect/1.2" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) { const t = await res.text(); console.error(`Last.fm ${method} ${res.status}: ${t.slice(0, 300)}`); throw Object.assign(Error(`Last.fm returned an error (${res.status}).`), { retryable: res.status === 429 || res.status >= 500 }); }
      const j = await res.json() as Record<string, unknown>;
      if (typeof j.error === "number") { if (j.error === 6) return null; throw Object.assign(Error(`Last.fm: ${clean(j.message, 200)}`), { retryable: j.error === 29 || j.error === 11 || j.error === 16 }); }
      return j;
    };
    try {
      const [tags, sim] = await Promise.all([call("track.gettoptags"), call("track.getsimilar", { limit: "15" })]);
      const items = parseLastfm(tags, sim, artist, title);
      store(k, items);
      return { ok: true, items, cached: false };
    } catch (e) {
      return { ok: false, error: (e as Error).message || "Couldn't reach Last.fm.", retryable: (e as { retryable?: boolean }).retryable ?? true };
    }
  });
