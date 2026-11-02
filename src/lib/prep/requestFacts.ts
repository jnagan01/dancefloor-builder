import { musicalMatchApproved, type VdjTrack } from "@/lib/virtualDj";
import { trackIdentity } from "@/lib/fileIdentity";
import { trackFacts } from "./filters";

/** Taste facts for a client request: the event's own fields first, then only an approved, existing linked track. Unapproved candidates are never used. */
export function requestFacts(song: { artist: string; song: string; genre?: string; year?: string | number }, match: Parameters<typeof musicalMatchApproved>[0] | undefined, tracks: readonly VdjTrack[]) {
  const t = match && match.trackIndex != null && musicalMatchApproved(match) ? tracks[match.trackIndex] : undefined;
  const f = t ? trackFacts(t) : undefined;
  return { artist: song.artist, song: song.song, genre: song.genre || f?.genre, decade: (song.year ? `${String(song.year).slice(0, 3)}0s` : undefined) || f?.decade };
}

/** A library track as a recommendation candidate. Missing play history stays undefined (unknown), never 0. */
export const libraryCandidate = (t: VdjTrack, trackId: string) => ({ artist: t.artist, song: t.title, facts: trackFacts(t), trackId, playCount: t.playCount, origin: "library" as const });

/**
 * Exact file identities each event row currently points at: its selected primary track and any explicitly
 * picked extras. Approval state is not changed or required; other files sharing a basename are not included.
 */
export function selectedTrackIds<S, K extends string>(
  sections: readonly { key: K; songs: readonly S[] }[],
  matches: Record<string, { trackIndex?: number; extraTrackIndices?: number[] } | undefined>,
  keyOf: (section: K, i: number, s: S) => string,
  tracks: readonly VdjTrack[], roots: Record<string, string>,
): Set<string> {
  const out = new Set<string>();
  for (const sec of sections) sec.songs.forEach((song, i) => {
    const m = matches[keyOf(sec.key, i, song)];
    if (!m) return;
    for (const idx of [m.trackIndex, ...(m.extraTrackIndices ?? [])]) {
      const t = idx == null ? undefined : tracks[idx];
      if (t) out.add(trackIdentity(t.filePath, roots));
    }
  });
  return out;
}
