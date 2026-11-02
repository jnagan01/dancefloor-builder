/** Pure parsers/throttle for song-information lookups (shared by the server functions and tests). */
export interface MbCandidate { id: string; title: string; artist: string; disambiguation: string; lengthSec: number | null; firstRelease: string | null; releases: string[]; tags: string[]; isrcs: string[]; score: number; url: string }
export interface LastfmTrackInfo { available: boolean; tags: string[]; similar: { artist: string; title: string; match: number }[]; url: string | null }

export const cleanText = (s: unknown, max = 300) => String(s ?? "").replace(/[\u0000-\u001F\u007F<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function parseMbRecordings(body: unknown): MbCandidate[] {
  const recs = (body && typeof body === "object" && Array.isArray((body as { recordings?: unknown }).recordings)) ? (body as { recordings: Array<Record<string, unknown>> }).recordings : [];
  return recs.slice(0, 8).map(r => {
    const credit = Array.isArray(r["artist-credit"]) ? (r["artist-credit"] as Array<{ name?: string; joinphrase?: string }>).map(a => `${a?.name ?? ""}${a?.joinphrase ?? ""}`).join("") : "";
    const releases = Array.isArray(r.releases) ? (r.releases as Array<{ title?: string }>).map(x => cleanText(x?.title, 200)).filter(Boolean) : [];
    const id = cleanText(r.id, 60);
    return {
      id, title: cleanText(r.title), artist: cleanText(credit, 200), disambiguation: cleanText(r.disambiguation, 200),
      lengthSec: typeof r.length === "number" && r.length > 0 ? Math.round(r.length / 1000) : null,
      firstRelease: typeof r["first-release-date"] === "string" ? cleanText(r["first-release-date"], 20) : null,
      releases: [...new Set(releases)].slice(0, 5),
      tags: Array.isArray(r.tags) ? [...(r.tags as Array<{ name?: string; count?: number }>)].sort((a, b) => (b?.count ?? 0) - (a?.count ?? 0)).map(t => cleanText(t?.name, 60)).filter(Boolean).slice(0, 10) : [],
      isrcs: Array.isArray(r.isrcs) ? (r.isrcs as unknown[]).map(x => cleanText(x, 20)).slice(0, 5) : [],
      score: typeof r.score === "number" ? r.score : 0,
      url: `https://musicbrainz.org/recording/${encodeURIComponent(id)}`,
    };
  }).filter(c => /^[0-9a-f-]{36}$/.test(c.id));
}

export function parseLastfm(tags: unknown, sim: unknown, artist: string, title: string): LastfmTrackInfo {
  const t = (tags as { toptags?: { tag?: unknown } } | null)?.toptags?.tag;
  const s = (sim as { similartracks?: { track?: unknown } } | null)?.similartracks?.track;
  const tagList = (Array.isArray(t) ? t : []).map((x: { name?: string }) => cleanText(x?.name, 60)).filter(Boolean).slice(0, 12);
  const simList = (Array.isArray(s) ? s : []).map((x: { name?: string; match?: unknown; artist?: { name?: string } }) => ({ artist: cleanText(x?.artist?.name, 200), title: cleanText(x?.name), match: Math.max(0, Math.min(1, Number(x?.match) || 0)) })).filter(x => x.artist && x.title).slice(0, 15);
  return { available: true, tags: tagList, similar: simList, url: `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(title)}` };
}

/**
 * Spaces calls `intervalMs` apart; resolves false instead of waiting longer than `maxWaitMs`,
 * so a burst can't build an unbounded queue. A refused call does not reserve a slot.
 */
export function createThrottle(intervalMs: number, maxWaitMs: number, now: () => number = Date.now, sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {
  let next = 0;
  return async function gate(): Promise<boolean> {
    const t = now(), wait = Math.max(0, next - t);
    if (wait > maxWaitMs) return false;
    next = Math.max(t, next) + intervalMs;
    if (wait > 0) await sleep(wait);
    return true;
  };
}
