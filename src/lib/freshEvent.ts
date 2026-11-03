import type { PreparationInputs } from './preparationPolicy';
import { boundedNumber, MAX_EVENT_HOURS, MAX_EVENT_MINUTES } from './inputSafety';

/** Fresh event content only. Legacy restore and app-level preferences never use this initializer. */
export function freshEvent() {
  return {
    eventName: '', hours: '', minutes: '', listType: '' as '' | 'dance' | 'cocktail' | 'dinner',
    buffer: 0, artistsInput: '', genresInput: '', decades: [] as string[], vibe: '', eventType: '',
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
  if (dance && requireBuffer && ![2, 3, 4].includes(buffer)) throw new Error('Choose a preparation buffer before generating.');
}