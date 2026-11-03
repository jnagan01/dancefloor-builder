import { describe, it, expect, vi, afterEach } from 'vitest';
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
import { normalizeKey } from '@/lib/danceFloor';
import { runEnrichment, type CacheRow, type EnrichedSong } from '@/lib/enrichPipeline.server';
import { encodeCacheSource } from '@/lib/prep/provenance';
import { createFactsGatherer, factsKey, FACTS_TIMEOUT_MS, ENRICH_SERVER_DEADLINE_MS } from '@/lib/prep/factsGather';
import { listsSchema } from '@/lib/history.functions';
const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });

// Isolated, synthetic (TEST ONLY) fixtures. Injected fake storage/network/AI — no live services, no DB.
const key = (a: string, s: string) => `${normalizeKey(a)}\u0000${normalizeKey(s)}`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const V2 = (prov: Record<string, string>) => encodeCacheSource('ReccoBeats+MusicBrainz', prov as never);
const fresh = () => new Date().toISOString();
type Hang = 'abortable' | 'never';
/** Fake ReccoBeats/MusicBrainz: titles in `hang` never reply (abortable ones reject when aborted); others answer exactly. */
function stubNet(hang: Record<string, Hang> = {}, log: string[] = []) {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const text = u.searchParams.get('searchText') ?? u.searchParams.get('query') ?? decodeURIComponent(u.pathname);
    const h = Object.entries(hang).find(([t]) => text.includes(t));
    log.push(text);
    if (h) return new Promise<Response>((_, rej) => { if (h[1] === 'abortable') init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))); });
    if (u.host === 'api.reccobeats.com' && u.pathname.endsWith('/search')) {
      const t = u.searchParams.get('searchText')!; const page = Number(u.searchParams.get('page'));
      return Promise.resolve(json(200, { content: page === 0 ? [{ id: t, trackTitle: t, artists: [{ name: `TEST ONLY ${t.split(' ')[0]}` }], popularity: 80 }] : [] }));
    }
    if (u.host === 'api.reccobeats.com') return Promise.resolve(json(200, { energy: 0.8, danceability: 0.8, valence: 0.5, tempo: 120 }));
    if (u.host === 'musicbrainz.org') return Promise.resolve(json(200, { recordings: [] }));
    return Promise.resolve(json(404, {}));
  });
}
function deps(rows: Record<string, Partial<CacheRow>>, o: { read?: 'hang'; upsert?: 'hang'; estimate?: any; written?: unknown[]; limits?: any } = {}) {
  return {
    readRows: () => o.read === 'hang' ? new Promise<CacheRow[]>(() => {}) : Promise.resolve(Object.entries(rows).map(([k, r]) => { const [artist_key, song_key] = k.split('\u0000'); return { artist_key, song_key, energy: null, danceability: null, valence: null, popularity: null, bpm: null, camelot: null, genre: null, year: null, source: 'none', fetched_at: fresh(), ...r } as CacheRow; })),
    upsert: (r: unknown[]) => { o.written?.push(...r); return o.upsert === 'hang' ? new Promise<void>(() => {}) : Promise.resolve(); },
    estimate: o.estimate ?? (async (s: unknown[]) => s.map(() => null)),
    limits: o.limits ?? { totalMs: 400, cacheReadMs: 80, aiMs: 80, upsertMs: 60, requestMs: 300, assemblyMs: 10 },
  };
}
const A = (t: string) => `TEST ONLY ${t.split(' ')[0]}`;
const cachedHit = { energy: 7, danceability: 6, popularity: 7, year: 1979, source: V2({ energy: 'provider', danceability: 'provider', popularity: 'provider', year: 'provider' }) };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('server pipeline end-to-end deadline (real runEnrichment)', () => {
  it('constants: server deadline sits a margin below the client cutoff', () => {
    expect(ENRICH_SERVER_DEADLINE_MS).toBeLessThan(FACTS_TIMEOUT_MS);
    expect(FACTS_TIMEOUT_MS - ENRICH_SERVER_DEADLINE_MS).toBeGreaterThanOrEqual(3000);
  });

  it('cache hits are never held hostage by a never-replying miss; completed provider facts are kept', async () => {
    stubNet({ 'Hung': 'never' });
    const t0 = Date.now();
    const { results, status } = await runEnrichment([
      { artist: A('Warm One'), song: 'Warm One' }, { artist: A('Hung Song'), song: 'Hung Song' }, { artist: A('Fresh Song'), song: 'Fresh Song' }, { artist: A('Warm Two'), song: 'Warm Two' },
    ], deps({ [key(A('Warm One'), 'Warm One')]: cachedHit, [key(A('Warm Two'), 'Warm Two')]: cachedHit }));
    expect(Date.now() - t0).toBeLessThan(400);
    const [w1, hung, fr, w2] = results;
    expect([w1.energy, w2.energy]).toEqual([7, 7]); expect(w1.prov).toMatchObject({ energy: 'provider' });
    expect(fr.energy).toBe(8); expect(fr.prov).toMatchObject({ energy: 'provider' }); expect(fr.incomplete).toBeUndefined();
    expect(hung).toMatchObject({ source: 'none', incomplete: true }); expect(hung.energy).toBeUndefined();
    expect(status).toMatchObject({ complete: false, unfinished: 1 }); expect(status.timedOut).toContain('fetch');
  });

  it('abortable in-flight requests are aborted at the phase deadline; late results cannot mutate the response', async () => {
    let lateResolve!: (r: Response) => void; const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', (_u: string, init?: RequestInit) => { signals.push(init!.signal!); return new Promise<Response>((res) => { lateResolve = res; }); });
    const out = await runEnrichment([{ artist: A('Late Song'), song: 'Late Song' }], deps({}));
    expect(signals.length).toBeGreaterThan(0); expect(signals.every(s => s.aborted)).toBe(true);
    const snap = JSON.stringify(out);
    lateResolve(json(200, { content: [{ id: 'x', trackTitle: 'Late Song', artists: [{ name: A('Late Song') }], popularity: 90 }] }));
    await new Promise(r => setTimeout(r, 20));
    expect(JSON.stringify(out)).toBe(snap);
    expect(out.results[0]).toMatchObject({ incomplete: true, source: 'none' });
  });

  it('AI estimate hang is bounded and aborted; provider/partial facts are retained, nothing invented', async () => {
    stubNet({ 'NoData': 'abortable' });
    let aiSignal: AbortSignal | undefined;
    const t0 = Date.now();
    const { results, status } = await runEnrichment([{ artist: A('Fresh Song'), song: 'Fresh Song' }, { artist: A('NoData Song'), song: 'NoData Song' }],
      deps({ [key(A('NoData Song'), 'NoData Song')]: { year: 1984, source: V2({ year: 'provider' }) } }, { estimate: (_s: unknown, sig: AbortSignal) => { aiSignal = sig; return new Promise(() => {}); } }));
    expect(Date.now() - t0).toBeLessThan(400);
    expect(results[0].energy).toBe(8);
    expect(results[1]).toMatchObject({ year: 1984, incomplete: true }); expect(results[1].energy).toBeUndefined();
    expect(results[1].prov).toMatchObject({ year: 'provider' });
    expect(status.timedOut).toEqual(expect.arrayContaining(['fetch']));
    expect(results[1].source).not.toBe('AI');
    if (aiSignal) expect(aiSignal.aborted).toBe(true);
  });

  it('AI hang after a completed provider pass: ai phase reported, provider facts kept', async () => {
    vi.stubGlobal('fetch', async (url: string) => new URL(url).host === 'api.reccobeats.com' ? json(200, { content: [] }) : json(200, { recordings: [] }));
    let aiSignal: AbortSignal | undefined;
    const { results, status } = await runEnrichment([{ artist: A('Gap Song'), song: 'Gap Song' }], deps({}, { estimate: (_s: unknown, sig: AbortSignal) => { aiSignal = sig; return new Promise(() => {}); } }));
    expect(status.timedOut).toEqual(['ai']); expect(aiSignal!.aborted).toBe(true);
    expect(results[0]).toMatchObject({ source: 'none', incomplete: true });
  });

  it('cache-write hang never delays the response or drops the fetched facts', async () => {
    stubNet();
    const written: unknown[] = [];
    const t0 = Date.now();
    const { results, status } = await runEnrichment([{ artist: A('Fresh Song'), song: 'Fresh Song' }], deps({}, { upsert: 'hang', written }));
    expect(Date.now() - t0).toBeLessThan(400);
    expect(results[0]).toMatchObject({ energy: 8, danceability: 8 }); expect(results[0].incomplete).toBeUndefined();
    expect(status.timedOut).toEqual(['upsert']); expect(status.unfinished).toBe(0); expect(written).toHaveLength(1);
  });

  it('cache-read hang reads as no cache knowledge (no fabricated hits) and still fetches within budget', async () => {
    stubNet();
    const { results, status } = await runEnrichment([{ artist: A('Fresh Song'), song: 'Fresh Song' }], deps({ [key(A('Fresh Song'), 'Fresh Song')]: cachedHit }, { read: 'hang' }));
    expect(status.timedOut).toContain('cacheRead'); expect(results[0].energy).toBe(8); expect(results[0].year).toBeUndefined();
  });

  it('warm cache without popularity: fetched once only when familiarity is active; cached values/provenance kept if the upgrade hangs', async () => {
    const log: string[] = [];
    stubNet({}, log);
    const row = { [key(A('Warm Song'), 'Warm Song')]: { energy: 6, danceability: 6, year: 1999, source: V2({ energy: 'estimate', danceability: 'estimate', year: 'provider' }) } };
    const off = await runEnrichment([{ artist: A('Warm Song'), song: 'Warm Song' }], deps(row));
    expect(log).toHaveLength(0); expect(off.results[0].popularity).toBeUndefined(); expect(off.status.complete).toBe(true);
    const on = await runEnrichment([{ artist: A('Warm Song'), song: 'Warm Song' }], deps(row), { needPopularity: true });
    expect(on.results[0].popularity).toBe(8); expect(on.results[0].prov).toMatchObject({ popularity: 'provider', year: 'provider' });
    stubNet({ 'Warm': 'never' });
    const hung = await runEnrichment([{ artist: A('Warm Song'), song: 'Warm Song' }], deps(row), { needPopularity: true });
    expect(hung.results[0]).toMatchObject({ energy: 6, year: 1999, incomplete: true }); expect(hung.results[0].popularity).toBeUndefined();
    expect(hung.results[0].prov).toMatchObject({ energy: 'estimate', year: 'provider' });
  });

  it('deterministic priority: energy gaps are fetched before popularity-only upgrades', async () => {
    const log: string[] = [];
    stubNet({}, log);
    const row = { [key(A('Pop Upgrade'), 'Pop Upgrade')]: { energy: 6, danceability: 6, source: V2({ energy: 'provider', danceability: 'provider' }) } };
    await runEnrichment([{ artist: A('Pop Upgrade'), song: 'Pop Upgrade' }, { artist: A('Gap Song'), song: 'Gap Song' }], { ...deps(row), limits: { totalMs: 2000, cacheReadMs: 80, aiMs: 80, upsertMs: 60, requestMs: 300, assemblyMs: 10 } }, { needPopularity: true });
    expect(log.findIndex(t => t.includes('Gap Song'))).toBeLessThan(log.findIndex(t => t.includes('Pop Upgrade')));
  });
});

describe('client gatherer + real pipeline with production deadlines (fake clock)', () => {
  // This is the regression: with the original 20s server fetch budget + unbounded in-flight/AI/write, the client's 20s cut
  // discarded the whole chunk — cache hits included.
  it('a never-replying miss no longer discards cache hits in the same chunk', async () => {
    vi.useFakeTimers();
    stubNet({ 'Hung': 'never' });
    const d = { ...deps({ [key(A('Warm One'), 'Warm One')]: cachedHit, [key(A('Warm Two'), 'Warm Two')]: cachedHit }, { estimate: () => new Promise(() => {}), upsert: 'hang' }), limits: undefined };
    const g = createFactsGatherer<EnrichedSong>(async (songs) => (await runEnrichment(songs, d as never)).results, factsKey, { isIncomplete: (e) => !!e.incomplete });
    const run = g.gather([{ artist: A('Warm One'), song: 'Warm One' }, { artist: A('Hung Song'), song: 'Hung Song' }, { artist: A('Warm Two'), song: 'Warm Two' }]);
    await vi.advanceTimersByTimeAsync(FACTS_TIMEOUT_MS + 1000);
    const rep = await run;
    expect(rep.timedOutSongs).toBe(0);
    expect(g.get({ artist: A('Warm One'), song: 'Warm One' })?.energy).toBe(7);
    expect(g.get({ artist: A('Warm Two'), song: 'Warm Two' })?.energy).toBe(7);
    expect(rep.incompleteSongs).toBe(1);
    expect(g.get({ artist: A('Hung Song'), song: 'Hung Song' })?.energy).toBeUndefined();
  });

  it('>200 songs: deterministic chunks, bounded concurrency, each chunk returns its cache hits before the client cutoff', async () => {
    vi.useFakeTimers();
    stubNet({ 'Hung': 'never' });
    const rows: Record<string, Partial<CacheRow>> = {};
    const list = Array.from({ length: 450 }, (_, i) => i % 50 === 0 ? { artist: A(`Hung ${i}`), song: `Hung ${i}` } : { artist: A(`Warm ${i}`), song: `Warm ${i}` });
    for (const s of list) if (!s.song.startsWith('Hung')) rows[key(s.artist, s.song)] = cachedHit;
    const d = { ...deps(rows, { estimate: () => new Promise(() => {}) }), limits: undefined };
    let inflight = 0, peak = 0; const sizes: number[] = [];
    const g = createFactsGatherer<EnrichedSong>(async (songs) => { sizes.push(songs.length); inflight++; peak = Math.max(peak, inflight); try { return (await runEnrichment(songs, d as never)).results; } finally { inflight--; } }, factsKey, { isIncomplete: (e) => !!e.incomplete, budget: 1000 });
    const run = g.gather(list);
    await vi.advanceTimersByTimeAsync(3 * FACTS_TIMEOUT_MS);
    const rep = await run;
    expect(sizes).toEqual([200, 200, 50]); expect(peak).toBeLessThanOrEqual(2);
    expect(rep).toMatchObject({ requested: 450, found: 450, timedOutSongs: 0, incompleteSongs: 9 });
    expect(list.filter(s => g.get(s)?.energy === 7)).toHaveLength(441);
  });
});

describe('real event route + real pipeline: mixed cache hits, hung lookups, partial facts', () => {
  const requests = [{ artist: 'Queen', song: 'Radio Ga Ga', fromUpload: true }, { artist: 'ABBA', song: 'Dancing Queen', fromUpload: true }];
  const row = (inputs: Record<string, unknown> = {}) => ({ id: 'A', name: 'Synthetic', updated_at: 'v1', inputs: { songs: requests, hours: '1', buffer: 1, listType: 'dance', expand: true, ...inputs }, lists: { warmUp: [...requests], transition: [], peak: [] } });
  const all = (r: any) => [...r.warmUp, ...r.transition, ...r.peak];
  const sug = (t: string) => ({ artist: A(t), song: t, reason: 'synthetic' });

  it('additions keep completed cache facts in rankWhy, hung ones stay unknown, requests preserved, incomplete status shown', async () => {
    stubNet({ 'Hung': 'never' });
    const prov = V2({ energy: 'provider', danceability: 'provider', year: 'provider', bpm: 'provider' });
    const cache = { [key(A('Warm Alpha'), 'Warm Alpha')]: { ...cachedHit, bpm: 122, source: prov }, [key(A('Warm Beta'), 'Warm Beta')]: { ...cachedHit, bpm: 124, source: prov } };
    const d = deps(cache, { estimate: () => new Promise(() => {}), upsert: 'hang' });
    const seen: any[] = [];
    const h = harness({ rows: { A: row({ eventFit: { avoidSlow: true, familiarity: 'familiar' }, decades: ['1970s'], bpmRange: [118, 126] }) }, services: {
      enrich: (r: any) => { seen.push(r.data); return runEnrichment(r.data.songs, d as never, { needPopularity: r.data.needPopularity }); },
      recommend: async () => ({ suggestions: [sug('Warm Alpha'), sug('Hung Gamma'), sug('Warm Beta')] }),
    } });
    await h.flush(); await h.current.generate(); await h.flush();
    const rows = all(h.current.result);
    expect(rows.filter((t: any) => t.fromUpload).map((t: any) => t.song)).toEqual(['Radio Ga Ga', 'Dancing Queen']);
    const alpha = rows.find((t: any) => t.song === 'Warm Alpha');
    expect(alpha?.energy).toBe(7); expect(alpha?.metaProv).toMatchObject({ energy: 'provider' });
    expect(alpha?.rankWhy).not.toMatch(/no energy or danceability data/);
    const gamma = rows.find((t: any) => t.song === 'Hung Gamma');
    if (gamma) expect(gamma.metaProv?.energy).not.toBe('provider');
    expect(seen.some(x => x.needPopularity === true)).toBe(true);
    expect(h.infos.some((m: string) => /ran out of time/.test(m))).toBe(true);
    expect(listsSchema.safeParse(h.current.result).success).toBe(true);
    h.unmount();
  });

  it('strict decade limit: an unfinished lookup never gains a verified year and is excluded, cached verified year stays eligible', async () => {
    stubNet({ 'Hung': 'never' });
    const cache = { [key(A('Warm Alpha'), 'Warm Alpha')]: { ...cachedHit, year: 1979 } };
    const d = deps(cache, { estimate: async (s: unknown[]) => s.map(() => ({ year: 1978, energy: 7, danceability: 7 })) });
    const h = harness({ rows: { A: row({ decades: ['1970s'] }) }, services: {
      enrich: (r: any) => runEnrichment(r.data.songs, d as never, { needPopularity: r.data.needPopularity }),
      recommend: async () => ({ suggestions: [sug('Warm Alpha'), sug('Hung Gamma')] }),
    } });
    await h.flush(); await h.current.generate(); await h.flush();
    const names = all(h.current.result).map((t: any) => t.song);
    expect(names).toContain('Warm Alpha'); expect(names).not.toContain('Hung Gamma');
    h.unmount();
  });
});
