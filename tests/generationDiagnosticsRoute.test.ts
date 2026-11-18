import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj'; import * as dance from '@/lib/danceFloor'; import * as audio from '@/lib/audioMatch'; import * as snapshots from '@/lib/snapshotSafety'; import * as drafts from '@/lib/eventDrafts'; import * as input from '@/lib/inputSafety'; import * as autosave from '@/lib/eventAutosave'; import * as vibes from '@/lib/vibes'; import * as isolation from '@/lib/workflowIsolation'; import * as theory from '@/lib/musicTheory'; import * as revisions from '@/lib/eventRevision';
import { createDiagnosticStore, type DiagnosticStorage } from '@/lib/generationDiagnostics/store';

const require = createRequire(import.meta.url);
const actual = { vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions };
async function setup(enrich: (r: any) => Promise<any>, diagnosticThrows = false) {
  const data = new Map();
  const storage: DiagnosticStorage = { read: async a => [...data].filter(([key]) => key.startsWith(`${a}:`)).map(([, value]) => value), write: async (a, r) => { data.set(`${a}:${r.run.id}`, structuredClone(r)); }, remove: async (a, id) => { data.delete(`${a}:${id}`); } };
  const store = createDiagnosticStore(storage); await store.activate('owner');
  const h = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ ...actual, diagnostics: { beginGenerationDiagnostics: diagnosticThrows ? () => null : (...args: any[]) => store.begin(args[0], args[1], args[2], args[3], args[4]) } })({ eventId: 'A', rows: { A: { id: 'A', inputs: { songs: [{ artist: 'Synthetic private client', song: 'PRIVATE title' }], hours: '1', buffer: 1, listType: 'dance', expand: false }, lists: { warmUp: [], transition: [], peak: [], selections: {} } } }, services: { enrich } });
  await h.flush(); return { h, store, data };
}
afterEach(() => vi.useRealTimers());
it('actual handled metadata failure/shortfall notices persist with safe copy and no diagnostic event save', async () => {
  vi.useFakeTimers(); const { h, store } = await setup(async () => { throw Error('PRIVATE raw token /path'); });
  expect(h.requests).toEqual([]); await h.current.generate(); await h.flush(); await store.settled();
  const run = store.get().rows[0].run;
  expect(h.warnings.join(' ')).toMatch(/online music data|usable/i);
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
it('diagnostics unavailable cannot change route result, recommendation choices or save contract', async () => {
  vi.useFakeTimers(); const { h, store } = await setup(async () => ({ results: [] }), true);
  await h.current.generate(); await h.flush(); expect(h.current.result.warmUp).toHaveLength(1); expect(store.get().rows).toEqual([]); h.unmount();
});