import { describe, it, expect, vi, afterEach } from 'vitest';
import { createFactsGatherer, factsKey } from '@/lib/prep/factsGather';

type E = { artist: string; song: string; energy: number };
const songs = (n: number) => Array.from({ length: n }, (_, i) => ({ artist: 'A', song: `S${i}` }));
const deferred = () => { let resolve!: (v: E[]) => void, reject!: (e: unknown) => void; const p = new Promise<E[]>((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

afterEach(() => { vi.useRealTimers(); });

describe('factsGather per-chunk deadline', () => {
  it('a never-resolving request times out, stays unknown, and clears its timer', async () => {
    vi.useFakeTimers();
    const g = createFactsGatherer<E>(() => new Promise(() => {}), factsKey, { timeoutMs: 1000 });
    const run = g.gather(songs(3));
    await vi.advanceTimersByTimeAsync(999);
    let done = false; run.then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const rep = await run;
    expect(rep).toMatchObject({ requested: 3, found: 0, failedSongs: 3, timedOutSongs: 3 });
    expect(g.get(songs(1)[0])).toBeUndefined();
    expect(g.anyFailure).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('late success after the deadline cannot mutate results', async () => {
    vi.useFakeTimers();
    const d = deferred();
    const g = createFactsGatherer<E>(() => d.p, factsKey, { timeoutMs: 500 });
    const run = g.gather(songs(2));
    await vi.advanceTimersByTimeAsync(500);
    await run;
    d.resolve(songs(2).map((s) => ({ ...s, energy: 9 })));
    await vi.advanceTimersByTimeAsync(10);
    expect(g.get(songs(2)[0])).toBeUndefined();
    expect(g.get(songs(2)[1])).toBeUndefined();
  });

  it('late rejection is swallowed (no unhandled rejection)', async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const d = deferred();
    const g = createFactsGatherer<E>(() => d.p, factsKey, { timeoutMs: 100 });
    const run = g.gather(songs(1));
    await vi.advanceTimersByTimeAsync(100);
    await run;
    d.reject(new Error('late'));
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 5));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('no retry: timed-out songs are attempted once; later gathers stop sending new requests', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise<E[]>(() => {}));
    const g = createFactsGatherer<E>(fetch, factsKey, { timeoutMs: 100, batchSize: 2, concurrency: 1, budget: 100 });
    const run = g.gather(songs(6)); // 3 chunks
    await vi.advanceTimersByTimeAsync(100);
    const rep = await run;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rep).toMatchObject({ requested: 2, timedOutSongs: 2, failedSongs: 2, skippedAfterTimeout: 4 });
    expect(g.wasAttempted({ artist: 'A', song: 'S0' })).toBe(true);
    expect(g.wasAttempted({ artist: 'A', song: 'S5' })).toBe(false);
    const rep2 = await g.gather([...songs(2), { artist: 'B', song: 'X' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rep2).toMatchObject({ requested: 0, alreadyAttempted: 2, skippedAfterTimeout: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('concurrency bounded; a timeout in one worker stops further scheduling and late in-flight results are ignored', async () => {
    vi.useFakeTimers();
    const ok = deferred();
    let calls = 0, inFlight = 0, peak = 0;
    const fetch = vi.fn((c: Array<{ artist: string; song: string }>) => {
      calls++; inFlight++; peak = Math.max(peak, inFlight);
      const p = calls === 1 ? new Promise<E[]>(() => {}) : ok.p.then(() => c.map((s) => ({ ...s, energy: 5 })));
      return p.finally(() => { inFlight--; });
    });
    const g = createFactsGatherer<E>(fetch, factsKey, { timeoutMs: 100, batchSize: 1, concurrency: 2 });
    const run = g.gather(songs(5));
    await vi.advanceTimersByTimeAsync(100); // both in-flight chunks reach their deadline together
    const rep = await run;
    ok.resolve([]); // chunk 2's late answer is ignored
    await vi.advanceTimersByTimeAsync(10);
    expect(rep.found).toBe(0);
    expect(g.get({ artist: 'A', song: 'S1' })).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(peak).toBeLessThanOrEqual(2);
    expect(rep.timedOutSongs).toBe(2);
    expect(rep.found + rep.failedSongs + rep.skippedAfterTimeout).toBe(5);
    expect(rep.skippedAfterTimeout).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fast responses are unaffected by the deadline', async () => {
    const g = createFactsGatherer<E>(async (c) => c.map((s) => ({ ...s, energy: 7 })), factsKey, { timeoutMs: 1000, batchSize: 200 });
    const rep = await g.gather(songs(450));
    expect(rep).toMatchObject({ requested: 450, found: 450, failedSongs: 0, timedOutSongs: 0, skippedAfterTimeout: 0 });
  });
});
