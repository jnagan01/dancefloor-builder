import { it, vi, afterEach } from 'vitest';
import { enrichHandler } from './helpers/enrichHandler';
import { weeklyCheck, weeklyEvidence } from './helpers/weeklyEvidence';
import { encodeCacheSource } from '@/lib/prep/provenance';
import { automaticDanceFailure, fitFactsFromRow } from '@/lib/prep/eventFit';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('weekly structured partial outage', async () => {
  await weeklyEvidence('partial-outage', 'lookup', async e => {
    vi.useFakeTimers();
    const late: Array<(r: Response) => void> = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const u = new URL(url);
      if (u.host === 'musicbrainz.org') return new Response(JSON.stringify({ recordings: [] }));
      if ((u.searchParams.get('searchText') ?? u.pathname).includes('Unknown')) return new Promise<Response>(resolve => { late.push(resolve); });
      if (u.pathname.endsWith('/search')) return new Response(JSON.stringify({ content: [{ id: 'good', trackTitle: 'Supported', artists: [{ name: 'Synthetic Groove' }] }] }));
      return new Response(JSON.stringify({ energy: 0.8, danceability: 0.8, tempo: 120 }));
    });
    const call = enrichHandler({
      readRows: async () => [{ artist_key: 'synthetic unknown', song_key: 'unknown', energy: null, danceability: null,
        year: 2005, bpm: null, valence: null, popularity: null, camelot: null, genre: null,
        fetched_at: new Date().toISOString(), source: encodeCacheSource('MusicBrainz', { year: 'provider' }) }],
      upsert: async () => {}, estimate: async () => new Promise(() => {}),
    });
    const start = Date.now();
    const pending = call({ songs: [{ artist: 'Synthetic Groove', song: 'Supported' }, { artist: 'Synthetic Unknown', song: 'Unknown' }] });
    await vi.advanceTimersByTimeAsync(17000);
    const out = await pending;
    const elapsed = Date.now() - start;
    weeklyCheck(e, 'handler-deadline-ms', elapsed, 20000, elapsed < 20000);
    weeklyCheck(e, 'retained-provider-energy', out.results[0].energy ?? 0, 8);
    weeklyCheck(e, 'retained-provider-year', out.results[1].year ?? 0, 2005);
    weeklyCheck(e, 'retained-provider-provenance', Number(out.results[0].prov?.energy === 'provider' && out.results[1].prov?.year === 'provider'), 1);
    weeklyCheck(e, 'unknown-withheld', Number(automaticDanceFailure({ avoidSlow: true }, fitFactsFromRow({ ...out.results[1], metaProv: out.results[1].prov })) !== undefined), 1);
    e.causes = out.status.causes ?? {};
    const snapshot = JSON.stringify(out);
    for (const resolve of late) resolve(new Response(JSON.stringify({ content: [{ id: 'late' }] })));
    await vi.advanceTimersByTimeAsync(1000);
    weeklyCheck(e, 'late-response-fenced', Number(JSON.stringify(out) === snapshot), 1);
  });
});