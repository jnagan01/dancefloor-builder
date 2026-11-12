/**
 * Per-generation, bounded metadata gathering for candidate ranking.
 *
 * - Every candidate (owned, AI, catalogue) that lacks facts the ranking needs is looked up BEFORE strict eligibility,
 *   rankPool and energy ordering, so rankWhy and the displayed facts come from the same evidence.
 * - Lookups go out in deterministic small chunks (default eight, RPC maximum 200), with bounded concurrency and a
 *   total per-generation request budget. Songs beyond the budget are NOT looked up: they stay unknown and are counted.
 * - Each exact "artist||song" key is attempted at most once per generation, including misses and failures, so a later
 *   pass never re-requests a known-attempted result.
 * - Each chunk has a deadline (`timeoutMs`). A late result/rejection is ignored; after a timeout no further chunks are
 *   sent this generation (the transport can't abort), and unsent songs are reported as skippedAfterTimeout.
 * - A failed/timed-out chunk leaves its songs unknown (never fabricated) and is reported via `failed`.
 */
export interface FactsRow { artist: string; song: string; energy?: number | null; danceability?: number | null; popularity?: number | null }
export interface GatherOptions<E = unknown> { batchSize?: number; concurrency?: number; budget?: number; timeoutMs?: number; overallMs?: number; intervalMs?: number; readyAt?: () => number; minDispatchMs?: () => number; isCurrent?: () => boolean; isIncomplete?: (e: E) => boolean }
/** timedOutSongs ⊆ failedSongs. skippedAfterTimeout: unsent songs blocked by a deadline/cooldown.
 * skippedCancelled: unsent songs blocked by a stale generation/account. Neither spends budget or marks attempts. */
export interface GatherReport { requested: number; found: number; failedSongs: number; timedOutSongs: number; skippedAfterTimeout: number; skippedCancelled: number; skippedByBudget: number; alreadyAttempted: number; incompleteSongs: number }
/** incompleteSongs: returned in time, but the server reported its online lookup unfinished (only already-known values kept). */

export const FACTS_BATCH = 8;
export const FACTS_CONCURRENCY = 1;
/** Max distinct candidate songs looked up per generation. Pool cap is 2000; the rest stay unknown. */
export const FACTS_BUDGET = 600;
/** Per-chunk deadline. A chunk that hasn't settled by then counts as failed; its late result is ignored. */
export const FACTS_TIMEOUT_MS = 20_000;
/** The server's end-to-end deadline (cache read + provider + AI + cache write + assembly). It stays a fixed margin below
 *  the client cutoff so completed results, cache hits included, arrive before the client gives up on the chunk. */
export const ENRICH_SERVER_DEADLINE_MS = 16_000;
export const ENRICH_CLIENT_MARGIN_MS = FACTS_TIMEOUT_MS - ENRICH_SERVER_DEADLINE_MS;
const TIMEOUT = Symbol("timeout");

export const factsKey = (r: { artist: string; song: string }) => `${r.artist}||${r.song}`;

/** Facts the active ranking can use: energy + danceability always (fit + energy ordering); track popularity only when a
 *  familiarity choice is active. */
export function needsFacts(r: FactsRow, familiarityActive: boolean): boolean {
  return r.energy == null || r.danceability == null || (familiarityActive && r.popularity == null);
}

export function createFactsGatherer<E>(fetchChunk: (songs: Array<{ artist: string; song: string }>) => Promise<E[]>, keyOf: (e: E) => string, opts: GatherOptions<E> = {}) {
  const batchSize = Math.max(1, Math.min(200, opts.batchSize ?? FACTS_BATCH));
  // A dynamic cooldown belongs to the previous response: never overlap its dispatches.
  const concurrency = opts.readyAt ? 1 : Math.max(1, Math.min(2, opts.concurrency ?? FACTS_CONCURRENCY));
  let budgetLeft = Math.max(0, opts.budget ?? FACTS_BUDGET);
  const attempted = new Set<string>();
  const results = new Map<string, E>();
  const timeoutMs = Math.max(1, opts.timeoutMs ?? FACTS_TIMEOUT_MS);
  const overallMs = Math.max(1, opts.overallMs ?? 90_000);
  let end = Infinity, nextStart = 0;
  let anyFailure = false;
  let timedOut = false; // sticky per generation: never schedule more requests behind an un-abortable hung one

  /** Rows are looked up in the given order (callers pass a deterministic order); duplicates collapse to one key. */
  async function runGather(rows: Array<{ artist: string; song: string }>): Promise<GatherReport> {
    if (end === Infinity) end = Date.now() + overallMs;
    const report: GatherReport = { requested: 0, found: 0, failedSongs: 0, timedOutSongs: 0, skippedAfterTimeout: 0, skippedCancelled: 0, skippedByBudget: 0, alreadyAttempted: 0, incompleteSongs: 0 };
    const todo: Array<{ artist: string; song: string }> = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const k = factsKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      if (attempted.has(k)) { report.alreadyAttempted++; continue; }
      if (opts.isCurrent?.() === false) { report.skippedCancelled++; continue; }
      if (timedOut || Date.now() >= end) { report.skippedAfterTimeout++; continue; }
      if (todo.length >= budgetLeft) { report.skippedByBudget++; continue; }
      todo.push({ artist: r.artist, song: r.song });
    }
    const chunks: Array<typeof todo> = [];
    for (let i = 0; i < todo.length; i += batchSize) chunks.push(todo.slice(i, i + batchSize));
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        if (!chunk) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // Cooldown is pre-dispatch, outside the RPC deadline. Poll the current fence during
          // waits; an out-of-budget cooldown has no pending callback that can later send.
          while (!timedOut && Date.now() < end && opts.isCurrent?.() !== false) {
            const ready = Math.max(nextStart, opts.readyAt?.() ?? 0);
            if (ready <= Date.now() || ready >= end) break;
            await new Promise(resolve => setTimeout(resolve, Math.min(100, ready - Date.now(), end - Date.now())));
          }
          if (opts.isCurrent?.() === false) { report.skippedCancelled += chunk.length; continue; }
          if (timedOut || Date.now() >= end || Math.max(nextStart, opts.readyAt?.() ?? 0) >= end || end - Date.now() < Math.max(0, opts.minDispatchMs?.() ?? 0)) {
            report.skippedAfterTimeout += chunk.length;
            continue;
          }
          nextStart = Date.now() + (opts.intervalMs ?? 0);
          // Only sent songs spend budget or become attempted, after the final fence check.
          budgetLeft -= chunk.length;
          for (const c of chunk) attempted.add(factsKey(c));
          report.requested += chunk.length;
          const call = Promise.resolve(fetchChunk(chunk));
          call.catch(() => {}); // a late rejection after the deadline must never become unhandled
          const deadline = new Promise<typeof TIMEOUT>((res) => { timer = setTimeout(() => res(TIMEOUT), Math.min(timeoutMs, Math.max(1, end - Date.now()))); });
          const got = await Promise.race([call, deadline]);
          if (got === TIMEOUT) { timedOut = true; anyFailure = true; report.failedSongs += chunk.length; report.timedOutSongs += chunk.length; continue; }
          if (opts.isCurrent?.() === false) continue;
          const want = new Set(chunk.map(factsKey));
          for (const e of got) { const k = keyOf(e); if (want.has(k) && !results.has(k)) { results.set(k, e); report.found++; if (opts.isIncomplete?.(e)) report.incompleteSongs++; } }
        } catch {
          anyFailure = true; report.failedSongs += chunk.length;
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
    return report;
  }
  // Concurrent callers share one generation budget and cannot create overlapping runs.
  let previous: Promise<unknown> = Promise.resolve();
  function gather(rows: Array<{ artist: string; song: string }>): Promise<GatherReport> {
    const pending = previous.then(() => runGather(rows));
    previous = pending.catch(() => {});
    return pending;
  }
  return { gather, get: (r: { artist: string; song: string }) => results.get(factsKey(r)), wasAttempted: (r: { artist: string; song: string }) => attempted.has(factsKey(r)), get anyFailure() { return anyFailure; } };
}
