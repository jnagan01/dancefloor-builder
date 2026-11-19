/** Per-invocation provider lanes. Never claim an isolate-local limiter is a global IP quota. */
import { boundedPressure, MAX_PROVIDER_COOLDOWN_MS, type ProviderPressure } from './providerPacing';
export const ENRICH_PROVIDER_CONCURRENCY = { recco: 4, musicBrainz: 1 } as const;
export const MUSICBRAINZ_GROUP = 8;
export const MUSICBRAINZ_INTERVAL_MS = 1_000;

export function retryAfterMs(value: string | null, now: number): number | undefined {
  const seconds = value && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = value && /[a-z]/i.test(value) ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function createProviderLane(now: () => number, until: number, signal: AbortSignal, intervalMs = 0, initial?: ProviderPressure) {
  let nextStart = 0;
  const carried = boundedPressure(initial);
  let pausedUntil = now() + carried.cooldownMs;
  let pressure = carried.pressure, healthy = 0;
  let blocked = false;
  const failure = (hint?: number) => {
    pressure = Math.min(6, pressure + 1); healthy = 0;
    pausedUntil = Math.max(pausedUntil, now() + Math.max(hint ?? 0,Math.min(32_000, 1000 * 2 ** (pressure - 1))));
  };
  return {
    get pausedUntil() { return blocked ? until : pausedUntil; },
    snapshot() { return { pressure, cooldownMs: Math.min(MAX_PROVIDER_COOLDOWN_MS, Math.max(0, pausedUntil - now(), nextStart - now())) }; },
    networkFailure() { if (!signal.aborted && now() < until) failure(); },
    async ready() {
      if (blocked || signal.aborted) return false;
      // Another in-flight response can extend the lane cooldown while this worker sleeps.
      // Recompute after every wake; old reservations must never bypass new rate pressure.
      for (;;) {
        if (blocked || signal.aborted || now() >= until) return false;
        const waitUntil = Math.max(nextStart, pausedUntil);
        if (waitUntil >= until) return false;
        const ms = Math.max(0, waitUntil - now());
        if (!ms) break;
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, ms);
          signal.addEventListener('abort', finish, { once: true });
        });
      }
      if (signal.aborted || now() >= until || blocked) return false;
      // Slow only a pressured provider's recovery starts; no guessed healthy/global quota.
      nextStart = now() + Math.max(intervalMs, pressure ? Math.min(2000, 250 * pressure) : 0);
      return true;
    },
    response(res: Response, startedAt=now()) {
      if(signal.aborted||now()>=until)return;
      if (res.status === 429 || res.status >= 500) {
        // No replay of the failed recording. Pause the entire provider lane before new work.
        failure(retryAfterMs(res.headers.get('retry-after'), now()));
      } else if (res.status === 401 || res.status === 403) blocked = true;
      else if (res.ok && startedAt>=pausedUntil && ++healthy >= 4) { pressure = Math.max(0, pressure - 1); healthy = 0; }
    },
  };
}