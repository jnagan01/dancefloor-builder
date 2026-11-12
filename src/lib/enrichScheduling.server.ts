/** Per-invocation provider lanes. Never claim an isolate-local limiter is a global IP quota. */
export const ENRICH_PROVIDER_CONCURRENCY = { recco: 4, musicBrainz: 1 } as const;
export const MUSICBRAINZ_GROUP = 8;
export const MUSICBRAINZ_INTERVAL_MS = 1_000;

export function retryAfterMs(value: string | null, now: number): number {
  const seconds = value === null ? NaN : Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = value ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? Math.max(0, date - now) : 1_000;
}

export function createProviderLane(now: () => number, until: number, signal: AbortSignal, intervalMs = 0) {
  let nextStart = 0;
  let pausedUntil = 0;
  let blocked = false;
  return {
    get pausedUntil() { return blocked ? until : pausedUntil; },
    async ready() {
      if (blocked || signal.aborted) return false;
      const waitUntil = Math.max(nextStart, pausedUntil);
      if (waitUntil >= until) return false;
      const ms = Math.max(0, waitUntil - now());
      if (ms) await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, ms);
        signal.addEventListener('abort', finish, { once: true });
      });
      if (signal.aborted || now() >= until || blocked) return false;
      nextStart = now() + intervalMs;
      return true;
    },
    response(res: Response) {
      if (res.status === 429 || res.status >= 500) {
        // No replay of the failed recording. Pause the entire provider lane before new work.
        pausedUntil = Math.max(pausedUntil, now() + retryAfterMs(res.headers.get('retry-after'), now()));
      } else if (res.status === 401 || res.status === 403) blocked = true;
    },
  };
}