import { afterEach, describe, expect, it, vi } from 'vitest';
import { runEnrichment, type CacheRow, type EnrichedSong } from '@/lib/enrichPipeline.server';
import { createFactsGatherer, factsKey } from '@/lib/prep/factsGather';
import { retryAfterMs } from '@/lib/enrichScheduling.server';
import { encodeCacheSource } from '@/lib/prep/provenance';
import { runEnrichment as beforeRun } from './fit/archived/enrichPipeline.cf19f8e';

const songs = (n: number) => Array.from({ length: n }, (_, i) => ({ artist: `TEST ONLY Artist ${i}`, song: `Synthetic ${i}` }));
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const row = (s: { artist: string; song: string }): CacheRow => ({ artist_key: s.artist.toLowerCase(), song_key: s.song.toLowerCase(), energy: 8, danceability: 8, valence: null, popularity: 8, bpm: 120, year: 2004, genre: 'Pop', camelot: null, source: encodeCacheSource('ReccoBeats+MusicBrainz', { energy: 'provider', danceability: 'provider', year: 'provider' }), fetched_at: new Date().toISOString() });

function network(options: { slowMb?: boolean; rate?: boolean; noMatch?: boolean } = {}) {
  let live = 0, peak = 0, starts: number[] = [], calls = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    calls++; live++; peak = Math.max(peak, live);
    try {
      const u = new URL(url);
      if (u.host === 'musicbrainz.org') {
        starts.push(Date.now());
        if (options.slowMb) return await new Promise<Response>(() => {});
        await new Promise(r => setTimeout(r, 250));
        const query = u.searchParams.get('query') ?? '';
        const titles = [...query.matchAll(/recording:"([^"]+)"/g)].map(m => m[1]);
        return json({ recordings: options.noMatch ? [] : titles.map(title => ({ title, 'artist-credit': [{ name: `TEST ONLY Artist ${title.split(' ').at(-1)}` }], 'first-release-date': '2004-01-01' })) });
      }
      await new Promise(r => setTimeout(r, 250));
      if (options.rate) return json({}, 429, { 'retry-after': '30' });
      if (u.pathname.endsWith('/search')) {
        const title = u.searchParams.get('searchText') ?? '';
        return json({ content: options.noMatch ? [] : [{ id: title, trackTitle: title, artists: [{ name: `TEST ONLY Artist ${title.split(' ').at(-1)}` }], popularity: 80 }] });
      }
      return json({ energy: 0.8, danceability: 0.8, tempo: 120 });
    } finally { live--; }
  });
  return { get peak() { return peak; }, get starts() { return starts; }, get calls() { return calls; } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('real enrichment scheduling, synthetic latency only', () => {
  for (const n of [34, 100, 200, 600]) {
    it(`${n} frozen before/after cold provider comparison`, async () => {
      vi.useFakeTimers(); const input = songs(n); const net = network(); let elapsed = 0; const start = Date.now();
      const pending = beforeRun(input, { readRows: async () => [], upsert: async () => {}, estimate: async s => s.map(() => null) }).then(out => { elapsed = Date.now() - start; return out; });
      await vi.advanceTimersByTimeAsync(17_000); const out = await pending;
      const found = out.results.filter(r => r.energy !== undefined).length;
      console.info(`synthetic frozen-before ${n}: ms=${elapsed} energy=${found} unfinished=${out.status.unfinished} peak=${net.peak}`);
      expect(out.results).toHaveLength(n); expect(elapsed).toBeLessThan(16_000);
      if (n >= 200) expect(found).toBeLessThan(n);
    });
  }
  for (const n of [34, 100, 200, 600]) for (const mode of ['cold', 'mixed', 'warm']) {
    it(`${n} ${mode}: all eligible queued facts complete before 90s, cache reuse avoids providers`, async () => {
      vi.useFakeTimers(); const start = Date.now(); const input = songs(n); const net = network();
      const cache = mode === 'warm' ? input.map(row) : mode === 'mixed' ? input.filter((_, i) => i % 2 === 0).map(row) : [];
      let batches = 0;
      const g = createFactsGatherer<EnrichedSong>(async chunk => {
        batches++; const began = Date.now();
        const out = await runEnrichment(chunk, { readRows: async () => cache, upsert: async () => {}, estimate: async s => s.map(() => null) });
        if (out.status.retryAfterMs !== undefined && Date.now() - began < 1000) await new Promise(r => setTimeout(r, 1000 - (Date.now() - began)));
        return out.results;
      }, factsKey, { isIncomplete: e => !!e.incomplete });
      let elapsed = 0;
      const pending = g.gather(input).then(report => { elapsed = Date.now() - start; return report; }); await vi.advanceTimersByTimeAsync(90_001); const report = await pending;
      expect(report).toMatchObject({ requested: n, found: n, incompleteSongs: 0, timedOutSongs: 0, skippedAfterTimeout: 0 });
      expect(input.every(s => g.get(s)?.energy === 8 && g.get(s)?.year === 2004)).toBe(true);
      expect(net.peak).toBeLessThanOrEqual(5); expect(batches).toBe(Math.ceil(n / 8));
      if (mode === 'warm') expect(net.calls).toBe(0);
      const again = await g.gather(input); expect(again.alreadyAttempted).toBe(n);
      console.info(`synthetic scheduling ${n}/${mode}: ms=${elapsed} batches=${batches} calls=${net.calls} providerPeak=${net.peak} budget=90000`);
      expect(start).toBeLessThan(Date.now());
    });
  }
  it('hung MusicBrainz cannot starve later ReccoBeats tasks in a direct 34-row request', async () => {
    vi.useFakeTimers(); network({ slowMb: true });
    const pending = runEnrichment(songs(34), { readRows: async () => [], upsert: async () => {}, estimate: async s => s.map(() => null) });
    await vi.advanceTimersByTimeAsync(17_000); const out = await pending;
    expect(out.results.filter(r => r.energy === 8)).toHaveLength(34);
    expect(out.status.unfinished).toBe(34); expect(out.status.timedOut).toContain('fetch');
  });
  it('completed no-match is unknown, not a timeout or fabricated fact', async () => {
    vi.useFakeTimers(); network({ noMatch: true });
    const pending = runEnrichment(songs(8), { readRows: async () => [], upsert: async () => {}, estimate: async s => s.map(() => null) });
    await vi.advanceTimersByTimeAsync(17_000); const out = await pending;
    expect(out.status).toMatchObject({ complete: true, unfinished: 0 });
    expect(out.results.every(r => r.energy === undefined && r.year === undefined && r.source === 'none')).toBe(true);
  });
  it('429 parks provider lane without immediate retry; other provider facts survive', async () => {
    vi.useFakeTimers(); const net = network({ rate: true });
    const pending = runEnrichment(songs(8), { readRows: async () => [], upsert: async () => {}, estimate: async s => s.map(() => null) });
    await vi.advanceTimersByTimeAsync(17_000); const out = await pending;
    expect(out.results.every(r => r.year === 2004 && r.incomplete)).toBe(true);
    expect(out.results.every(r => r.energy === undefined)).toBe(true);
    expect(net.calls).toBeLessThanOrEqual(5); expect(out.status.retryAfterMs).toBeGreaterThan(0);
    expect(retryAfterMs('30', Date.now())).toBe(30_000);
  });
  it('completed streamed AI item survives a hung remainder; late item cannot write response/cache', async () => {
    vi.useFakeTimers(); network({ noMatch: true }); const writes: any[] = []; let emit: ((i: number, a: any) => void) | undefined;
    const pending = runEnrichment(songs(8), { readRows: async () => [], upsert: async rows => { writes.push(...rows); }, estimate: async (_s, _signal, onItem) => { emit = onItem; onItem?.(0, { energy: 7, danceability: 8 }); return new Promise(() => {}); } });
    await vi.advanceTimersByTimeAsync(17_000); const out = await pending; const snapshot = JSON.stringify(out);
    expect(out.results[0]).toMatchObject({ energy: 7, danceability: 8, prov: { energy: 'ai' }, incomplete: true });
    expect(writes).toHaveLength(1); emit?.(1, { energy: 10 });
    expect(JSON.stringify(out)).toBe(snapshot); expect(writes).toHaveLength(1);
  });
  it('generation deadline preserves earlier chunks and stops new work; stale accounts never apply results', async () => {
    vi.useFakeTimers(); let current = true; let calls = 0;
    const g = createFactsGatherer<EnrichedSong>(async chunk => { calls++; await new Promise(r => setTimeout(r, 1000)); return chunk.map(s => ({ ...s, source: 'none' })); }, factsKey, { overallMs: 1500, isCurrent: () => current });
    const pending = g.gather(songs(34)); await vi.advanceTimersByTimeAsync(1501); const report = await pending;
    expect(report.found).toBe(8); expect(report.skippedAfterTimeout).toBe(18); expect(calls).toBe(2);
    const stale = createFactsGatherer<EnrichedSong>(async chunk => { current = false; return chunk.map(s => ({ ...s, energy: 9, source: 'AI' })); }, factsKey, { isCurrent: () => current });
    await stale.gather(songs(34)); expect(stale.get(songs(1)[0])).toBeUndefined();
  });
});