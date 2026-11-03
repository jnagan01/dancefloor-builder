import { trackIdentity } from "@/lib/fileIdentity";
import type { SongMatch, VdjLibrary } from "@/lib/virtualDj";
import { songIdentity } from "./knowledge";
import { buildResolver, cleanReason, requiresClean, seasonal, type PreparationInputs } from "../preparationPolicy";

type Section = "warmUp" | "transition" | "peak";
type Lists = Record<Section, { artist: string; song: string }[]>;

/**
 * Pure plan for appending one song to an event section. Never pre-approves: an explicitly linked
 * file becomes an unconfirmed "Possible Match" on that exact identity; otherwise the normal matcher runs.
 */
export function planAddToSection<R extends Lists>(
  result: R, section: Section, next: { artist: string; song: string; trackId?: string },
  library: VdjLibrary, roots: Record<string, string>,
  keyOf: (section: Section, idx: number, s: { artist: string; song: string }) => string,
  matchSong: (s: { artist: string; song: string }, lib: VdjLibrary) => SongMatch | undefined,
  policies?: PreparationInputs,
): { error: string } | { result: R; key: string; match: SongMatch } {
  const artist = next.artist.trim(), song = next.song.trim();
  if (!artist && !song) return { error: "Enter an artist or title." };
  const id = songIdentity(artist, song);
  const all = (["warmUp", "transition", "peak"] as Section[]).flatMap(k => result[k] ?? []);
  if (all.some(x => songIdentity(x.artist, x.song) === id)) return { error: "That song is already in this event." };
  const added = { artist, song };
  if (policies?.includeSeasonalTracks === false && seasonal(added)) return { error: "Seasonal/holiday additions are excluded. Existing client requests are retained." };
  const eligible = buildResolver(library.tracks, policies).resolve(added);
  if (policies?.ownedOnlyExpansion && eligible === undefined) return { error: "No confidently matching intended track/version in your library." };
  if (requiresClean(policies) && eligible === undefined) return { error: "Clean version needed — choose a labelled clean file or explicitly change this event’s policy." };
  const list = [...(result[section] ?? []), added];
  const key = keyOf(section, list.length - 1, added);
  let match: SongMatch;
  if (next.trackId) {
    const linked = library.tracks.findIndex(t => trackIdentity(t.filePath, roots) === next.trackId);
    if (linked < 0) return { error: "The linked file isn't in your current library. Reconnect its folder or unlink it first." };
    if (policies?.includeSeasonalTracks === false && seasonal(library.tracks[linked])) return { error: "Seasonal/holiday additions are excluded for this event." };
    const blocked = cleanReason(library.tracks[linked], requiresClean(policies));
    if (blocked) return { error: blocked };
    match = { status: "Possible Match", confidence: 1, trackIndex: linked, alternatives: [], confirmed: false };
  } else {
    const fresh = library.tracks.length ? matchSong(added, library) : undefined;
    match = fresh ? { ...fresh, confirmed: false } : { status: "Missing From Library", confidence: 0, alternatives: [] };
  }
  return { result: { ...result, [section]: list }, key, match };
}
