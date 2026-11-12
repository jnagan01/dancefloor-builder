import { AdditionKeySet } from "../additionIdentity";
import { normalizeKey, HARD_ARTIST_CAP, type GenerationResult, type ResultSong, type SectionKey } from "../danceFloor";

export type DurationFile = { identity: string; seconds: number };
export type DurationTargets = Record<SectionKey, number>;
const sections: SectionKey[] = ["warmUp", "transition", "peak"];

/** Read-only accounting: only approved, policy-eligible files with known lengths count.
 * The caller supplies the same exact selected-file classification used by export. */
export function durationTotals(result: GenerationResult, files: (row: ResultSong) => readonly DurationFile[]): DurationTargets {
  const seen = new Set<string>(), totals = { warmUp: 0, transition: 0, peak: 0 };
  for (const section of sections) for (const row of result[section]) for (const file of files(row)) {
    if (seen.has(file.identity)) continue;
    seen.add(file.identity);
    if (Number.isFinite(file.seconds) && file.seconds > 0) totals[section] += file.seconds;
  }
  return totals;
}

/** Rank order is authoritative within the usable and review lanes. Unknown/tentative suggestions
 * cannot consume a usable-duration slot. Review-only rows stay bounded by the old planning count.
 * Never moves/removes requests; artist caps and identity/file dedupe happen BEFORE duration admission. */
export function fillRankedDuration(
  base: GenerationResult,
  ranked: readonly { row: ResultSong; prefer?: SectionKey }[],
  targets: DurationTargets,
  files: (row: ResultSong) => readonly DurationFile[],
  selectedPath: (row: ResultSong) => string | undefined,
  reviewTargets: DurationTargets,
): GenerationResult {
  const next = { ...base, warmUp: [...base.warmUp], transition: [...base.transition], peak: [...base.peak] };
  const totals = durationTotals(next, files), identities = new AdditionKeySet(), paths = new Set<string>();
  const artists = { warmUp: new Map<string, number>(), transition: new Map<string, number>(), peak: new Map<string, number>() };
  for (const section of sections) for (const row of next[section]) {
    identities.add(row.artist, row.song);
    const path = selectedPath(row); if (path) paths.add(path);
    for (const file of files(row)) paths.add(file.identity);
    const artist = normalizeKey(row.artist); artists[section].set(artist, (artists[section].get(artist) ?? 0) + 1);
  }
  const usable: typeof ranked[number][] = [], review: typeof ranked[number][] = [];
  for (const item of ranked) (files(item.row).some(f => Number.isFinite(f.seconds) && f.seconds > 0) ? usable : review).push(item);
  for (const lane of [usable, review]) for (const item of lane) {
    const row = item.row, path = selectedPath(row), fs = files(row);
    if (identities.has(row.artist, row.song)) { identities.absorb(row.artist, row.song); continue; }
    if ((path && paths.has(path)) || fs.some(f => paths.has(f.identity))) continue;
    const artist = normalizeKey(row.artist);
    const open = sections.filter(s => targets[s] > 0 && totals[s] < targets[s] && (artists[s].get(artist) ?? 0) < HARD_ARTIST_CAP && (lane === usable || next[s].length < reviewTargets[s]));
    const section = item.prefer && open.includes(item.prefer) ? item.prefer : open[0];
    if (!section) continue;
    next[section].push(row); identities.add(row.artist, row.song);
    artists[section].set(artist, (artists[section].get(artist) ?? 0) + 1);
    if (path) paths.add(path);
    for (const file of fs) { paths.add(file.identity); if (Number.isFinite(file.seconds) && file.seconds > 0) totals[section] += file.seconds; }
  }
  return next;
}