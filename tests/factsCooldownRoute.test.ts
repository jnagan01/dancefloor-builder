import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { createFactsGatherer, factsKey } from '@/lib/prep/factsGather';

const require = createRequire(import.meta.url);
const harness = (options: any) => require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions })(options);
const songs = Array.from({ length: 16 }, (_, i) => ({ artist: `TEST ONLY Artist ${i}`, song: `Request ${i}`, fromUpload: true }));
const row = { id: 'A', name: 'Synthetic cooldown', updated_at: 'v1', inputs: { songs, hours: '1', buffer: 1, listType: 'dance', expand: false }, lists: { warmUp: songs, transition: [], peak: [] } };
afterEach(() => vi.useRealTimers());

describe('production event route cooldown dispatch', () => {
  for (const cooldown of [2_000, 30_000, 120_000]) {
    it(`Retry-After ${cooldown}ms waits before RPC cutoff and never sends abandoned work`, async () => {
      vi.useFakeTimers(); const start = Date.now(); const starts: number[] = []; let live = 0, peak = 0;
      const h = harness({ rows: { A: row }, services: { enrich: async (req: any) => {
        starts.push(Date.now() - start); live++; peak = Math.max(peak, live);
        await new Promise(r => setTimeout(r, 10)); live--;
        return { results: req.data.songs.map((s: any) => ({ ...s, energy: 8, danceability: 8, source: 'ReccoBeats', prov: { energy: 'provider', danceability: 'provider' } })), status: { retryAfterMs: cooldown } };
      } } });
      await h.flush(); const gen = h.current.generate();
      await vi.advanceTimersByTimeAsync(150_000); await gen; await h.flush();
      expect(starts).toEqual(cooldown < 90_000 ? [0, cooldown + 10] : [0]);
      expect(peak).toBe(1);
      const selected = [...h.current.result.warmUp, ...h.current.result.transition, ...h.current.result.peak];
      expect(selected.filter((s: any) => s.fromUpload)).toHaveLength(16);
      expect(selected.filter((s: any) => s.energy === 8)).toHaveLength(cooldown < 90_000 ? 16 : 8);
      await vi.advanceTimersByTimeAsync(150_000); expect(starts.length).toBe(cooldown < 90_000 ? 2 : 1);
      h.unmount();
    });
  }
  for (const change of ['event', 'account']) {
    it(`stale ${change} during cooldown sends no second request or stale warning`, async () => {
      vi.useFakeTimers(); const send = vi.fn(async (req: any) => ({ results: req.data.songs.map((s: any) => ({ ...s, energy: 8, source: 'cache' })), status: { retryAfterMs: 30_000 } }));
      const h = harness({ rows: { A: row, B: { ...row, id: 'B' } }, services: { enrich: send } });
      await h.flush(); const gen = h.current.generate(); await vi.advanceTimersByTimeAsync(1_000);
      expect(send).toHaveBeenCalledTimes(1);
      h.switchTo(change === 'account' ? 'other' : 'owner', change === 'event' ? 'B' : 'A'); await h.flush();
      await vi.advanceTimersByTimeAsync(100_000); await gen; await h.flush();
      expect(send).toHaveBeenCalledTimes(1); expect(h.warnings).toEqual([]); expect(h.infos).toEqual([]);
      h.unmount();
    });
  }
});

describe('unsent cooldown accounting', () => {
  it('over-overall cooldown never marks or spends unsent songs, including later gathers', async () => {
    vi.useFakeTimers(); let readyAt = 0;
    const send = vi.fn(async (chunk: typeof songs) => { readyAt = Date.now() + 120_000; return chunk; });
    const g = createFactsGatherer(send, factsKey, { readyAt: () => readyAt, budget: 16, concurrency: 2 });
    const report = await g.gather(songs);
    expect(report).toMatchObject({ requested: 8, found: 8, failedSongs: 0, timedOutSongs: 0, skippedAfterTimeout: 8, skippedByBudget: 0 });
    expect(g.wasAttempted(songs[8])).toBe(false);
    expect(await g.gather(songs.slice(8))).toMatchObject({ requested: 0, alreadyAttempted: 0, skippedAfterTimeout: 8, skippedByBudget: 0 });
    await vi.advanceTimersByTimeAsync(150_000); expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancelled wait releases unsent accounting; concurrent gather callers do not overlap', async () => {
    vi.useFakeTimers(); let current = true; let readyAt = 0; let live = 0, peak = 0;
    const send = vi.fn(async (chunk: typeof songs) => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 10)); live--; readyAt = Date.now() + 30_000; return chunk; });
    const g = createFactsGatherer(send, factsKey, { readyAt: () => readyAt, isCurrent: () => current, budget: 16, concurrency: 2 });
    const first = g.gather(songs); const second = g.gather(songs);
    await vi.advanceTimersByTimeAsync(1_000); current = false; await vi.advanceTimersByTimeAsync(100);
    expect(await first).toMatchObject({ requested: 8, found: 8, skippedCancelled: 8, failedSongs: 0 });
    expect(await second).toMatchObject({ requested: 0, alreadyAttempted: 8, skippedCancelled: 8 });
    expect(g.wasAttempted(songs[8])).toBe(false); expect(peak).toBe(1); expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});