import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj';
import * as dance from '@/lib/danceFloor';
import * as audio from '@/lib/audioMatch';
import * as snapshots from '@/lib/snapshotSafety';
import * as drafts from '@/lib/eventDrafts';
import * as input from '@/lib/inputSafety';
import * as autosave from '@/lib/eventAutosave';
import * as vibes from '@/lib/vibes';
import * as isolation from '@/lib/workflowIsolation';
import * as theory from '@/lib/musicTheory';
import * as revisions from '@/lib/eventRevision';
import { runSimilarTracks, type SimilarCache } from '@/lib/prep/similarTracks';
import { runEnrichment, type CacheRow } from '@/lib/enrichPipeline.server';
import { mergeMeta, strictLimitFailure, decodeCacheSource, encodeCacheSource, metaLabel } from '@/lib/prep/provenance';
import { awaitReadyFeedback, GATE_MESSAGES } from '@/lib/prep/expansionFeedback';
import { createPrepStore } from '@/lib/prep/prepStore';
import { setFeedback, emptyKnowledge, type PrepKnowledge } from '@/lib/prep/knowledge';
import { normalizeKey } from '@/lib/danceFloor';

const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });

// Synthetic, isolated fixtures only.
const requests = [{ artist: 'Queen', song: 'Radio Ga Ga', fromUpload: true }, { artist: 'ABBA', song: 'Dancing Queen', fromUpload: true }];
const row = (inputs: Record<string, unknown> = {}) => ({ id: 'A', name: 'Synthetic', updated_at: 'v1', inputs: { songs: requests, hours: '1', buffer: 2, listType: 'dance', expand: true, ...inputs }, lists: { warmUp: [...requests], transition: [], peak: [] } });
const library = vdj.buildLibrary([
  { filePath: "/synthetic/Elton John - I'm Still Standing.mp3", artist: 'Elton John', title: "I'm Still Standing", year: '1983', genre: 'Pop' },
] as vdj.VdjTrack[]);
const sug = (artist: string, song: string, extra: Record<string, unknown> = {}) => ({ artist, song, energy: 7, danceability: 7, valence: 7, reason: 'synthetic', ...extra });
type Row = { artist: string; song: string; fromUpload?: boolean; aiReason?: string; bpm?: number; year?: number; metaSource?: string; metaProv?: Record<string, string> };
const all = (r: { warmUp: Row[]; transition: Row[]; peak: Row[] }) => [...r.warmUp, ...r.transition, ...r.peak];
const json = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
afterEach(() => { vi.unstubAllGlobals(); });

describe('Last.fm track.getSimilar outages are failures, never cached as "no similar tracks"', () => {
  const seeds = [{ artist: 'Queen', title: 'Radio Ga Ga' }];
  it('HTTP 500 with {} is an error and is retried next time', async () => {
    const cache: SimilarCache = new Map(); let calls = 0;
    const f = async () => { calls++; return json(500, {}); };
    expect((await runSimilarTracks('k', seeds, 5, f, cache)).availability).toBe('unavailable');
    expect(cache.size).toBe(0);
    await runSimilarTracks('k', seeds, 5, f, cache); expect(calls).toBe(2);
  });
  it('malformed 200 body is an error, not notFound', async () => {
    const cache: SimilarCache = new Map();
    const r = await runSimilarTracks('k', seeds, 5, async () => json(200, { unexpected: true }), cache);
    expect(r.availability).toBe('unavailable'); expect(r.seeds[0].status).toBe('error'); expect(cache.size).toBe(0);
  });
  it('a valid empty Last.fm success is notFound and cached; a 200 API error 6 is notFound', async () => {
    const cache: SimilarCache = new Map();
    const r = await runSimilarTracks('k', seeds, 5, async () => json(200, { similartracks: { track: [] } }), cache);
    expect(r.availability).toBe('ok'); expect(r.seeds[0].status).toBe('notFound'); expect(cache.size).toBe(1);
    const e = await runSimilarTracks('k', seeds, 5, async () => json(200, { error: 6, message: 'Track not found' }), new Map());
    expect(e.seeds[0].status).toBe('notFound');
  });
});

describe('per-attribute provenance helpers', () => {
  it('verified values replace AI estimates; user edits are retained; unknown stays unknown', () => {
    const ai = mergeMeta({ artist: 'A', song: 'S' }, { bpm: 124, year: 1985 }, 'ai');
    const merged = mergeMeta(ai, { bpm: 122, genre: undefined }, 'provider');
    expect(merged.bpm).toBe(122); expect(merged.metaProv).toEqual({ bpm: 'provider', year: 'ai' }); expect(merged.genre).toBeUndefined();
    const user = mergeMeta({ artist: 'A', song: 'S', bpm: 100, metaProv: { bpm: 'user' as const } }, { bpm: 128 }, 'tags');
    expect(user.bpm).toBe(100);
    expect(metaLabel(merged)).toBe('Estimated'); // mixed provider + AI is never labelled Online
  });
  it('strict limits: AI guesses, unknown and legacy labels never pass; verified in-range does', () => {
    const limits = { bpmRange: [118, 130] as const, decades: ['1980s'] };
    expect(strictLimitFailure({ bpm: 124, year: 1985, metaProv: { bpm: 'ai', year: 'ai' } }, limits)).toBe('bpm');
    expect(strictLimitFailure({ year: 1985, metaProv: { year: 'provider' } }, limits)).toBe('bpm');
    expect(strictLimitFailure({ bpm: 124, year: 1985, metaSource: 'Online' }, limits)).toBe('bpm');
    expect(strictLimitFailure({ bpm: 124, year: 1975, metaProv: { bpm: 'tags', year: 'tags' } }, limits)).toBe('decade');
    expect(strictLimitFailure({ bpm: 124, year: 1985, metaProv: { bpm: 'provider', year: 'tags' } }, limits)).toBeNull();
  });
  it('legacy cache labels decode conservatively; v2 round-trips', () => {
    expect(decodeCacheSource('ReccoBeats+MusicBrainz', { bpm: 120, year: 1980 }).prov).toEqual({ bpm: 'estimate', year: 'estimate' });
    expect(decodeCacheSource('AI', { bpm: 120 }).prov).toEqual({ bpm: 'ai' });
    const enc = encodeCacheSource('ReccoBeats', { bpm: 'provider', year: 'ai' });
    expect(decodeCacheSource(enc, { bpm: 1, year: 2 })).toEqual({ summary: 'ReccoBeats', prov: { bpm: 'provider', year: 'ai' } });
  });
});

/** Synthetic network: ReccoBeats/MusicBrainz answers keyed by title; everything else 404. */
function stubNetwork(byTitle: Record<string, { rbTitle?: string; tempo?: number; mbTitle?: string; mbYear?: string; artist: string }>) {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url);
    if (u.host === 'api.reccobeats.com' && u.pathname.endsWith('/search')) {
      const text = u.searchParams.get('searchText') ?? '';
      const hit = Object.values(byTitle).find(v => v.rbTitle && normalizeKey(v.rbTitle).startsWith(normalizeKey(text)));
      return json(200, { content: hit && Number(u.searchParams.get('page')) === 0 ? [{ id: hit.rbTitle, trackTitle: hit.rbTitle, artists: [{ name: hit.artist }], popularity: 70 }] : [] });
    }
    if (u.host === 'api.reccobeats.com') {
      const id = decodeURIComponent(u.pathname.split('/')[3] ?? '');
      const hit = Object.values(byTitle).find(v => v.rbTitle === id);
      return json(200, { energy: 0.8, danceability: 0.7, valence: 0.5, tempo: hit?.tempo, key: 0, mode: 1 });
    }
    if (u.host === 'musicbrainz.org') {
      const q = u.searchParams.get('query') ?? '';
      const hit = Object.values(byTitle).find(v => v.mbTitle && q.includes(v.artist));
      return json(200, { recordings: hit ? [{ title: hit.mbTitle, 'artist-credit': [{ name: hit.artist }], 'first-release-date': hit.mbYear, tags: [{ name: 'synth-pop', count: 3 }] }] : [] });
    }
    return json(404, {});
  });
}
const key = (a: string, s: string) => `${normalizeKey(a)}\u0000${normalizeKey(s)}`;
function cacheDeps(rows: Record<string, Partial<CacheRow>>, written: unknown[] = [], estimate?: (s: Array<{ artist: string; song: string }>) => Promise<Array<Record<string, unknown> | null>>) {
  return {
    async readRows() { return Object.entries(rows).map(([k, r]) => { const [artist_key, song_key] = k.split('\u0000'); return { artist_key, song_key, energy: 5, danceability: 5, valence: null, popularity: null, bpm: null, camelot: null, genre: null, year: null, source: 'none', fetched_at: new Date().toISOString(), ...r } as CacheRow; }); },
    async upsert(r: unknown[]) { written.push(...r); },
    estimate: (estimate ?? (async (s) => s.map(() => null))) as never,
  };
}

describe('real enrichment pipeline records per-attribute provenance', () => {
  it('exact provider match, different-version estimate, AI gap fills, legacy and v2 cache rows', async () => {
    stubNetwork({
      exact: { artist: 'Exact Act', rbTitle: 'Exact Song', tempo: 124, mbTitle: 'Exact Song', mbYear: '1985-01-01' },
      remix: { artist: 'Remix Act', rbTitle: 'Track' }, // only the original exists upstream
    });
    const written: Array<{ source: string; artist_key: string }> = [];
    const deps = cacheDeps({
      [key('Legacy Act', 'Legacy Song')]: { bpm: 124, year: 1985, source: 'ReccoBeats+MusicBrainz' },
      [key('V2 Act', 'V2 Song')]: { bpm: 122, year: 1984, source: encodeCacheSource('ReccoBeats+MusicBrainz', { bpm: 'provider', year: 'provider', energy: 'provider', danceability: 'provider' }) },
    }, written, async s => s.map(() => ({ genre: 'AI Genre', year: 1999, bpm: 99 })));
    const { results } = await runEnrichment([
      { artist: 'Exact Act', song: 'Exact Song' }, { artist: 'Remix Act', song: 'Track (Club Remix)' },
      { artist: 'Legacy Act', song: 'Legacy Song' }, { artist: 'V2 Act', song: 'V2 Song' }, { artist: 'Unknown Act', song: 'Nowhere Song' },
    ], deps);
    const [exact, remix, legacy, v2, nowhere] = results;
    expect(exact.prov).toMatchObject({ bpm: 'provider', energy: 'provider', year: 'provider', genre: 'provider' });
    expect(exact.bpm).toBe(124); expect(exact.year).toBe(1985);
    // Different version: provider numbers kept only as estimates, never as verified; nothing is invented.
    expect(remix.prov).toEqual({ energy: 'estimate', danceability: 'estimate', valence: 'estimate', popularity: 'estimate', camelot: 'estimate' });
    expect(remix.year).toBeUndefined();
    // No upstream data: AI fills gaps and every filled attribute is labelled AI.
    expect(nowhere.prov).toEqual({ genre: 'ai', year: 'ai', bpm: 'ai' }); expect(nowhere.source).toBe('AI');
    expect(legacy.source).not.toBe('cache'); expect(legacy.prov).toMatchObject({ bpm: 'estimate', year: 'estimate' });
    expect(v2.prov).toMatchObject({ bpm: 'provider', year: 'provider' });
    expect(written.find(w => w.artist_key === normalizeKey('Exact Act'))!.source).toMatch(/^v2\|/);
  });
});

describe('real event route: provenance, strict limits and isolated providers', () => {
  it('provider values beat AI guesses per attribute; strict BPM/decade limits drop AI-only, legacy and out-of-range additions, keep requests', async () => {
    vi.stubGlobal('fetch', async () => json(404, {}));
    const cached = {
      [key('Verified Act', 'Verified Song')]: { bpm: 122, year: 1984, source: encodeCacheSource('ReccoBeats+MusicBrainz', { bpm: 'provider', year: 'provider', energy: 'provider', danceability: 'provider' }) },
      [key('Legacy Act', 'Legacy Song')]: { bpm: 124, year: 1985, source: 'ReccoBeats+MusicBrainz' },
      [key('Fast Act', 'Fast Song')]: { bpm: 150, year: 1985, source: encodeCacheSource('ReccoBeats', { bpm: 'provider', year: 'provider' }) },
    };
    const deps = cacheDeps(cached, [], async s => s.map(() => ({ bpm: 124, year: 1985 })));
    const h = harness({ rows: { A: row({ bpmRange: [118, 130], decades: ['1980s'] }) }, services: {
      enrich: (r: { data: { songs: Array<{ artist: string; song: string }> } }) => runEnrichment(r.data.songs, deps),
      recommend: async () => ({ suggestions: [sug('Verified Act', 'Verified Song', { bpm: 124, year: 1985 }), sug('Guess Act', 'Guess Song', { bpm: 124, year: 1985 }), sug('Legacy Act', 'Legacy Song', { bpm: 124, year: 1985 }), sug('Fast Act', 'Fast Song', { bpm: 124, year: 1985 })] }),
    } });
    await h.flush(); await h.current.generate(); await h.flush();
    const rows = all(h.current.result);
    const verified = rows.find(t => t.song === 'Verified Song')!;
    expect(verified.bpm).toBe(122); expect(verified.year).toBe(1984);
    expect(verified.metaProv).toMatchObject({ bpm: 'provider', year: 'provider' });
    const names = rows.map(t => t.song);
    expect(names).not.toContain('Guess Song'); expect(names).not.toContain('Legacy Song'); expect(names).not.toContain('Fast Song');
    expect(rows.filter(t => t.fromUpload).map(t => t.song).sort()).toEqual(['Dancing Queen', 'Radio Ga Ga']);
    expect(h.infos.some((m: string) => /couldn't be verified within your limits/.test(m))).toBe(true);
    h.unmount();
  });

  it('an AI neighbour failure keeps valid Last.fm track evidence; partial availability is reported in expansion', async () => {
    const h = harness({ rows: { A: row() }, services: {
      neighbors: async () => { throw Error('AI outage'); },
      similarTracks: async () => ({ availability: 'partial', seeds: [
        { seed: { artist: 'Queen', title: 'Radio Ga Ga' }, status: 'ok', similar: [{ artist: 'Elton John', title: "I'm Still Standing", match: 0.7 }] },
        { seed: { artist: 'ABBA', title: 'Dancing Queen' }, status: 'error', similar: [] },
      ] }),
      recommend: async () => ({ suggestions: [] }),
    } });
    await h.flush(); h.library(library); await h.flush();
    await h.current.generate(); await h.flush();
    const elton = all(h.current.result).find(t => t.song === "I'm Still Standing");
    expect(elton?.aiReason).toMatch(/Last\.fm lists this track as similar to requested Queen/);
    expect(h.infos).toContain('Last.fm answered for some requested tracks only; the rest use other evidence.');
    h.unmount();
  });
});

describe('real event route: automatic expansion requires this account\'s READY preparation knowledge', () => {
  const k = () => setFeedback(emptyKnowledge(), 'Bad Act', 'Never Track', 'never');
  const recommendSpy = () => { const calls: unknown[] = []; return { calls, fn: async () => { calls.push(1); return { suggestions: [sug('Bad Act', 'Never Track'), sug('Plain Act', 'Plain Song')] }; } }; };

  it('waits while loading, then honours Never once ready', async () => {
    const spy = recommendSpy();
    const h = harness({ rows: { A: row() }, prep: { account: 'owner', generation: 1, status: 'loading', knowledge: emptyKnowledge(), error: null }, services: { recommend: spy.fn } });
    await h.flush();
    const run = h.current.generate();
    setTimeout(() => h.setPrep({ account: 'owner', generation: 1, status: 'ready', knowledge: k(), error: null }), 30);
    await run; await h.flush();
    const names = all(h.current.result).map(t => t.song);
    expect(spy.calls.length).toBeGreaterThan(0); expect(names).toContain('Plain Song'); expect(names).not.toContain('Never Track');
    h.unmount();
  });

  it.each([
    ['blocked', { account: 'owner', generation: 1, status: 'blocked', error: 'unreadable' }, GATE_MESSAGES.blocked],
    ['wrong owner', { account: 'someone-else', generation: 1, status: 'ready', error: null }, GATE_MESSAGES.signedOut],
  ])('%s knowledge stops expansion with an actionable message and changes nothing', async (_n, state, message) => {
    const spy = recommendSpy();
    const h = harness({ rows: { A: row() }, prep: { ...state, knowledge: k() }, services: { recommend: spy.fn } });
    await h.flush();
    const before = JSON.stringify(h.current.result);
    await h.current.generate(); await h.flush();
    expect(h.errors).toContain(message); expect(spy.calls).toHaveLength(0);
    expect(JSON.stringify(h.current.result)).toBe(before);
    h.unmount();
  });

  it('loading then blocked mid-wait stops expansion', async () => {
    const spy = recommendSpy();
    const h = harness({ rows: { A: row() }, prep: { account: 'owner', generation: 1, status: 'loading', knowledge: emptyKnowledge(), error: null }, services: { recommend: spy.fn } });
    await h.flush();
    const run = h.current.generate();
    setTimeout(() => h.setPrep({ account: 'owner', generation: 1, status: 'blocked', knowledge: emptyKnowledge(), error: 'x' }), 20);
    await run; await h.flush();
    expect(h.errors).toContain(GATE_MESSAGES.blocked); expect(spy.calls).toHaveLength(0);
    h.unmount();
  });

  it('requests-only generation (expansion off) stays usable while knowledge is blocked', async () => {
    const h = harness({ rows: { A: row({ expand: false }) }, prep: { account: 'owner', generation: 1, status: 'blocked', knowledge: emptyKnowledge(), error: 'x' } });
    await h.flush();
    await h.current.generate(); await h.flush();
    expect(h.errors).toEqual([]);
    expect(all(h.current.result).filter(t => t.fromUpload).map(t => t.song).sort()).toEqual(['Dancing Queen', 'Radio Ga Ga']);
    h.unmount();
  });

  it('a Never write still in flight at the end of generation is awaited and honoured (real serialized store)', async () => {
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    let writes = 0;
    const store = createPrepStore({ read: async () => undefined, write: async () => { writes++; await gate; } });
    await store.setAccount('owner');
    const h = harness({ rows: { A: row() }, prepStore: store, services: {
      recommend: async () => {
        // The user marks a suggested track Never; the write is still queued when generation finishes.
        if (!writes) { void store.update(store.owner()!, (kk: PrepKnowledge) => setFeedback(kk, 'Late Act', 'Late Song', 'never')); setTimeout(release, 40); }
        return { suggestions: [sug('Late Act', 'Late Song'), sug('Plain Act', 'Plain Song')] };
      },
    } });
    await h.flush();
    await h.current.generate(); await h.flush();
    const names = all(h.current.result).map(t => t.song);
    expect(writes).toBe(1);
    expect(names).not.toContain('Late Song'); expect(names).toContain('Plain Song');
    expect(h.infos.some((m: string) => /Never or dismiss choices made during generation/.test(m))).toBe(true);
    h.unmount();
  });
});

describe('feedback gate (bounded wait)', () => {
  it('times out with an actionable message when knowledge never finishes loading', async () => {
    const store = { get: () => ({ account: 'owner', generation: 1, status: 'loading' as const, knowledge: emptyKnowledge() }), subscribe: () => () => {}, settled: async () => emptyKnowledge() };
    expect(await awaitReadyFeedback(store, 'owner', 20)).toEqual({ ok: false, message: GATE_MESSAGES.loading });
  });
});
