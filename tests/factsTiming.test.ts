import { describe, it, expect } from 'vitest';
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
import { createFactsGatherer, needsFacts, factsKey, FACTS_BATCH } from '@/lib/prep/factsGather';
import { listsSchema } from '@/lib/history.functions';
const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });

// Synthetic, isolated fixtures (TEST ONLY names). Real event route + real owned-library candidate path; services are fakes.
const requests = [{ artist: 'Queen', song: 'Radio Ga Ga', fromUpload: true }, { artist: 'ABBA', song: 'Dancing Queen', fromUpload: true }];
const row = (inputs: Record<string, unknown> = {}) => ({ id: 'A', name: 'Synthetic', updated_at: 'v1', inputs: { songs: requests, hours: '1', buffer: 1, listType: 'dance', expand: true, ...inputs }, lists: { warmUp: [...requests], transition: [], peak: [] } });
const OWNED = 'TEST ONLY Owned Act';
const lib = vdj.buildLibrary([
  { filePath: '/synthetic/owned/est-slow.mp3', artist: `${OWNED} One`, title: 'Estimated Slow', year: '1985', genre: 'Pop' },
  { filePath: '/synthetic/owned/ver-slow.mp3', artist: `${OWNED} Two`, title: 'Verified Slow', year: '1986', genre: 'Pop' },
  { filePath: '/synthetic/owned/upbeat.mp3', artist: `${OWNED} Three`, title: 'Upbeat', year: '1972', genre: 'Funk' },
] as vdj.VdjTrack[]);
const P = (v: string) => ({ energy: v, danceability: v, popularity: v, year: v });
const PROVIDER: Record<string, any> = {
  'Estimated Slow': { energy: 2, danceability: 2, popularity: 8, prov: P('estimate'), source: 'AI' },
  'Verified Slow': { energy: 2, danceability: 2, popularity: 8, prov: P('provider'), source: 'ReccoBeats' },
  'Upbeat': { energy: 8, danceability: 8, year: 1999, prov: P('provider'), source: 'ReccoBeats' }, // year must NOT beat the file tag
};
const crowd = async () => ({ available: true, artists: [{ name: 'Queen', listeners: 1, tags: [], similar: ['One', 'Two', 'Three'].map(n => ({ name: `${OWNED} ${n}`, match: 0.6 })) }] });
const answer = (songs: any[]) => ({ results: songs.flatMap(s => PROVIDER[s.song] && s.artist.startsWith(OWNED) ? [{ artist: s.artist, song: s.song, ...PROVIDER[s.song] }] : []) });
const all = (r: any) => [...r.warmUp, ...r.transition, ...r.peak];

function deferredEnrich() {
  const calls: any[][] = []; const pending: Array<() => void> = [];
  // Only lookups containing owned candidates are held; request lookups answer immediately.
  const enrich = (req: any) => { calls.push(req.data.songs); if (!req.data.songs.some((s: any) => s.artist.startsWith(OWNED))) return Promise.resolve(answer(req.data.songs)); return new Promise(res => pending.push(() => res(answer(req.data.songs)))); };
  return { calls, enrich, releaseAll: () => { while (pending.length) pending.shift()!(); } };
}
async function settle(h: any, d: ReturnType<typeof deferredEnrich>, gen: Promise<unknown>) {
  for (let i = 0; i < 20; i++) { d.releaseAll(); await h.flush(); }
  await gen; await h.flush();
}

describe('owned-library facts are gathered BEFORE ranking (timing regression)', () => {
  it('holds ranking until the bounded lookup settles; rankWhy and fit facts agree; verified low energy+dance excludes, estimate only penalises', async () => {
    const d = deferredEnrich();
    const h = harness({ rows: { A: row({ eventFit: { avoidSlow: true } }) }, services: { crowd, recommend: async () => ({ suggestions: [] }), enrich: d.enrich } });
    await h.flush(); h.library(lib); await h.flush();
    const gen = h.current.generate();
    for (let i = 0; i < 10; i++) await h.flush();
    // Old timing: owned rows were never in the pre-rank lookup, so no call contained them before ranking finished.
    const ownedCall = d.calls.find(c => c.some((s: any) => s.artist.startsWith(OWNED)));
    expect(ownedCall, 'owned candidates must be looked up before ranking').toBeTruthy();
    expect(all(h.current.result ?? { warmUp: [], transition: [], peak: [] }).some((t: any) => t.artist.startsWith(OWNED))).toBe(false); // nothing ranked/placed yet
    await settle(h, d, gen);
    const rows = all(h.current.result);
    expect(rows.filter((t: any) => t.fromUpload).map((t: any) => t.song)).toEqual(['Radio Ga Ga', 'Dancing Queen']);
    const est = rows.find((t: any) => t.song === 'Estimated Slow');
    const up = rows.find((t: any) => t.song === 'Upbeat');
    expect(rows.find((t: any) => t.song === 'Verified Slow')).toBeUndefined();
    expect(est, 'estimates never exclude').toBeTruthy();
    expect(est.energy).toBe(2); expect(est.danceability).toBe(2);
    expect(est.rankWhy).toMatch(/Energy 2\/10 and danceability 2\/10 suggest a slow song \(estimate, advisory\)/);
    expect(est.rankWhy).not.toMatch(/no energy or danceability data/);
    expect(up.energy).toBe(8); expect(up.year).toBe(1972); // verified file tag beats provider year
    // Each owned key was requested exactly once (final pass never re-requests attempted additions).
    const flat = d.calls.flat().map(factsKey);
    for (const [n, s] of [['One', 'Estimated Slow'], ['Two', 'Verified Slow'], ['Three', 'Upbeat']]) expect(flat.filter(k => k === `${OWNED} ${n}||${s}`)).toHaveLength(1);
    expect(listsSchema.safeParse(h.current.result).success).toBe(true);
    h.unmount();
  });

  it('provider failure leaves owned facts unknown (no fabrication) and still ranks honestly', async () => {
    const h = harness({ rows: { A: row({ eventFit: { avoidSlow: true } }) }, services: { crowd, recommend: async () => ({ suggestions: [] }), enrich: async () => { throw new Error('service unavailable'); } } });
    await h.flush(); h.library(lib); await h.flush();
    await h.current.generate(); await h.flush();
    const owned = all(h.current.result).filter((t: any) => t.artist.startsWith(OWNED));
    expect(owned.length).toBe(3); // unknown never excludes
    for (const t of owned) { expect(t.energy).toBeUndefined(); expect(t.rankWhy).toMatch(/no energy or danceability data/); }
    expect(h.warnings.some((w: string) => /Couldn't reach the online music data service/.test(w))).toBe(true);
    h.unmount();
  });

  it('a newer generation during the await discards the stale result', async () => {
    const d = deferredEnrich();
    const h = harness({ rows: { A: row() }, services: { crowd, recommend: async () => ({ suggestions: [] }), enrich: d.enrich } });
    await h.flush(); h.library(lib); await h.flush();
    const first = h.current.generate();
    for (let i = 0; i < 10; i++) await h.flush();
    h.switchTo('other', 'A'); await h.flush(); // account switch while the lookup is held
    await settle(h, d, first);
    expect(all(h.current.result ?? { warmUp: [], transition: [], peak: [] }).some((t: any) => t.artist.startsWith(OWNED))).toBe(false);
    h.unmount();
  });

  it('no-fit events still gather energy/danceability before ranking', () => {
    expect(needsFacts({ artist: 'a', song: 'b', energy: 5, danceability: 5 }, false)).toBe(false);
    expect(needsFacts({ artist: 'a', song: 'b', energy: 5, danceability: 5 }, true)).toBe(true); // popularity when familiarity active
    expect(needsFacts({ artist: 'a', song: 'b', energy: 5 }, false)).toBe(true);
  });
});

describe('bounded per-generation gatherer', () => {
  const songs = (n: number) => Array.from({ length: n }, (_, i) => ({ artist: `A${String(i).padStart(4, '0')}`, song: 'S' }));
  it('splits >200 into deterministic chunks of ≤200 instead of silently slicing', async () => {
    const sizes: number[] = []; const firsts: string[] = [];
    const g = createFactsGatherer(async c => { sizes.push(c.length); firsts.push(c[0].artist); return c.map(s => ({ ...s, energy: 5 })); }, factsKey, { concurrency: 1 });
    const rep = await g.gather(songs(450));
    expect(sizes).toEqual([FACTS_BATCH, FACTS_BATCH, 50]);
    expect(firsts).toEqual(['A0000', 'A0200', 'A0400']);
    expect(rep).toMatchObject({ requested: 450, found: 450, failedSongs: 0, skippedByBudget: 0 });
    expect(g.get({ artist: 'A0449', song: 'S' })).toBeTruthy();
  });
  it('enforces the budget and bounded concurrency; beyond-budget songs stay unknown and counted', async () => {
    let live = 0, peak = 0;
    const g = createFactsGatherer(async c => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 1)); live--; return []; }, factsKey, { budget: 500, concurrency: 2 });
    const rep = await g.gather(songs(900));
    expect(rep.requested).toBe(500); expect(rep.skippedByBudget).toBe(400); expect(peak).toBeLessThanOrEqual(2);
    expect(g.wasAttempted({ artist: 'A0899', song: 'S' })).toBe(false);
  });
  it('partial failure: only the failed chunk is unknown; duplicates and attempted misses are never re-requested', async () => {
    let n = 0; const requested: string[] = [];
    const g = createFactsGatherer(async c => { requested.push(...c.map(factsKey)); if (n++ === 1) throw new Error('500'); return c.slice(0, 10).map(s => ({ ...s })); }, factsKey, { concurrency: 1 });
    const list = songs(300);
    const rep = await g.gather([...list, ...list.slice(0, 5)]);
    expect(rep).toMatchObject({ requested: 300, found: 10, failedSongs: 100 });
    expect(g.anyFailure).toBe(true);
    const again = await g.gather(list);
    expect(again.requested).toBe(0); expect(again.alreadyAttempted).toBe(300);
    expect(new Set(requested).size).toBe(requested.length);
  });
  it('ignores results for songs it did not ask about (exact artist/version mapping)', async () => {
    const g = createFactsGatherer(async () => [{ artist: 'X', song: 'Song (Remix)' }, { artist: 'X', song: 'Song' }], factsKey);
    await g.gather([{ artist: 'X', song: 'Song' }]);
    expect(g.get({ artist: 'X', song: 'Song (Remix)' })).toBeUndefined();
    expect(g.get({ artist: 'X', song: 'Song' })).toBeTruthy();
  });
});
