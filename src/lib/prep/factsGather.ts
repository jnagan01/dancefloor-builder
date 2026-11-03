/**
 * Per-generation, bounded metadata gathering for candidate ranking.
 *
 * - Every candidate (owned, AI, catalogue) that lacks facts the ranking needs is looked up BEFORE strict eligibility,
 *   rankPool and energy ordering, so rankWhy and the displayed facts come from the same evidence.
 * - Lookups go out in deterministic chunks of at most `batchSize` (the server limit, 200), with bounded concurrency and a
 *   total per-generation request budget. Songs beyond the budget are NOT looked up: they stay unknown and are counted.
 * - Each exact "artist||song" key is attempted at most once per generation, including misses and failures, so a later
 *   pass never re-requests a known-attempted result.
 * - A failed/timed-out chunk leaves its songs unknown (never fabricated) and is reported via `failed`.
 */
export interface FactsRow { artist: string; song: string; energy?: number | null; danceability?: number | null; popularity?: number | null }
export interface GatherOptions { batchSize?: number; concurrency?: number; budget?: number }
export interface GatherReport { requested: number; found: number; failedSongs: number; skippedByBudget: number; alreadyAttempted: number }

export const FACTS_BATCH = 200;
export const FACTS_CONCURRENCY = 2;
/** Max distinct songs looked up per generation (3 server requests). Pool cap is 2000; the rest stay unknown. */
export const FACTS_BUDGET = 600;

export const factsKey = (r: { artist: string; song: string }) => `${r.artist}||${r.song}`;

/** Facts the active ranking can use: energy + danceability always (fit + energy ordering); track popularity only when a
 *  familiarity choice is active. */
export function needsFacts(r: FactsRow, familiarityActive: boolean): boolean {
  return r.energy == null || r.danceability == null || (familiarityActive && r.popularity == null);
}

export function createFactsGatherer<E>(fetchChunk: (songs: Array<{ artist: string; song: string }>) => Promise<E[]>, keyOf: (e: E) => string, opts: GatherOptions = {}) {
  const batchSize = Math.max(1, Math.min(FACTS_BATCH, opts.batchSize ?? FACTS_BATCH));
  const concurrency = Math.max(1, opts.concurrency ?? FACTS_CONCURRENCY);
  let budgetLeft = Math.max(0, opts.budget ?? FACTS_BUDGET);
  const attempted = new Set<string>();
  const results = new Map<string, E>();
  let anyFailure = false;

  /** Rows are looked up in the given order (callers pass a deterministic order); duplicates collapse to one key. */
  async function gather(rows: Array<{ artist: string; song: string }>): Promise<GatherReport> {
    const report: GatherReport = { requested: 0, found: 0, failedSongs: 0, skippedByBudget: 0, alreadyAttempted: 0 };
    const todo: Array<{ artist: string; song: string }> = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const k = factsKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      if (attempted.has(k)) { report.alreadyAttempted++; continue; }
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
        try {
          const got = await fetchChunk(chunk);
          const want = new Set(chunk.map(factsKey));
          for (const e of got) { const k = keyOf(e); if (want.has(k) && !results.has(k)) { results.set(k, e); report.found++; } }
        } catch {
          anyFailure = true; report.failedSongs += chunk.length;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
    return report;
  }
  return { gather, get: (r: { artist: string; song: string }) => results.get(factsKey(r)), wasAttempted: (r: { artist: string; song: string }) => attempted.has(factsKey(r)), get anyFailure() { return anyFailure; } };
}
