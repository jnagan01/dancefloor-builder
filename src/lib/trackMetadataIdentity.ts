import { createIdentityIndex } from "./fileIdentity";
import type { VdjTrack } from "./virtualDj";

export function metadataResolver(metadata: readonly VdjTrack[], tracks: readonly VdjTrack[], roots: Record<string, string>) {
  // Known qualified paths block legacy fallback across different disks/folders.
  return createIdentityIndex(metadata, t => t.filePath, roots, tracks.map(t => t.filePath));
}

/**
 * Report for a VirtualDJ sync: library tracks with exactly one metadata entry
 * (`matched`) and how many of those end up with a valid length after merging.
 */
export function vdjSyncSummary(metadata: readonly VdjTrack[], sources: ReadonlyArray<{ tracks: readonly VdjTrack[] }>, roots: Record<string, string>) {
  const all = sources.flatMap(s => s.tracks);
  const resolver = metadataResolver(metadata, all, roots);
  let matched = 0, withLength = 0;
  for (const track of all) {
    const info = resolver.resolve(track.filePath);
    if (info) matched++;
    if (validSongLength(mergeTrackMetadata(track, info, true).songLength)) withLength++;
  }
  return { matched, withLength };
}

/** Positive finite whole-second length as a string; anything else is unknown. */
export function validSongLength(v: unknown): string | undefined {
  if (typeof v !== "string" || !/^\d+(?:\.\d+)?$/.test(v.trim())) return undefined;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? String(n) : undefined;
}

export function mergeTrackMetadata(track: VdjTrack, info: VdjTrack | undefined, preferInfo = false): VdjTrack {
  if (!info) return track;
  const first = preferInfo ? info : track;
  const second = preferInfo ? track : info;
  return {
    ...track,
    playCount: first.playCount ?? second.playCount,
    lastPlayTime: first.lastPlayTime ?? second.lastPlayTime,
    key: first.key || second.key,
    bpm: first.bpm || second.bpm,
    genre: first.genre || second.genre,
    year: first.year || second.year,
    ...lengthOf(first, second),
  };
}

function lengthOf(...from: Array<VdjTrack | undefined>) {
  for (const t of from) { const songLength = validSongLength(t?.songLength); if (songLength) return { songLength }; }
  return {};
}

/** Keep saved selected-path spelling when the scan still points to that same file. */
export function carryRescanMetadata(track: VdjTrack, old: VdjTrack | undefined, vdj?: VdjTrack): VdjTrack {
  const merged = { ...mergeTrackMetadata(track, old ?? vdj), ...lengthOf(track, old, vdj) };
  return old ? { ...merged, filePath: old.filePath } : merged;
}