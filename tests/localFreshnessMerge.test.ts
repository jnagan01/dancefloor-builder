import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY, freshMetadata, informationKey, mergeEntries, validatedEntry, type Entry } from '@/lib/songInformation/schema';
import { runEnrichment, type CacheRow } from '@/lib/enrichPipeline.server';
import { encodeCacheSource } from '@/lib/prep/provenance';

// Synthetic identities only. Local reuse and the server must make the same refresh decision for needed known fields.
const artist = 'TEST ONLY Artist', song = 'Synthetic Recording';
const now = Date.now();
const provider = { energy: 'provider', danceability: 'provider', popularity: 'provider', valence: 'provider', bpm: 'provider', genre: 'provider', year: 'provider' } as const;
const base = (dates: Record<string, number>, extra: Record<string, unknown> = {}) => ({ artist, song, source: 'ReccoBeats+MusicBrainz' as const,
  energy: 8, danceability: 7, valence: 6, popularity: 8, bpm: 122, genre: 'Pop', year: 2004, prov: { ...provider },
  checked: { energy: now, danceability: now, popularity: now, valence: now, bpm: now, genre: now, year: now, ...dates }, updated: { energy: now - DAY, danceability: now - DAY, popularity: now - DAY, valence: now - DAY, bpm: now - DAY, genre: now - DAY, year: now - DAY }, ...extra });
const row = (v: ReturnType<typeof base>): CacheRow => ({ artist_key: 'test only artist', song_key: 'synthetic recording', energy: v.energy, danceability: v.danceability, valence: v.valence,
  popularity: v.popularity, bpm: v.bpm, camelot: null, genre: v.genre, year: v.year, source: encodeCacheSource(v.source, v.prov as never), fetched_at: new Date(now).toISOString(),
  checked: v.checked, updated: v.updated, ...((v as { missed?: CacheRow['missed'] }).missed ? { missed: (v as { missed?: CacheRow['missed'] }).missed } : {}) });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('local and server freshness agree for needed known fields', () => {
  const cases: Array<[string, ReturnType<typeof base>, boolean]> = [
    ['all fresh', base({}), true],
    ['provider year checked 400 days ago', base({ year: now - 400 * DAY }), false],
    ['provider BPM checked 400 days ago', base({ bpm: now - 400 * DAY }), false],
    ['stale year inside a definitive-miss cooldown', base({ year: now - 400 * DAY }, { missed: { year: now - 3600_000 } }), true],
    ['stale year after the cooldown', base({ year: now - 400 * DAY }, { missed: { year: now - 2 * DAY } }), false],
  ];
  it.each(cases)('%s', async (_name, value, fresh) => {
    expect(freshMetadata(value, now, true)).toBe(fresh);
    const fetch = vi.fn(async () => new Response('{}', { status: 404 })); vi.stubGlobal('fetch', fetch);
    const estimate = vi.fn(async () => []);
    const out = await runEnrichment([{ artist, song }], { readRows: async () => [row(value)], upsert: async () => {}, estimate }, { needPopularity: true });
    // Server does online work exactly when local reuse declines the entry.
    expect(fetch.mock.calls.length + estimate.mock.calls.length > 0).toBe(!fresh);
    expect(out.results[0]).toMatchObject({ energy: 8, year: 2004, bpm: 122, prov: { year: 'provider', bpm: 'provider' } });
  });
});

describe('per-field local merge (same ordering as the service trigger)', () => {
  const key = informationKey('metadata', artist, song);
  const strong: Entry = { key, kind: 'metadata', at: now - 1000, value: base({}) };
  // Newer reply from another caller/window: weaker estimate energy, absent year/genre, newer timestamps.
  const weak: Entry = { key, kind: 'metadata', at: now, value: { artist, song, source: 'AI', energy: 3, danceability: 7, prov: { energy: 'estimate', danceability: 'provider' }, checked: { energy: now, danceability: now }, updated: { energy: now, danceability: now - DAY } } };
  it('a newer weaker partial never replaces verified fields; absent fields and their dates are retained', () => {
    const merged = validatedEntry(mergeEntries(strong, weak))!;
    const v = merged.value as ReturnType<typeof base>;
    expect(v).toMatchObject({ energy: 8, year: 2004, genre: 'Pop', bpm: 122, prov: { energy: 'provider', year: 'provider', genre: 'provider' } });
    expect(v.updated).toMatchObject({ energy: now - DAY, year: now - DAY }); expect(v.checked).toMatchObject({ energy: now, year: now });
    // Same value/provenance re-verified: newer check date is kept, value-change date is not moved.
    expect(v.checked.danceability).toBe(now); expect(v.updated.danceability).toBe(now - DAY);
  });
  it('reversed completion order converges on the same verified fields', () => {
    const a = mergeEntries(strong, weak).value as Record<string, unknown>, b = mergeEntries(weak, strong).value as Record<string, unknown>;
    for (const f of ['energy', 'danceability', 'year', 'genre', 'bpm']) expect(b[f]).toBe(a[f]);
    expect((b.prov as Record<string, string>).energy).toBe('provider');
  });
  it('an older equal-rank value never displaces a newer check; different identity is not merged', () => {
    const older: Entry = { ...strong, at: now - 5000, value: { ...base({ year: now - 10 * DAY }), year: 1999 } };
    expect((mergeEntries(strong, older).value as { year: number }).year).toBe(2004);
    const other: Entry = { ...weak, key: informationKey('metadata', artist, `${song} (Live)`), value: { ...weak.value as object, song: `${song} (Live)` } };
    expect(mergeEntries(strong, other)).toBe(other);
  });
});
