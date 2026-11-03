import type { PreparationInputs } from './preparationPolicy';
import { boundedNumber, MAX_EVENT_HOURS, MAX_EVENT_MINUTES } from './inputSafety';
import { isBlocked, type Song, type DoNotPlayEntry } from './danceFloor';
import { intendedKey } from '../../desktop/offline/policy.cjs';
import { trackIdentity } from './fileIdentity';

/** Fresh event content only. Legacy restore and app-level preferences never use this initializer. */
export function freshEvent() {
  return {
    eventName: '', hours: '', minutes: '', listType: '' as '' | 'dance' | 'cocktail' | 'dinner',
    buffer: 1, artistsInput: '', genresInput: '', decades: [] as string[], vibe: '', eventType: '',
    homeKey: '', notes: '', doNotPlayInput: '', spotifyLink: '', songs: [],
    policies: { ownedOnlyExpansion: false, includeSeasonalTracks: false, requireCleanVersions: false } as PreparationInputs,
    expand: false, splitOn: false, split: { warmUp: 0, transition: 0, peak: 0 },
    bpmOn: false, danceOn: false, includeCombined: false,
  };
}

export function validateEventChoices(listType: string, hours: string, minutes: string, buffer: number, requireBuffer = true) {
  if (!['dance', 'cocktail', 'dinner'].includes(listType)) throw new Error('Choose a list type before continuing.');
  const dance = listType === 'dance';
  const duration = dance ? hours : minutes;
  if (!duration.trim() || !Number.isFinite(Number(duration)) || Number(duration) <= 0)
    throw new Error(dance ? 'Enter a positive dance floor length in hours.' : 'Enter a positive list length in minutes.');
  boundedNumber(duration, dance ? MAX_EVENT_HOURS : MAX_EVENT_MINUTES, dance ? 'Event hours' : 'List minutes');
  if (dance && requireBuffer && ![1, 2, 3, 4].includes(buffer)) throw new Error('Choose a preparation target from 1× to 4× before generating.');
}

/** Before matching, local intended-track lengths are planning evidence, not export approval.
 * Unknown lengths use an explicitly labelled four-minute estimate. */
export function preparationCoverage(lengths: Array<number | undefined>, eventMinutes: number, buffer: number) {
  let knownSeconds = 0, unknown = 0;
  for (const length of lengths) {
    if (typeof length === 'number' && Number.isFinite(length) && length > 0) knownSeconds += length;
    else unknown++;
  }
  const estimatedSeconds = knownSeconds + unknown * 240;
  const baselineSeconds = eventMinutes * 60;
  const targetSeconds = baselineSeconds * buffer;
  return { knownSeconds, unknown, estimatedSeconds, baselineSeconds, targetSeconds,
    averageSeconds: lengths.length ? estimatedSeconds / lengths.length : 240,
    baselineShortSeconds: Math.max(0, baselineSeconds - estimatedSeconds),
    preparationShortSeconds: Math.max(0, targetSeconds - estimatedSeconds) };
}

/** Unique usable intended requests, not approved export evidence. Never alters source rows. */
export function clientPlanningCoverage(songs: Song[], blocked: DoNotPlayEntry[], resolve: (song: Song) => { filePath: string; songLength?: string | number } | undefined, eventMinutes: number, buffer: number, roots: Record<string, string> = {}) {
  const intended = new Set<string>(), files = new Set<string>();
  const lengths: Array<number | undefined> = [];
  let excluded = 0, repeats = 0;
  for (const song of songs) {
    if (!song.song.trim() || isBlocked(song.artist, song.song, blocked)) { excluded++; continue; }
    const key = intendedKey(song), track = resolve(song);
    const file = track ? trackIdentity(track.filePath, roots) : undefined;
    if (intended.has(key) || (file !== undefined && files.has(file))) { repeats++; continue; }
    intended.add(key); if (file !== undefined) files.add(file);
    lengths.push(track ? Number(track.songLength) : undefined);
  }
  return { ...preparationCoverage(lengths, eventMinutes, buffer), excluded, repeats, usable: lengths.length };
}