import { additionKeys, parseCredit, versionTitleIdentity } from "../additionIdentity";
import { cleanText } from "./lookupParse";

/**
 * Exact-track Last.fm COMMUNITY evidence (advisory). Never an audio measurement, chart position or proof that a given
 * crowd knows a song. Runtime-only ranking input: it is not written into event snapshots, backups or library data.
 *
 * Identity: the response must name the same artist credit (primary or full collaborator set) and the same
 * version-aware title as the request (clean/radio/featured labels ignored; remix/live/acoustic kept). Autocorrect is
 * off, so an artist-only, ambiguous or different-version answer is rejected and stays unknown.
 *
 * Tags: only explicit slow/ballad community tags count as slow evidence (never "rock", "love", "sad", BPM, ...), only
 * among the track's top tags, and only when the track has a minimum listener sample. Explicit dance/party tags on
 * the same track are reported as a conflict instead of being ignored.
 */
export interface CommunityEvidence {
  source: "lastfm";
  /** Distinct Last.fm listeners for this exact track (community count, not guest recognition). */
  listeners?: number;
  slowTags: string[];
  upbeatTags: string[];
}

export const COMMUNITY_TOP_TAGS = 5;
/** Below this listener sample, tags are too sparse to count as evidence (still reported as unknown). */
export const COMMUNITY_MIN_LISTENERS_FOR_TAGS = 5_000;
const SLOW = new Set(["ballad", "ballads", "power ballad", "power ballads", "slow", "slow songs", "slow song", "slow jam", "slow jams", "slowcore"]);
const UPBEAT = new Set(["dance", "party", "upbeat", "disco", "dancefloor", "dance floor", "energetic", "party songs", "party anthem", "party anthems", "dance party"]);
const normTag = (s: string) => cleanText(s, 60).toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

/** True when the provider's artist/title is the same version-aware work as the request. */
export function sameTrackIdentity(reqArtist: string, reqSong: string, gotArtist: string, gotSong: string): boolean {
  if (!gotArtist || !gotSong) return false;
  const a = new Set(additionKeys(reqArtist, reqSong));
  if (additionKeys(gotArtist, gotSong).some(k => a.has(k))) return true;
  // Last.fm usually lists featured artists in the TITLE ("Yeah! (feat. Lil Jon)") and only the primary as artist.
  const rp = parseCredit(reqArtist).primary, gp = parseCredit(gotArtist).primary;
  return !!rp && rp === gp && versionTitleIdentity(reqArtist, reqSong) === versionTitleIdentity(gotArtist, gotSong);
}

/** Parses a track.getInfo body for an exact request. Returns undefined when unusable (wrong track/version, no data). */
export function parseCommunityTrackInfo(body: unknown, artist: string, song: string): CommunityEvidence | undefined {
  const t = (body as { track?: Record<string, unknown> } | null)?.track;
  if (!t || typeof t !== "object") return undefined;
  const gotArtist = cleanText(typeof t.artist === "object" && t.artist ? (t.artist as { name?: unknown }).name : t.artist, 200);
  const gotSong = cleanText(t.name);
  if (!sameTrackIdentity(artist, song, gotArtist, gotSong)) return undefined;
  const n = Number(t.listeners);
  const listeners = Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  const raw = (t.toptags as { tag?: unknown } | undefined)?.tag;
  const tags = (Array.isArray(raw) ? raw : raw ? [raw] : []).slice(0, COMMUNITY_TOP_TAGS).map((x: { name?: unknown }) => normTag(String(x?.name ?? ""))).filter(Boolean);
  const enough = listeners !== undefined && listeners >= COMMUNITY_MIN_LISTENERS_FOR_TAGS;
  const slowTags = enough ? [...new Set(tags.filter(x => SLOW.has(x)))] : [];
  const upbeatTags = enough ? [...new Set(tags.filter(x => UPBEAT.has(x)))] : [];
  if (listeners === undefined && !slowTags.length && !upbeatTags.length) return undefined;
  return { source: "lastfm", ...(listeners !== undefined ? { listeners } : {}), slowTags, upbeatTags };
}

/** Strict reader for frozen quality samples (additive optional field). */
export function readCommunity(v: unknown): CommunityEvidence | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid community evidence");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["source", "listeners", "slowTags", "upbeatTags"].includes(k)) throw new Error("Invalid community evidence");
  if (o.source !== "lastfm") throw new Error("Invalid community evidence");
  if (o.listeners !== undefined && !(typeof o.listeners === "number" && Number.isInteger(o.listeners) && o.listeners >= 0 && o.listeners < 1e10)) throw new Error("Invalid community evidence");
  const tags = (x: unknown, allowed: Set<string>) => { if (!Array.isArray(x) || x.length > COMMUNITY_TOP_TAGS || x.some(t => typeof t !== "string" || !allowed.has(t))) throw new Error("Invalid community evidence"); return [...x] as string[]; };
  return { source: "lastfm", ...(o.listeners !== undefined ? { listeners: o.listeners as number } : {}), slowTags: tags(o.slowTags, SLOW), upbeatTags: tags(o.upbeatTags, UPBEAT) };
}

export const fmtListeners = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
