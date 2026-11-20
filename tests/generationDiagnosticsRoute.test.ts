import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj'; import * as dance from '@/lib/danceFloor'; import * as audio from '@/lib/audioMatch'; import * as snapshots from '@/lib/snapshotSafety'; import * as drafts from '@/lib/eventDrafts'; import * as input from '@/lib/inputSafety'; import * as autosave from '@/lib/eventAutosave'; import * as vibes from '@/lib/vibes'; import * as isolation from '@/lib/workflowIsolation'; import * as theory from '@/lib/musicTheory'; import * as revisions from '@/lib/eventRevision';
import { createDiagnosticStore, type DiagnosticStorage } from '@/lib/generationDiagnostics/store';
import { copyDiagnostics } from '@/lib/generationDiagnostics/schema';

const require = createRequire(import.meta.url);
const actual = { vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions };
async function setup(enrich: (r: any) => Promise<any>, diagnosticThrows = false, diagnosticVersion = { current: 'web:1.1.0' }) {
  const data = new Map();
  const storage: DiagnosticStorage = { read: async a => [...data].filter(([key]) => key.startsWith(`${a}:`)).map(([, value]) => value), write: async (a, r) => { data.set(`${a}:${r.run.id}`, structuredClone(r)); }, remove: async (a, id) => { data.delete(`${a}:${id}`); } };
  const store = createDiagnosticStore(storage); await store.activate('owner');
  const h = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ ...actual, diagnosticVersion, buildId: '2026-11-18T05:44:00.000Z.synthetic-exact-build', diagnostics: { beginGenerationDiagnostics: diagnosticThrows ? () => null : (...args: any[]) => store.begin(args[0], args[1], args[2], args[3], args[4]) } })({ eventId: 'A', rows: { A: { id: 'A', inputs: { songs: [{ artist: 'Synthetic private client', song: 'PRIVATE title' }], hours: '1', buffer: 1, listType: 'dance', expand: false }, lists: { warmUp: [], transition: [], peak: [], selections: {} } } }, services: { enrich } });
  await h.flush(); return { h, store, data };
}
afterEach(() => vi.useRealTimers());
// Warm the one-time route compilation outside the per-test 5s limit; assertions and limits are unchanged.
beforeAll(async () => { const { h } = await setup(async () => ({ results: [] })); h.unmount(); }, 30_000);
it.each(['desktop:1.2.99', 'web:1.1.0', 'desktop:unavailable'])('actual generation snapshots %s and exact web build without waiting on version status', async version => {
  vi.useFakeTimers(); const ref = { current: version };
  const { h, store } = await setup(async () => ({ results: [] }), false, ref);
  await h.current.generate(); await h.flush();
  expect(store.get().rows[0].run.version).toBe(version);
  expect(store.get().rows[0].run.build).toBe('2026-11-18T05:44:00.000Z.synthetic-exact-build');
  expect(h.current.result.warmUp).toHaveLength(1);
  ref.current = 'desktop:9.9.9'; await h.flush();
  expect(store.get().rows[0].run.version).toBe(version); h.unmount();
});
it('actual handled metadata failure/shortfall notices persist with safe copy and no diagnostic event save', async () => {
  vi.useFakeTimers(); const { h, store } = await setup(async () => { throw Error('PRIVATE raw token /path'); });
  expect(h.requests).toEqual([]); await h.current.generate(); await h.flush(); await store.settled();
  const run = store.get().rows[0].run;
  expect(h.warnings.join(' ')).toContain('Some online track details could not be checked.');
  expect(run.notices.map(n => n.code)).toContain('metadata_failed'); expect(run.notices.map(n => n.code)).toContain('short');
  expect(run.status).toBe('short'); expect(run.coverage).toHaveLength(3); expect(run.requested).toBe(1);
  const { copyDiagnostics } = await import('@/lib/generationDiagnostics/schema');
  expect(copyDiagnostics(run)).not.toMatch(/PRIVATE|client|token|\/path/);
  const before = h.requests.length; store.get(); await store.flush(); expect(h.requests).toHaveLength(before); h.unmount();
});
it('actual hung lookup cancellation/account switch never logs timeout into the next owner or replaces saved selections', async () => {
  vi.useFakeTimers(); const { h, store } = await setup(async () => new Promise(() => {}));
  const work = h.current.generate(); await vi.advanceTimersByTimeAsync(1); h.switchTo('other', 'B'); await store.activate('other');
  await vi.advanceTimersByTimeAsync(20001); await work;
  expect(store.get().rows).toEqual([]); expect(h.current.result).toBe(null);
  await store.activate('owner'); expect(store.get().rows[0].run.status).toBe('cancelled'); expect(store.get().rows[0].run.notices.map(n => n.code)).not.toContain('metadata_timeout'); h.unmount();
});
it('actual route true timeout is distinct from cancellation and partial responses retain safe provider counters', async () => {
  vi.useFakeTimers(); const timed = await setup(async () => new Promise(() => {})); const work = timed.h.current.generate();
  await vi.advanceTimersByTimeAsync(20001); await work;
  expect(timed.store.get().rows[0].run.notices).toContainEqual({ code: 'metadata_timeout', count: 1, provider: 'metadata' }); timed.h.unmount();
  const partial = await setup(async ({ data }) => ({ results: data.songs.map((s: any) => ({ ...s, incomplete: true, source: 'none' })), status: { causes: { ai: { deadline: 2 }, reccobeats: { rate: 1 }, secret: { denied: 9 } } } }));
  await partial.h.current.generate();
  expect(partial.store.get().rows[0].run.causes).toEqual([{ provider: 'ai', cause: 'deadline', count: 2 }, { provider: 'reccobeats', cause: 'rate', count: 1 }]);
  expect(partial.store.get().rows[0].run.notices.map(n => n.code)).toContain('metadata_incomplete'); partial.h.unmount();
});
it('actual temporary-pressure incomplete response emits one final cause-aware notice, no timeout claim or private data', async () => {
  vi.useFakeTimers(); const { h, store } = await setup(async ({ data }) => ({ results: data.songs.map((s: any) => ({ ...s, incomplete: true, source: 'none' })), status: { causes: { reccobeats: { rate: 5 }, musicbrainz: { server: 2, raw: 'PRIVATE' } } } }));
  await h.current.generate(); const messages = h.warnings.filter((s: string) => s.includes('rate limited'));
  expect(messages).toHaveLength(1); expect(messages[0]).toContain('temporary server or network failures'); expect(messages[0]).toContain('Not all selected section preparation targets were reached.'); expect(messages[0]).not.toMatch(/timed out|PRIVATE/);
  expect(store.get().rows[0].run.causes).toEqual([{ provider: 'reccobeats', cause: 'rate', count: 5 }, { provider: 'musicbrainz', cause: 'server', count: 2 }]); h.unmount();
});
it('diagnostics unavailable cannot change route result, recommendation choices or save contract', async () => {
  vi.useFakeTimers(); const { h, store } = await setup(async () => ({ results: [] }), true);
  await h.current.generate(); await h.flush(); expect(h.current.result.warmUp).toHaveLength(1); expect(store.get().rows).toEqual([]); h.unmount();
});

async function expansionFixture(services: Record<string, unknown> = {}, logging = true, beforeContextDispatch?: () => void) {
  const data = new Map();
  const store = createDiagnosticStore({ read: async a => [...data].filter(([k]) => k.startsWith(`${a}:`)).map(([, v]) => v), write: async (a, r) => { data.set(`${a}:${r.run.id}`, structuredClone(r)); }, remove: async () => {} });
  await store.activate('owner');
  const request = { artist: 'PRIVATE Request', song: 'PRIVATE Request Title' };
  const tracks = [
    { artist: request.artist, title: request.song, filePath: '/synthetic/request.mp3', songLength: 240, bpm: '120', year: '2005' },
    { artist: 'PRIVATE Slow', title: 'PRIVATE Slow Title', filePath: '/synthetic/slow.mp3', songLength: 240, bpm: '120', year: '2005', genre: 'Pop' },
    { artist: 'PRIVATE Strict', title: 'PRIVATE Strict Title', filePath: '/synthetic/strict.mp3', songLength: 240, genre: 'Pop' },
  ];
  const h = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ ...actual, beforeContextDispatch, diagnostics: { beginGenerationDiagnostics: logging ? (...args: any[]) => store.begin(args[0], args[1], args[2], args[3], args[4]) : () => null } })({
    eventId: 'A', rows: { A: { id: 'A', inputs: { songs: [request], hours: '0.5', buffer: 1, listType: 'dance', expand: true, genresInput: 'Pop', ownedOnlyExpansion: true, bpmRange: [110, 130], decades: ['2000s'], eventFit: { avoidSlow: true } }, lists: { warmUp: [], transition: [], peak: [], selections: {} } } },
    services: { enrich: async ({ data }: any) => ({ results: data.songs.map((s: any) => ({ ...s, source: 'ReccoBeats', energy: s.artist === 'PRIVATE Slow' ? 2 : 8, danceability: s.artist === 'PRIVATE Slow' ? 2 : 8, bpm: s.artist === 'PRIVATE Strict' ? 90 : 120, year: s.artist === 'PRIVATE Strict' ? 1990 : 2005, prov: { energy: 'provider', danceability: 'provider', bpm: 'provider', year: 'provider' } })) }), ...services },
  });
  await h.flush(); h.library(vdj.buildLibrary(tracks)); await h.flush();
  return { h, store, tracks, data };
}
async function finishExpansion(h: any) {
  let done = false; const run = h.current.generate().finally(() => { done = true; });
  for (let tick = 0; tick < 510 && !done; tick++) await vi.advanceTimersByTimeAsync(1000);
  expect(done).toBe(true); await run; await h.flush();
}
it('actual slow/strict candidate toasts persist once and selections match diagnostics-disabled generation', async () => {
  vi.useFakeTimers(); const f = await expansionFixture(); const before = JSON.stringify(f.tracks);
  await finishExpansion(f.h); await f.store.settled();
  const run = f.store.get().rows[0].run;
  const slow = f.h.infos.find((n: string) => n.includes('slow/ballad additions'));
  const strict = f.h.infos.find((n: string) => n.includes('candidate track') && n.includes("BPM or year couldn't be verified"));
  expect(slow).toBeTruthy(); expect(strict).toBeTruthy();
  expect(run.notices.filter(n => n.code === 'candidate_slow_excluded')).toEqual([{ code: 'candidate_slow_excluded', count: Number(/^\d+/.exec(slow)?.[0]) }]);
  expect(run.notices.filter(n => n.code === 'candidate_strict_excluded')).toEqual([{ code: 'candidate_strict_excluded', count: Number(/^\d+/.exec(strict)?.[0]) }]);
  expect(run.notices.filter(n => n.code === 'strict_excluded')).toEqual([]);
  const rows = [...f.h.current.result.warmUp, ...f.h.current.result.transition, ...f.h.current.result.peak];
  expect(rows.map(s => s.artist)).toEqual(['PRIVATE Request']); expect(JSON.stringify(f.tracks)).toBe(before);
  expect(copyDiagnostics(run)).not.toMatch(/PRIVATE|\/synthetic\//);
  const control = await expansionFixture({}, false); await finishExpansion(control.h);
  expect(control.h.current.result).toEqual(f.h.current.result); f.h.unmount(); control.h.unmount();
});
it.each(['failure', 'timeout'])('actual bounded initial context %s retains safe provider categories without altering exclusions', async mode => {
  vi.useFakeTimers();
  const fallback = mode === 'failure' ? async () => { throw Error('PRIVATE /path token raw'); } : () => new Promise(() => {});
  const f = await expansionFixture({ neighbors: fallback, crowd: fallback, similarTracks: fallback });
  await finishExpansion(f.h); const run = f.store.get().rows[0].run;
  const code = mode === 'failure' ? 'context_failed' : 'context_timeout';
  expect(run.notices.filter(n => n.code === code).sort((a,b) => String(b.provider).localeCompare(String(a.provider)))).toEqual([{ code, count: 2, provider: 'lastfm' }, { code, count: 1, provider: 'ai' }]);
  expect(run.notices.some(n => n.code === (mode === 'failure' ? 'context_timeout' : 'context_failed'))).toBe(false);
  expect([...f.h.current.result.warmUp, ...f.h.current.result.transition, ...f.h.current.result.peak].map(s => s.artist)).toEqual(['PRIVATE Request']);
  expect(copyDiagnostics(run)).not.toMatch(/PRIVATE|\/path|raw/); f.h.unmount();
});
it('actual account cancellation fences late initial context errors instead of recording provider failures/timeouts', async () => {
  vi.useFakeTimers(); let reject: (e: Error) => void = () => {};
  const f = await expansionFixture({ neighbors: () => new Promise((_resolve, r) => { reject = r; }), crowd: async () => ({ artists: [] }), similarTracks: async () => ({ availability: 'ok', seeds: [] }) });
  const work = f.h.current.generate(); await vi.advanceTimersByTimeAsync(1);
  f.h.switchTo('other', 'B'); await f.store.activate('other'); reject(Error('PRIVATE late error'));
  await vi.advanceTimersByTimeAsync(15001); await work;
  expect(f.store.get().rows).toEqual([]); await f.store.activate('owner');
  expect(f.store.get().rows[0].run.status).toBe('cancelled');
  expect(f.store.get().rows[0].run.notices.filter(n => ['context_failed', 'context_timeout'].includes(n.code))).toEqual([]); f.h.unmount();
});
it('actual context microtask account switch starts no old provider request or cross-owner diagnostic', async () => {
  vi.useFakeTimers(); let scheduled = false; let switchAccount = () => {};
  const neighbors = vi.fn(async () => ({ clusters: [] }));
  const crowd = vi.fn(async () => ({ artists: [] }));
  const similarTracks = vi.fn(async () => ({ availability: 'ok', seeds: [] }));
  const f = await expansionFixture({ neighbors, crowd, similarTracks }, true, () => {
    if (scheduled) return;
    scheduled = true; void Promise.resolve().then(() => switchAccount());
  });
  let activated = Promise.resolve();
  switchAccount = () => { f.h.switchTo('other', 'B'); activated = f.store.activate('other'); };
  const work = f.h.current.generate();
  await vi.advanceTimersByTimeAsync(15001); await work; await activated;
  expect(scheduled).toBe(true);
  expect(neighbors).not.toHaveBeenCalled(); expect(crowd).not.toHaveBeenCalled(); expect(similarTracks).not.toHaveBeenCalled();
  expect(f.store.get().account).toBe('other'); expect(f.store.get().rows).toEqual([]);
  expect(f.h.current.result).toBe(null);
  await f.store.activate('owner');
  expect(f.store.get().rows[0].run.status).toBe('cancelled');
  expect(f.store.get().rows[0].run.notices.filter(n => ['context_failed', 'context_timeout', 'context_window'].includes(n.code))).toEqual([]);
  f.h.unmount();
});
it('actual optional extra neighbour crowd lookup failure retains a sanitized Last.fm category', async () => {
  vi.useFakeTimers(); let calls = 0;
  const f = await expansionFixture({ neighbors: async () => ({ clusters: [{ artist: 'PRIVATE Request', neighbors: ['PRIVATE Related'] }] }), similarTracks: async () => ({ availability: 'ok', seeds: [] }), crowd: async () => { if (++calls === 2) throw Error('PRIVATE raw token'); return { artists: [] }; } });
  await finishExpansion(f.h);
  expect(calls).toBe(2);
  expect(f.store.get().rows[0].run.notices.filter(n => n.code === 'context_failed')).toEqual([{ code: 'context_failed', count: 1, provider: 'lastfm' }]);
  expect(copyDiagnostics(f.store.get().rows[0].run)).not.toMatch(/PRIVATE|raw|token/); f.h.unmount();
});

const extraLegacyCounts = { local: 0, database: 20, external: 0, missing: 0, readFailed: 0, writeFailed: 0, refreshFailed: 0 };
async function extraCrowdFixture(extra: () => Promise<any>) {
  const calls: any[] = [];
  const f = await expansionFixture({
    neighbors: async () => ({ clusters: [{ artist: 'PRIVATE Request', neighbors: Array.from({ length: 20 }, (_, i) => `PRIVATE Neighbor ${i}`) }] }),
    similarTracks: async () => ({ availability: 'ok', seeds: [] }),
    crowd: async ({ data }: any) => {
      calls.push(data);
      return data.perArtistSimilar === 0 ? extra() : { artists: [] };
    },
  });
  return { ...f, calls };
}
const extraReply = (reuse: any) => ({ available: true, artists: Array.from({ length: 20 }, (_, i) => ({ name: `PRIVATE Neighbor ${i}`, listeners: 100, tags: [], similar: [] })), reuse });
it.each(['legacy', 'partial'] as const)('actual top-neighbor batch persists %s reuse exactly once with finite private-safe counts', async mode => {
  vi.useFakeTimers();
  const counts = mode === 'legacy' ? extraLegacyCounts : { ...extraLegacyCounts, database: 16, readFailed: 4, readDeadline: 1, readDenied: 1, readSchema: 1, readOther: 1 };
  const f = await extraCrowdFixture(async () => extraReply(counts));
  const control = await extraCrowdFixture(async () => extraReply(undefined));
  try {
    await finishExpansion(control.h); await control.store.settled(); const before = (control.store.get().rows[0].run.reuse ?? {}) as Record<string, number | undefined>;
    const baseline = control.store.get().rows[0].run.reuse;
    await finishExpansion(f.h); await f.store.settled();
    expect(f.calls.filter(c => c.perArtistSimilar === 0)).toEqual([{ artists: Array.from({ length: 20 }, (_, i) => `PRIVATE Neighbor ${i}`), perArtistSimilar: 0 }]);
    const run = f.store.get().rows[0].run;
    expect(run.reuse?.database).toBe(counts.database);
    for (const key of ['readDeadline', 'readDenied', 'readSchema', 'readOther'] as const) expect(run.reuse?.[key] ?? 0).toBe(mode === 'partial' ? 1 : 0);
    // Other route consumers keep their existing local-storage counts unchanged.
    expect(run.reuse?.readFailed).toBe((baseline?.readFailed ?? 0) + counts.readFailed);
    expect(Object.values(run.reuse ?? {}).every(Number.isFinite)).toBe(true);
    expect([...f.data.values()][0].run.reuse).toEqual(run.reuse);
    expect(copyDiagnostics(run)).not.toMatch(/PRIVATE|Neighbor|synthetic\//);
    expect([...f.h.current.result.warmUp, ...f.h.current.result.transition, ...f.h.current.result.peak].map(s => s.artist)).toEqual(['PRIVATE Request']);
    expect(f.h.current.result).toEqual(control.h.current.result);
  } finally { f.h.unmount(); control.h.unmount(); }
});
it.each(['timeout', 'event', 'account', 'cancelled', 'fallback'] as const)('actual top-neighbor %s cannot add late or fallback reuse', async mode => {
  vi.useFakeTimers(); let resolve = (_value: any) => {};
  const f = await extraCrowdFixture(mode === 'fallback' ? async () => { throw Error('PRIVATE transport'); } : () => new Promise(r => { resolve = r; }));
  try {
    let done = false; const work = f.h.current.generate().finally(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls.filter(c => c.perArtistSimilar === 0)).toHaveLength(1);
    if (mode === 'event') f.h.switchTo('owner', 'B');
    if (mode === 'account') { f.h.switchTo('other', 'B'); await f.store.activate('other'); }
    if (mode === 'cancelled') f.h.current.clearWorkflowState();
    if (mode !== 'timeout') resolve(extraReply({ ...extraLegacyCounts, readFailed: 4, readDeadline: 4 }));
    for (let tick = 0; tick < 510 && !done; tick++) await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(true); await work; await f.h.flush(); await f.store.settled();
    if (mode === 'account') { expect(f.store.get().rows).toEqual([]); await f.store.activate('owner'); }
    const before = structuredClone(f.store.get().rows[0].run);
    resolve(extraReply({ ...extraLegacyCounts, readFailed: 4, readDeadline: 4 }));
    await vi.advanceTimersByTimeAsync(1000); await f.store.settled();
    expect(f.store.get().rows[0].run).toEqual(before);
    expect(before.reuse?.database ?? 0).toBe(0); expect(before.reuse?.readDeadline ?? 0).toBe(0);
    expect(copyDiagnostics(before)).not.toMatch(/PRIVATE|transport|Neighbor/);
  } finally { f.h.unmount(); }
});import { weeklyCheck, weeklyEvidence } from './helpers/weeklyEvidence';
it('weekly structured cache diagnostics once', async () => {
  await weeklyEvidence('cache-diagnostics', 'cache', async e => {
    vi.useFakeTimers();
    const counts = { ...extraLegacyCounts, database: 16, readFailed: 4, readDeadline: 1, readDenied: 1, readSchema: 1, readOther: 1 };
    const f = await extraCrowdFixture(async () => extraReply(counts)), control = await extraCrowdFixture(async () => extraReply(undefined));
    try {
      await finishExpansion(control.h); await control.store.settled(); const before = (control.store.get().rows[0].run.reuse ?? {}) as Record<string, number | undefined>;
      await finishExpansion(f.h); await f.store.settled(); const run = f.store.get().rows[0].run;
      weeklyCheck(e, 'diagnostics-database-once', run.reuse?.database ?? 0, 16);
      const reuse = (run.reuse ?? {}) as Record<string, number | undefined>;
      // Accepted top-neighbor causes relative to the identical no-count control run (other synthetic lanes contribute their own).
      const added = (key: string) => (reuse[key] ?? 0) - (before[key] ?? 0);
      weeklyCheck(e, 'diagnostics-read-failed', added('readFailed'), 4);
      for (const [rule, key] of [['deadline', 'readDeadline'], ['denied', 'readDenied'], ['schema', 'readSchema'], ['other', 'readOther']] as const)
        weeklyCheck(e, `diagnostics-read-${rule}`, added(key), 1);
      weeklyCheck(e, 'diagnostics-finite', Number(Object.values(run.reuse ?? {}).every(Number.isFinite)), 1);
      weeklyCheck(e, 'diagnostics-private-safe', Number(!/PRIVATE|Neighbor|synthetic\//.test(copyDiagnostics(run))), 1);
      weeklyCheck(e, 'diagnostics-selections-unchanged', Number(JSON.stringify(f.h.current.result) === JSON.stringify(control.h.current.result)), 1);
    } finally { f.h.unmount(); control.h.unmount(); }
  });
});
