import { CauseSchema, safeCount, type DiagnosticRun } from './schema';

const providerNames = { metadata: 'Online track details', reccobeats: 'ReccoBeats', musicbrainz: 'MusicBrainz', ai: 'Track estimates', lastfm: 'Optional community checks', suggestions: 'Track suggestions', cache: 'Track detail cache' };
const causeNames = {
  rate: 'rate limited; remaining checks were paced',
  server: 'temporary server failures; finished track details were kept',
  network: 'temporary network failures; finished track details were kept',
  deadline: 'actual lookup timeouts; finished track details were kept',
  paused: 'remaining checks paused by service pressure',
  denied: 'service access unavailable', http: 'unsuccessful service replies', malformed: 'unreadable service replies',
  missing: 'no catalogue match (not a service failure)', truncated: 'limited catalogue results', unavailable: 'service unavailable',
};
export function providerCauseMessages(causes: unknown): string[] {
  if (!Array.isArray(causes)) return [];
  return causes.flatMap(value => { const parsed = CauseSchema.safeParse(value); if (!parsed.success || !parsed.data.count) return [];
    const c = parsed.data; return [`${providerNames[c.provider]}: ${causeNames[c.cause]} (${c.count}).`]; });
}
export function preparationOutcome(run: Pick<DiagnosticRun, 'status' | 'coverage'>): string {
  if (run.status === 'running') return 'Preparation is still running; these are intermediate coverage totals.';
  if (run.status === 'cancelled' || run.status === 'interrupted' || run.status === 'failed') return 'No final preparation target result was confirmed.';
  const selected = run.coverage.filter(s => s.targetSeconds > 0);
  if (!selected.length) return 'Final preparation coverage was not recorded.';
  if (run.status === 'short' || selected.some(s => s.achievedSeconds < s.targetSeconds)) return 'Not all selected section preparation targets were reached.';
  if (run.coverage.length !== 3) return 'Final all-section preparation coverage was not recorded.';
  return 'All selected section preparation targets were reached.';
}
/** One bounded summary per generation, from fixed categories only; never raw provider errors. */
export function createMetadataWarnings() {
  const totals = new Map<string, { provider: 'reccobeats' | 'musicbrainz' | 'ai' | 'metadata'; cause: 'rate' | 'server' | 'network' | 'deadline' | 'denied' | 'http' | 'malformed' | 'unavailable'; count: number }>();
  let incomplete = 0, failed = 0, clientTimeouts = 0, phaseLimited = false;
  return {
    response(value: unknown, timedOut?: string[]) {
      let knownPressure = false, knownDeadline = false;
      if (value && typeof value === 'object') for (const provider of ['reccobeats', 'musicbrainz', 'ai'] as const) {
        const bucket = (value as Record<string, unknown>)[provider];
        if (!bucket || typeof bucket !== 'object') continue;
        for (const cause of ['rate', 'server', 'network', 'deadline', 'denied', 'http', 'malformed', 'unavailable'] as const) {
          const count = safeCount((bucket as Record<string, unknown>)[cause]); if (!count) continue;
          if (cause === 'rate' || cause === 'server' || cause === 'network') knownPressure = true;
          if (cause === 'deadline') knownDeadline = true;
          const key = `${provider}:${cause}`, old = totals.get(key);
          totals.set(key, { provider, cause, count: safeCount((old?.count ?? 0) + count) });
        }
      }
      // A fetch phase can close while workers are parked by pressure: that is not a timed-out sent request.
      // Classify this reply alone; legacy phase limits do not confirm an in-flight request timeout.
      if (!knownDeadline && timedOut?.some(phase => phase !== 'fetch' || !knownPressure)) phaseLimited = true;
    },
    report(r: { incompleteSongs: number; failedSongs: number; timedOutSongs: number }) {
      incomplete += r.incompleteSongs; failed += r.failedSongs - r.timedOutSongs; clientTimeouts += r.timedOutSongs;
    },
    message(outcome: string) {
      const categories = [...new Set([...totals.values()].map(c => c.cause))];
      const parts: string[] = [];
      if (categories.includes('rate')) parts.push('Online track checks were rate limited; remaining checks were paced.');
      if (categories.includes('server') || categories.includes('network')) parts.push('Some online track checks had temporary server or network failures.');
      if (clientTimeouts || categories.includes('deadline')) parts.push('Some online track checks actually timed out.');
      if (phaseLimited) parts.push('Some online track checks could not finish within the available lookup time.');
      if (failed || categories.some(c => ['denied', 'http', 'malformed', 'unavailable'].includes(c))) parts.push('Some online track details could not be checked.');
      if (!parts.length && incomplete) parts.push('Some online track details remain unknown; no timeout was reported.');
      return parts.length ? `${parts.join(' ')} Finished details were kept; unknown details were not guessed. ${outcome} See Recent generation activity for known service causes.` : null;
    },
  };
}