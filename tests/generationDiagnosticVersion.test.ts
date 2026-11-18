import { afterEach, expect, it, vi } from 'vitest';
import { APP_VERSION } from '@/lib/appVersion';
import { createDiagnosticVersion } from '@/lib/generationDiagnostics/version';
import { createDiagnosticStore } from '@/lib/generationDiagnostics/store';
import { BatchSchema, copyDiagnostics } from '@/lib/generationDiagnostics/schema';

afterEach(() => vi.useRealTimers());
const storeFixture = () => createDiagnosticStore({ read: async () => [], write: async () => {}, remove: async () => {} });

it('uses installed native 1.2.99 instead of legacy web 1.1.0 or available update, without status checks', async () => {
  const status = vi.fn(async () => ({ version: '9.9.9' }));
  const version = createDiagnosticVersion({ userAgent: 'SetArchitect/1.2.99 Electron/33.4.11', nativeBridge: true, status });
  await version.ready;
  expect(version.state.current).toBe('desktop:1.2.99'); expect(status).not.toHaveBeenCalled();
  const store = storeFixture(); await store.activate('synthetic');
  store.begin('synthetic', version.state.current, '2026-11-18T05:44:00.000Z.01234567-89ab-cdef-0123-456789abcdef', 1)?.finish('completed');
  const run = store.get().rows[0].run;
  expect(run.version).toBe('desktop:1.2.99'); expect(run.build).toBe('2026-11-18T05:44:00.000Z.01234567-89ab-cdef-0123-456789abcdef');
});
it('browser-only reports web version separately and never reads desktop status', async () => {
  const status = vi.fn(); const version = createDiagnosticVersion({ userAgent: 'Mozilla/5.0 Chrome/130', nativeBridge: false, status });
  expect(version.state.current).toBe(`web:${APP_VERSION}`); await version.ready;
  expect(version.state.current).toBe(`web:${APP_VERSION}`); expect(status).not.toHaveBeenCalled();
});
it('pending installed identity never blocks generation or rewrites completed runs; late results cannot cross account fences', async () => {
  let reply: (v: unknown) => void = () => {};
  const version = createDiagnosticVersion({ userAgent: 'Electron/33', nativeBridge: true, status: () => new Promise(resolve => { reply = resolve; }) });
  const store = storeFixture(); await store.activate('a');
  const run = store.begin('a', version.state.current, 'build', 1); run?.finish('completed');
  expect(store.get().rows[0].run.version).toBe('desktop:unavailable'); expect(store.get().rows[0].run.status).toBe('completed');
  const revision = store.get().rows[0].run.revision; await store.activate(null); await store.activate('b');
  version.dispose(); reply({ currentVersion: '1.2.99', version: '9.9.9' }); await version.ready;
  expect(version.state.current).toBe('desktop:unavailable'); expect(store.get().rows).toEqual([]);
  run?.notice('metadata_failed'); expect(revision).toBe(1);
});
it('hanging or available-only status stays unavailable; installed identity may resolve for future runs only', async () => {
  vi.useFakeTimers();
  const hung = createDiagnosticVersion({ userAgent: 'Electron/33', nativeBridge: true, status: () => new Promise(() => {}) });
  expect(hung.state.current).toBe('desktop:unavailable'); await vi.advanceTimersByTimeAsync(3000); await hung.ready;
  expect(hung.state.current).toBe('desktop:unavailable');
  const available = createDiagnosticVersion({ userAgent: 'Electron/33', nativeBridge: true, status: async () => ({ version: '9.9.9' }) });
  await available.ready; expect(available.state.current).toBe('desktop:unavailable');
  const explicit = createDiagnosticVersion({ userAgent: 'Electron/33', nativeBridge: true, status: async () => ({ currentVersion: '1.2.98' }) });
  expect(explicit.state.current).toBe('desktop:unavailable'); await explicit.ready; expect(explicit.state.current).toBe('desktop:1.2.98');
});
it('preserves the full 100-character allowlisted build while copy retains exact duration and seconds', async () => {
  const store = storeFixture(); await store.activate('a'); const build = 'x'.repeat(100);
  const run = store.begin('a', 'desktop:1.2.99', build, 1);
  run?.coverage({ transition: 14400 }, { transition: 14321 }); run?.finish('completed');
  const report = JSON.parse(copyDiagnostics(store.get().rows[0].run));
  expect(report.build).toBe(build); expect(report.coverage[1]).toEqual({ section: 'transition', targetSeconds: 14400, achievedSeconds: 14321 });
  expect(report.elapsedMs).toBe(store.get().rows[0].run.elapsedMs);
  expect(BatchSchema.safeParse({ runs: [{ ...report, build: 'x'.repeat(101) }] }).success).toBe(false);
  expect(BatchSchema.safeParse({ runs: [{ ...report, version: 'desktop:/private/file' }] }).success).toBe(false);
});