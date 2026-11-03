import type { PreparationInputs } from './preparationPolicy';
import { boundedNumber, MAX_EVENT_HOURS, MAX_EVENT_MINUTES } from './inputSafety';

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