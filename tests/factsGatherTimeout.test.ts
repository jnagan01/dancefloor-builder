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
    const pending2 = g.gather([...songs(2), { artist: 'B', song: 'X' }]);
    await vi.advanceTimersByTimeAsync(90_000);
    const rep2 = await pending2;
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

describe('settled transport recovery without replay', () => {
  it.each(['resolve', 'reject'] as const)('25s first request %s releases a fresh phase, not its late payload', async outcome => {
    vi.useFakeTimers(); const first = deferred(); let calls = 0;
    const g = createFactsGatherer<E>(async chunk => ++calls === 1 ? first.p : chunk.map(s => ({ ...s, energy: 7 })), factsKey, { budget: 600 });
    const initial = g.gather(songs(8)); await vi.advanceTimersByTimeAsync(20_000);
    expect(await initial).toMatchObject({ requested: 8, timedOutSongs: 8, found: 0 });
    expect(g.remainingBudget).toBe(592);
    g.beginPhase(Date.now() + 90_000);
    const next = g.gather(songs(16)); await vi.advanceTimersByTimeAsync(4999); expect(calls).toBe(1);
    if (outcome === 'resolve') first.resolve(songs(8).map(s => ({ ...s, energy: 9 }))); else first.reject(new Error('synthetic late rejection'));
    await vi.advanceTimersByTimeAsync(101);
    expect(await next).toMatchObject({ requested: 8, alreadyAttempted: 8, found: 8, timedOutSongs: 0 });
    expect(calls).toBe(2); expect(g.remainingBudget).toBe(584); expect(g.anyFailure).toBe(true);
    for (const s of songs(8)) expect(g.get(s)).toBeUndefined();
    expect(g.get(songs(16)[8])?.energy).toBe(7); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['phase', 'cancel'] as const)('unresolved transport recovery stops at %s with no delayed dispatch', async stop => {
    vi.useFakeTimers(); const first = deferred(); let current = true;
    const send = vi.fn(() => first.p);
    const g = createFactsGatherer<E>(send, factsKey, { timeoutMs: 100, isCurrent: () => current });
    const initial = g.gather(songs(1)); await vi.advanceTimersByTimeAsync(100); await initial;
    g.beginPhase(Date.now() + 500); const waiting = g.gather(songs(2));
    await vi.advanceTimersByTimeAsync(200); if (stop === 'cancel') current = false;
    await vi.advanceTimersByTimeAsync(300); const report = await waiting;
    expect(report.requested).toBe(0); expect(stop === 'cancel' ? report.skippedCancelled : report.skippedAfterTimeout).toBe(1);
    first.resolve(songs(1).map(s => ({ ...s, energy: 9 }))); await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(1); expect(g.get(songs(1)[0])).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  });

  it('two timed-out workers must both settle before any new request, including a late rejection', async () => {
    vi.useFakeTimers(); const a = deferred(), b = deferred(); let calls = 0, inFlight = 0, peak = 0;
    const g = createFactsGatherer<E>(chunk => {
      calls++; inFlight++; peak = Math.max(peak, inFlight);
      const p = calls === 1 ? a.p : calls === 2 ? b.p : Promise.resolve(chunk.map(s => ({ ...s, energy: 7 })));
      return p.finally(() => { inFlight--; });
    }, factsKey, { batchSize: 1, concurrency: 2, timeoutMs: 100 });
    const first = g.gather(songs(4)); await vi.advanceTimersByTimeAsync(100);
    expect(await first).toMatchObject({ requested: 2, timedOutSongs: 2, skippedAfterTimeout: 2 });
    const next = g.gather(songs(4)); a.resolve([]); await vi.advanceTimersByTimeAsync(200); expect(calls).toBe(2);
    b.reject(new Error('synthetic late rejection')); await vi.advanceTimersByTimeAsync(100);
    expect(await next).toMatchObject({ requested: 2, found: 2, alreadyAttempted: 2, timedOutSongs: 0 });
    expect(peak).toBe(2); expect(g.get(songs(1)[0])).toBeUndefined(); expect(inFlight).toBe(0);
  });

  it.each([99, 100, 101])('settlement at %sms races a 100ms cutoff without replay or late metadata side effects', async delay => {
    vi.useFakeTimers(); const applied: number[] = []; let calls = 0;
    const g = createFactsGatherer<E>(async (chunk, accepts) => {
      const n = ++calls; if (n === 1) await new Promise(r => setTimeout(r, delay));
      if (accepts()) applied.push(n); return chunk.map(s => ({ ...s, energy: n }));
    }, factsKey, { timeoutMs: 100 });
    const initial = g.gather(songs(1)); await vi.advanceTimersByTimeAsync(102); const report = await initial;
    const next = await g.gather(songs(2)); expect(next).toMatchObject({ requested: 1, alreadyAttempted: 1, found: 1 });
    expect(calls).toBe(2); expect(g.get(songs(1)[0])?.energy).toBe(report.timedOutSongs ? undefined : 1);
    expect(applied).toEqual(report.timedOutSongs ? [2] : [1, 2]); expect(vi.getTimerCount()).toBe(0);
  });

  it('account cancellation during recovery wait cannot dispatch or admit late facts into either owner', async () => {
    vi.useFakeTimers(); let owner = 'A'; const first = deferred(), applied = vi.fn();
    const send = vi.fn(async (chunk: Array<{ artist: string; song: string }>, accepts: () => boolean) => {
      const out = await first.p; if (accepts()) applied(); return out;
    });
    const a = createFactsGatherer<E>(send, factsKey, { timeoutMs: 100, isCurrent: () => owner === 'A' });
    const initial = a.gather(songs(1)); await vi.advanceTimersByTimeAsync(100); await initial;
    const waiting = a.gather(songs(2)); owner = 'B'; await vi.advanceTimersByTimeAsync(100);
    expect(await waiting).toMatchObject({ requested: 0, skippedCancelled: 1 });
    const b = createFactsGatherer<E>(async chunk => chunk.map(s => ({ ...s, energy: 7 })), factsKey, { isCurrent: () => owner === 'B' });
    await b.gather(songs(1)); first.resolve(songs(1).map(s => ({ ...s, energy: 9 }))); await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1); expect(applied).not.toHaveBeenCalled(); expect(a.get(songs(1)[0])).toBeUndefined();
    expect(b.get(songs(1)[0])?.energy).toBe(7); expect(vi.getTimerCount()).toBe(0);
  });
});
