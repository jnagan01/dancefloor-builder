/**
 * Per-generation, bounded metadata gathering for candidate ranking.
 *
 * - Every candidate (owned, AI, catalogue) that lacks facts the ranking needs is looked up BEFORE strict eligibility,
 *   rankPool and energy ordering, so rankWhy and the displayed facts come from the same evidence.
 * - Lookups go out in deterministic chunks of at most `batchSize` (the server limit, 200), with bounded concurrency and a
 *   total per-generation request budget. Songs beyond the budget are NOT looked up: they stay unknown and are counted.
 * - Each exact "artist||song" key is attempted at most once per generation, including misses and failures, so a later
 *   pass never re-requests a known-attempted result.
 * - Each chunk has a deadline (`timeoutMs`). A late result/rejection is ignored; after a timeout no further chunks are
 *   sent this generation (the transport can't abort), and unsent songs are reported as skippedAfterTimeout.
 * - A failed/timed-out chunk leaves its songs unknown (never fabricated) and is reported via `failed`.
 */
export interface FactsRow { artist: string; song: string; energy?: number | null; danceability?: number | null; popularity?: number | null }
export interface GatherOptions<E = unknown> { batchSize?: number; concurrency?: number; budget?: number; timeoutMs?: number; isIncomplete?: (e: E) => boolean }
/** timedOutSongs ⊆ failedSongs. skippedAfterTimeout: songs whose chunks were never sent because an earlier chunk timed
 *  out (the transport can't abort, so we stop adding in-flight requests); they are NOT marked attempted. */
export interface GatherReport { requested: number; found: number; failedSongs: number; timedOutSongs: number; skippedAfterTimeout: number; skippedByBudget: number; alreadyAttempted: number; incompleteSongs: number }
/** incompleteSongs: returned in time, but the server reported its online lookup unfinished (only already-known values kept). */

export const FACTS_BATCH = 200;
export const FACTS_CONCURRENCY = 2;
/** Max distinct songs looked up per generation (3 server requests). Pool cap is 2000; the rest stay unknown. */
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
  const batchSize = Math.max(1, Math.min(FACTS_BATCH, opts.batchSize ?? FACTS_BATCH));
  const concurrency = Math.max(1, opts.concurrency ?? FACTS_CONCURRENCY);
  let budgetLeft = Math.max(0, opts.budget ?? FACTS_BUDGET);
  const attempted = new Set<string>();
  const results = new Map<string, E>();
  const timeoutMs = Math.max(1, opts.timeoutMs ?? FACTS_TIMEOUT_MS);
  let anyFailure = false;
  let timedOut = false; // sticky per generation: never schedule more requests behind an un-abortable hung one

  /** Rows are looked up in the given order (callers pass a deterministic order); duplicates collapse to one key. */
  async function gather(rows: Array<{ artist: string; song: string }>): Promise<GatherReport> {
    const report: GatherReport = { requested: 0, found: 0, failedSongs: 0, timedOutSongs: 0, skippedAfterTimeout: 0, skippedByBudget: 0, alreadyAttempted: 0, incompleteSongs: 0 };
    const todo: Array<{ artist: string; song: string }> = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const k = factsKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      if (attempted.has(k)) { report.alreadyAttempted++; continue; }
      if (timedOut) { report.skippedAfterTimeout++; continue; }
      if (budgetLeft <= 0) { report.skippedByBudget++; continue; }
      budgetLeft--; attempted.add(k); todo.push({ artist: r.artist, song: r.song });
    }
    report.requested = todo.length;
    const chunks: Array<typeof todo> = [];
    for (let i = 0; i < todo.length; i += batchSize) chunks.push(todo.slice(i, i + batchSize));
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++]!;
        if (timedOut) {
          // Not sent: release the keys/budget so they read as never attempted rather than as a known miss.
          for (const c of chunk) { attempted.delete(factsKey(c)); budgetLeft++; }
          report.requested -= chunk.length; report.skippedAfterTimeout += chunk.length;
          continue;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const call = Promise.resolve().then(() => fetchChunk(chunk));
          call.catch(() => {}); // a late rejection after the deadline must never become unhandled
          const deadline = new Promise<typeof TIMEOUT>((res) => { timer = setTimeout(() => res(TIMEOUT), timeoutMs); });
          const got = await Promise.race([call, deadline]);
          if (got === TIMEOUT) { timedOut = true; anyFailure = true; report.failedSongs += chunk.length; report.timedOutSongs += chunk.length; continue; }
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
  return { gather, get: (r: { artist: string; song: string }) => results.get(factsKey(r)), wasAttempted: (r: { artist: string; song: string }) => attempted.has(factsKey(r)), get anyFailure() { return anyFailure; } };
}
