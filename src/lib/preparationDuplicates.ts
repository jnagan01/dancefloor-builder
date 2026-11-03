import { AdditionKeySet } from "./additionIdentity";
import { trackIdentity } from "./fileIdentity";
import type { GenerationResult, ResultSong, SectionKey } from "./danceFloor";

/** Only called for an explicit generation. Requests win and are never removed.
 * Saved selection keys/legacy dedupeKey are deliberately unchanged. */
export function preventAutomaticDuplicates(result: GenerationResult, resolve: (song: ResultSong) => string | undefined, roots: Record<string, string> = {}) {
  const sections: SectionKey[] = ["warmUp", "transition", "peak"];
  const intended = new AdditionKeySet(), files = new Set<string>();
  const remember = (song: ResultSong) => {
    intended.add(song.artist, song.song);
    const path = resolve(song); if (path) files.add(trackIdentity(path, roots));
  };
  for (const section of sections) for (const song of result[section]) if (song.fromUpload) remember(song);
  let removed = 0;
  const next = { ...result };
  for (const section of sections) next[section] = result[section].filter(song => {
    if (song.fromUpload) return true;
    const path = resolve(song);
    if (intended.has(song.artist, song.song) || (path && files.has(trackIdentity(path, roots)))) { intended.absorb(song.artist, song.song); removed++; return false; }
    remember(song); return true;
  });
  return { ...next, duplicatesRemoved: result.duplicatesRemoved + removed };
}

export function durationLabel(seconds: number) {
  const n = Math.max(0, Math.round(seconds));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
export function sectionCoverage(knownSec: number, eventMinutes: number, buffer: number) {
  const targetSec = eventMinutes * 60, prepSec = targetSec * buffer;
  const delta = knownSec - prepSec;
  return { targetSec, prepSec, delta, text: `${durationLabel(knownSec)} usable unique · event ${durationLabel(targetSec)} · preparation ${durationLabel(prepSec)} · ${durationLabel(Math.abs(delta))} ${delta < 0 ? "short of preparation" : "over preparation"}` };
}