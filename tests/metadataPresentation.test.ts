import { expect, it } from 'vitest';
import { createMetadataWarnings, preparationOutcome, providerCauseMessages } from '@/lib/generationDiagnostics/presentation';
import { copyDiagnostics, RunSchema } from '@/lib/generationDiagnostics/schema';
const coverage = [{ section: 'warmUp' as const, targetSeconds: 5400, achievedSeconds: 5400 }, { section: 'transition' as const, targetSeconds: 14400, achievedSeconds: 14400 }, { section: 'peak' as const, targetSeconds: 7200, achievedSeconds: 7200 }];
it('rate/server failures are distinct from actual timeouts; one bounded aggregate ignores private error data', () => {
  const warnings = createMetadataWarnings(); warnings.response({ reccobeats: { rate: 5, token: 'PRIVATE' }, musicbrainz: { server: 2 }, private: '/PRIVATE/path' });
  warnings.report({ incompleteSongs: 5, failedSongs: 0, timedOutSongs: 0 });
  const text = warnings.message('All selected section preparation targets were reached.');
  expect(text).toContain('rate limited'); expect(text).toContain('temporary server or network failures'); expect(text).not.toMatch(/timed out|PRIVATE|song/);
  warnings.response({ reccobeats: { deadline: 1 } }); expect(warnings.message('Short.')).toContain('actually timed out');
  expect(providerCauseMessages([{ provider: 'reccobeats', cause: 'rate', count: 5, token: 'PRIVATE' }, { provider: 'private', cause: 'server', count: 1 }])).toEqual(['ReccoBeats: rate limited; remaining checks were paced (5).']);
});
it('a provider phase closed while rate-parked is not described as an actual sent-request timeout', () => {
  const w = createMetadataWarnings(); w.response({ reccobeats: { rate: 3, paused: 4 } }, ['fetch']); w.report({ incompleteSongs: 8, failedSongs: 0, timedOutSongs: 0 });
  expect(w.message('')).toContain('rate limited'); expect(w.message('')).not.toMatch(/actually timed out|could not finish within the available lookup time/);
  w.response({ reccobeats: { deadline: 1 } }, ['fetch']); expect(w.message('')).toContain('actually timed out');
});
it.each(['rate', 'server'])('earlier %s pressure cannot hide a separate legacy fetch phase limit', cause => {
  const w = createMetadataWarnings();
  w.response({ reccobeats: { [cause]: 1 } });
  w.response(undefined, ['fetch']);
  const text = w.message('Not all selected section preparation targets were reached.');
  expect(text).toContain(cause === 'rate' ? 'rate limited' : 'temporary server or network failures');
  expect(text).toContain('Some online track checks could not finish within the available lookup time.');
  expect(text).not.toContain('actually timed out');
});
it('a current response with pressure and an explicit deadline retains the confirmed timeout', () => {
  const w = createMetadataWarnings();
  w.response({ reccobeats: { rate: 2 }, musicbrainz: { server: 1, deadline: 1 } }, ['fetch']);
  expect(w.message('')).toContain('rate limited');
  expect(w.message('')).toContain('temporary server or network failures');
  expect(w.message('')).toContain('actually timed out');
  expect(w.message('')).not.toContain('could not finish within the available lookup time');
});
it('unknown legacy incomplete details do not imply timeout, but client deadlines do', () => {
  const w = createMetadataWarnings(); w.report({ incompleteSongs: 5, failedSongs: 0, timedOutSongs: 0 }); expect(w.message('')).toContain('no timeout was reported');
  w.report({ incompleteSongs: 0, failedSongs: 1, timedOutSongs: 1 }); expect(w.message('')).toContain('actually timed out');
});
it('final complete targets require positive recorded coverage; running, missing and short totals never claim completeness', () => {
  expect(preparationOutcome({ status: 'completed', coverage })).toBe('All selected section preparation targets were reached.');
  expect(preparationOutcome({ status: 'completed', coverage: [] })).toBe('Final preparation coverage was not recorded.');
  expect(preparationOutcome({ status: 'completed', coverage: coverage.slice(0, 1) })).toBe('Final all-section preparation coverage was not recorded.');
  expect(preparationOutcome({ status: 'completed', coverage: coverage.map(s => ({ ...s, achievedSeconds: s.section === 'peak' ? 7199 : s.achievedSeconds })) })).toBe('Not all selected section preparation targets were reached.');
  expect(preparationOutcome({ status: 'running', coverage })).toContain('intermediate');
  expect(preparationOutcome({ status: 'short', coverage })).not.toMatch(/^All/);
});
it('new presentation retains schema v1 allowlist and private-field redaction in copy/relay payloads', () => {
  const run = RunSchema.parse({ schema: 1, id: '00000000-0000-4000-8000-000000000001', revision: 1, startedAt: 0, endedAt: 1, elapsedMs: 1, version: 'desktop:1.2.53', build: 'synthetic', status: 'warnings', requested: 34, notices: [{ code: 'metadata_incomplete', count: 5, eventName: 'PRIVATE' }], causes: [{ provider: 'musicbrainz', cause: 'server', count: 2, token: 'PRIVATE' }], coverage, filePath: '/PRIVATE/audio' });
  expect(copyDiagnostics(run)).not.toMatch(/PRIVATE|eventName|filePath|token/); expect(run.schema).toBe(1);
});