// Isolated stand-ins for services the preparation UI calls. No network, no real account, no audio.
import React from 'react';
import { buildLibrary, type VdjTrack } from '../../../src/lib/virtualDj';
const w = window as any;
w.__previews = w.__previews ?? []; w.__toasts = w.__toasts ?? [];
w.__lookup = w.__lookup ?? { mbDelay: 50, lfDelay: 50, crowdDelay: 50, mbCalls: 0, lfCalls: 0, crowdCalls: 0 };

export function createFileRoute() { return (options: any) => options; }
export function useNavigate() { return async () => {}; }
export function useServerFn(fn: any) { return fn; }
export function pageHead() { return {}; }
export const toast = Object.assign((t: any) => w.__toasts.push(['info', String(t)]), {
  error: (t: any) => w.__toasts.push(['error', String(t)]), success: (t: any) => w.__toasts.push(['success', String(t)]),
  warning: (t: any) => w.__toasts.push(['warning', String(t)]), info: (t: any) => w.__toasts.push(['info', String(t)]),
});
export function Toaster() { return null; }
export function TrackTagEditor() { return null; }
export function WaveformPlayer({ target }: any) {
  React.useEffect(() => { if (target) w.__previews.push(target); }, [target]);
  return target ? <div data-testid="preview-player">Previewing {target.filePath}</div> : null;
}
export function resolveAudioFile() { return undefined; }
export function buildAudioIndex() { return {}; }

// Synthetic workspace: library rows come from the fixture; account follows window.__account.
const listeners = new Set<() => void>();
w.__setWorkspaceAccount = (a: string | null) => { w.__account = a; listeners.forEach(l => l()); };
export function useWorkspace() {
  const [, force] = React.useState(0);
  React.useEffect(() => { const l = () => force(v => v + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const tracks: VdjTrack[] = w.__fixture.tracks;
  const library = React.useMemo(() => buildLibrary(tracks), [tracks]);
  const sources = React.useMemo(() => [{ label: 'Synthetic', tracks }], [tracks]);
  return { account: w.__account, sources, library, audioIndex: {}, addFolder: async () => {}, rescan: async () => {}, persistenceError: null, editTrack: () => {}, saveTrackTags: async () => {} };
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function lookupMusicBrainz({ data }: any) {
  const n = ++w.__lookup.mbCalls; await delay(w.__lookup.mbDelay);
  if (w.__lookup.mbFail) return { ok: false, error: 'MusicBrainz is rate limiting requests. Try again in a few seconds.', retryable: true };
  return { ok: true, cached: false, items: [
    { id: '00000000-0000-4000-8000-00000000000' + (n % 10), title: data.title, artist: data.artist, disambiguation: '', lengthSec: 200, firstRelease: '1999', releases: ['Synthetic Album'], tags: ['synthetic-tag'], isrcs: [], score: 100, url: 'https://musicbrainz.org/recording/00000000-0000-4000-8000-000000000000' },
    { id: '00000000-0000-4000-8000-0000000000ff', title: data.title + ' (Club Remix)', artist: data.artist, disambiguation: '', lengthSec: 420, firstRelease: '2001', releases: [], tags: [], isrcs: [], score: 80, url: 'https://musicbrainz.org/recording/00000000-0000-4000-8000-0000000000ff' },
  ] };
}
export async function lookupLastfmTrack({ data }: any) {
  w.__lookup.lfCalls++; await delay(w.__lookup.lfDelay);
  return { ok: true, cached: false, items: { available: true, tags: ['lf-' + data.title.toLowerCase().replace(/\W+/g, '-')], similar: [{ artist: 'Similar Band', title: 'Similar Song', match: 0.8 }], url: 'https://www.last.fm/music/x/_/y' } };
}
export async function getArtistCrowdData({ data }: any) {
  w.__lookup.crowdCalls++; await delay(w.__lookup.crowdDelay);
  return { available: true, artists: data.artists.map((a: string) => ({ name: a, listeners: 0, playcount: 0, tags: [], similar: [{ name: w.__lookup.similarArtist ?? 'Discovery Artist', match: 0.9 }] })) };
}
export async function getSimilarTracks({ data }: any) {
  w.__lookup.trackSeeds = data.seeds;
  if (w.__lookup.trackSimFail) return { availability: 'rateLimited', seeds: [] };
  if (w.__lookup.trackSimThrow) throw Error('synthetic outage');
  const t = w.__lookup.similarTrack ?? { artist: 'Familiar Act', title: 'Classic' };
  return { availability: 'ok', seeds: data.seeds.map((seed: any) => ({ seed, status: 'ok', similar: [{ artist: t.artist, title: t.title, match: 0.6 }] })) };
}
