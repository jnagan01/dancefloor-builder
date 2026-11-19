import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runEnrichment, type CacheRow } from '@/lib/enrichPipeline.server';
import { createEnrichCache } from '@/lib/enrichCache.server';
import { informationKey } from '@/lib/songInformation/schema';
import { READ_BATCH_CHARS, READ_BATCH_COUNT } from '@/lib/songInformation/cache.server';
import { encodeCacheSource } from '@/lib/prep/provenance';

// Actual pipeline + actual service adapters; only the database transport is a synthetic in-memory stand-in.
const state = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: state }));

const prov = { energy: 'provider', danceability: 'provider', valence: 'provider', popularity: 'provider', camelot: 'provider', genre: 'provider', bpm: 'provider', year: 'provider' };
function db(songs: { artist: string; song: string }[], failBatch = -1) {
  const now = Date.now(), evidence = new Map<string, unknown>();
  songs.forEach((s, i) => {
    const key = informationKey('metadata', s.artist, s.song);
    const value = { artist: s.artist.toLowerCase().normalize('NFC'), song: s.song.toLowerCase().normalize('NFC'), source: 'ReccoBeats+MusicBrainz', energy: (i % 9) + 1, danceability: 7, valence: 6, popularity: 8, bpm: 120, genre: 'Pop', year: 2004, prov,
      checked: Object.fromEntries(Object.keys(prov).map(a => [a, now])), updated: Object.fromEntries(Object.keys(prov).map(a => [a, now])) };
    evidence.set(key, { cache_key: key, kind: 'metadata', value, fetched_at: new Date(now).toISOString() });
  });
  const io = { batches: [] as string[][], legacy: [] as [string[], string[]][] };
  state.from.mockReset().mockImplementation((table: string) => table === 'track_evidence_cache'
    ? { select: () => ({ in: async (_: string, keys: string[]) => { io.batches.push(keys); if (io.batches.length - 1 === failBatch) return { data: null, error: {} };
        return { data: [...evidence.values()], error: null }; } }) } // returns unrelated rows too: adapter must filter
    : { select: () => ({ in: (_: string, a: string[]) => ({ in: async (__: string, s: string[]) => { io.legacy.push([a, s]); return { data: [] as CacheRow[], error: null }; } }) }) });
  return io;
}
const make = (n: number, long = false) => Array.from({ length: n }, (_, i) => ({
  artist: long ? `TÉST Ünïcødé 歌手 ${i} & Featured Guest With A Very Long Credit Name Ñoño ${'é'.repeat(40)}` : `TEST Artist ${i}`,
  song: long ? `Exäct Recording ${i} (Extended Live Version — 東京) ${'ü'.repeat(40)}` : `Exact ${i}`,
}));
const keyFor = (s: { artist: string; song: string }) => informationKey('metadata', s.artist, s.song);
beforeEach(() => vi.restoreAllMocks());

describe('batched exact cache reads preserve requested artist/title pairs', () => {
  for (const [n, long] of [[8, false], [20, false], [200, false], [20, true], [200, true]] as const) {
    it(`${n} distinct ${long ? 'long/unicode ' : ''}pairs: every cached row returned, no crossed pair, nothing dropped`, async () => {
      const songs = make(n, long), io = db(songs);
      const rows = await createEnrichCache().readRows([], [], songs.map(s => ({ artist: s.artist.toLowerCase(), song: s.song.toLowerCase() })));
      expect(rows!.length).toBe(n);
      const read = io.batches.flat();
      expect(new Set(read)).toEqual(new Set(songs.map(keyFor))); // exactly the requested identities, no artist×song product
      expect(read.length).toBe(n);
      for (const b of io.batches) { expect(b.length).toBeLessThanOrEqual(READ_BATCH_COUNT); expect(b.reduce((t, k) => t + encodeURIComponent(k).length + 3, 0)).toBeLessThanOrEqual(READ_BATCH_CHARS); }
      if (long) expect(io.batches.length).toBeGreaterThan(1);
      for (const [a, s] of io.legacy) expect(a.length * s.length).toBeLessThanOrEqual(READ_BATCH_COUNT ** 2);
    });
  }
  it('actual pipeline: 20 fully cached exact pairs make 0 provider requests and use all 20 cached rows', async () => {
    const songs = make(20), io = db(songs);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('provider must not be called'); });
    const out = await runEnrichment(songs, { ...createEnrichCache(), estimate: async () => { throw new Error('no estimate'); } });
    expect(fetcher).not.toHaveBeenCalled();
    expect(io.batches.flat().length).toBe(20);
    expect(out.results.map(s => s.energy)).toEqual(songs.map((_, i) => (i % 9) + 1));
    expect(out.status.reuse!.external).toBe(0); expect(out.status.reuse!.database).toBe(20); expect(out.status.reuse!.readFailed).toBe(0);
  });
  it('a failed batch is reported (never a silent miss) while successful batches are kept', async () => {
    const songs = make(200, true), io = db(songs, 0);
    const err = await createEnrichCache().readRows([], [], songs.map(s => ({ artist: s.artist.toLowerCase(), song: s.song.toLowerCase() }))).catch(e => e);
    expect(err.name === 'EnrichCacheError' || err.constructor.name === 'EnrichCacheError').toBe(true);
    expect(err.rows.length).toBe(200 - io.batches[0].length);
  });
});
