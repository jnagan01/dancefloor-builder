import { createIdentityIndex } from "./fileIdentity";
import type { VdjTrack } from "./virtualDj";

export function metadataResolver(metadata: readonly VdjTrack[], tracks: readonly VdjTrack[], roots: Record<string, string>) {
  // Known qualified paths block legacy fallback across different disks/folders.
  return createIdentityIndex(metadata, t => t.filePath, roots, tracks.map(t => t.filePath));
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
  };
}