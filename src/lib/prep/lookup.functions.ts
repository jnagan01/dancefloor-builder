import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export interface MbCandidate { id: string; title: string; artist: string; disambiguation: string; lengthSec: number | null; firstRelease: string | null; releases: string[]; tags: string[]; isrcs: string[]; score: number; url: string }
export type LookupResult<T> = { ok: true; items: T; cached: boolean } | { ok: false; error: string; retryable: boolean };

let mbNext = 0;
async function mbThrottle() { const wait = mbNext - Date.now(); mbNext = Math.max(Date.now(), mbNext) + 1100; if (wait > 0) await new Promise(r => setTimeout(r, wait)); }

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
      await mbThrottle();
      const res = await fetch(url, { headers: { "User-Agent": "SetArchitect/1.2 ( https://dancefloor-builder.lovable.app )", Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
      if (res.status === 503 || res.status === 429) return { ok: false, error: "MusicBrainz is rate limiting requests. Try again in a few seconds.", retryable: true };
      if (!res.ok) { console.error(`MusicBrainz ${res.status}: ${(await res.text()).slice(0, 300)}`); return { ok: false, error: `MusicBrainz returned an error (${res.status}).`, retryable: res.status >= 500 }; }
      const body = await res.json() as { recordings?: Array<Record<string, unknown>> };
      const items: MbCandidate[] = (body.recordings ?? []).slice(0, 8).map(r => {
        const credit = Array.isArray(r["artist-credit"]) ? (r["artist-credit"] as Array<{ name?: string; joinphrase?: string }>).map(a => `${a.name ?? ""}${a.joinphrase ?? ""}`).join("") : "";
        const releases = Array.isArray(r.releases) ? (r.releases as Array<{ title?: string }>).map(x => clean(x.title, 200)).filter(Boolean) : [];
        const id = clean(r.id, 60);
        return {
          id, title: clean(r.title), artist: clean(credit, 200), disambiguation: clean(r.disambiguation, 200),
          lengthSec: typeof r.length === "number" && r.length > 0 ? Math.round(r.length / 1000) : null,
          firstRelease: typeof r["first-release-date"] === "string" ? clean(r["first-release-date"], 20) : null,
          releases: [...new Set(releases)].slice(0, 5),
          tags: Array.isArray(r.tags) ? (r.tags as Array<{ name?: string; count?: number }>).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).map(t => clean(t.name, 60)).filter(Boolean).slice(0, 10) : [],
          isrcs: Array.isArray(r.isrcs) ? (r.isrcs as unknown[]).map(x => clean(x, 20)).slice(0, 5) : [],
          score: typeof r.score === "number" ? r.score : 0,
          url: `https://musicbrainz.org/recording/${encodeURIComponent(id)}`,
        };
      }).filter(c => /^[0-9a-f-]{36}$/.test(c.id));
      store(k, items);
      return { ok: true, items, cached: false };
    } catch (e) {
      console.error("MusicBrainz lookup failed", e);
      return { ok: false, error: "Couldn't reach MusicBrainz. Check your connection and try again.", retryable: true };
    }
  });

export interface LastfmTrackInfo { available: boolean; tags: string[]; similar: { artist: string; title: string; match: number }[]; url: string | null }
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
      const tagList = ((tags?.toptags as { tag?: Array<{ name?: string }> } | undefined)?.tag ?? []).map(t => clean(t.name, 60)).filter(Boolean).slice(0, 12);
      const simList = ((sim?.similartracks as { track?: Array<{ name?: string; match?: unknown; artist?: { name?: string } }> } | undefined)?.track ?? [])
        .map(t => ({ artist: clean(t.artist?.name, 200), title: clean(t.name), match: Math.max(0, Math.min(1, Number(t.match) || 0)) })).filter(t => t.artist && t.title).slice(0, 15);
      const items = { available: true, tags: tagList, similar: simList, url: `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(title)}` };
      store(k, items);
      return { ok: true, items, cached: false };
    } catch (e) {
      return { ok: false, error: (e as Error).message || "Couldn't reach Last.fm.", retryable: (e as { retryable?: boolean }).retryable ?? true };
    }
  });
