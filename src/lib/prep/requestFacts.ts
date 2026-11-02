import { musicalMatchApproved, type VdjTrack } from "@/lib/virtualDj";
import { trackFacts } from "./filters";

/** Taste facts for a client request: the event's own fields first, then only an approved, existing linked track. Unapproved candidates are never used. */
export function requestFacts(song: { artist: string; song: string; genre?: string; year?: string | number }, match: Parameters<typeof musicalMatchApproved>[0] | undefined, tracks: readonly VdjTrack[]) {
  const t = match && match.trackIndex != null && musicalMatchApproved(match) ? tracks[match.trackIndex] : undefined;
  const f = t ? trackFacts(t) : undefined;
  return { artist: song.artist, song: song.song, genre: song.genre || f?.genre, decade: (song.year ? `${String(song.year).slice(0, 3)}0s` : undefined) || f?.decade };
}

/** A library track as a recommendation candidate. Missing play history stays undefined (unknown), never 0. */
export const libraryCandidate = (t: VdjTrack, trackId: string) => ({ artist: t.artist, song: t.title, facts: trackFacts(t), trackId, playCount: t.playCount, origin: "library" as const });
