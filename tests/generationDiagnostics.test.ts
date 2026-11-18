import { afterEach, expect, it, vi } from 'vitest';
import { BatchSchema, copyDiagnostics } from '@/lib/generationDiagnostics/schema';
import { createDiagnosticStore, MAX_RUNS, RETENTION_MS, type DiagnosticStorage, type LocalRun } from '@/lib/generationDiagnostics/store';
import { relayDiagnostics } from '@/lib/generationDiagnostics/relay.server';

function fixture() {
  let time = 1800000000000;
  const data = new Map<string, unknown>();
  const storage: DiagnosticStorage = {
    read: async owner => [...data].filter(([k]) => k.startsWith(`${owner}:`)).map(([, v]) => structuredClone(v)),
    write: async (a, r) => { data.set(`${a}:${r.run.id}`, structuredClone(r)); },
    remove: async (a, id) => { data.delete(`${a}:${id}`); },
  };
  const store = createDiagnosticStore(storage, () => time);
  return { store, storage, data, advance: (ms: number) => { time += ms; } };
}
afterEach(() => vi.useRealTimers());

it.each(['completed', 'short', 'failed', 'cancelled'] as const)('persists terminal %s independently of event/music stores', async status => {
  const f = fixture(); await f.store.activate('synthetic');
  const run = f.store.begin('synthetic', '1.2.3', 'build-abc', 34);
  run?.coverage({ warmUp: 5400, transition: 14400, peak: 7200 }, { warmUp: 5400, transition: 14000, peak: 7200 });
  f.advance(3000); run?.finish(status); await f.store.settled();
  const saved = f.store.get().rows[0].run;
  expect(saved.status).toBe(status); expect(saved.elapsedMs).toBe(3000); expect(saved.requested).toBe(34);
  expect(saved.coverage[1]).toEqual({ section: 'transition', targetSeconds: 14400, achievedSeconds: 14000 });
  expect([...f.data.keys()]).toEqual([`synthetic:${saved.id}`]);
});
it('retains handled warnings, aggregates counts, refreshes running as interrupted and never rewrites malformed originals', async () => {
  const f = fixture(); await f.store.activate('a');
  const run = f.store.begin('a', '1.2', 'build', 34);
  run?.notice('metadata_incomplete', 8); run?.notice('metadata_incomplete', 3);
  run?.causes({ ai: { deadline: 2, secret: 'dummy-token' }, account: { network: 1 }, reccobeats: { rate: 4 } });
  await f.store.settled(); f.data.set('a:corrupt', { raw: 'preserve-original' });
  const reload = createDiagnosticStore(f.storage); await reload.activate('a'); await reload.settled();
  expect(reload.get().rows[0].run.status).toBe('interrupted');
  expect(reload.get().rows[0].run.notices).toContainEqual({ code: 'metadata_incomplete', count: 11 });
  expect(reload.get().rows[0].run.causes).toEqual([{ provider: 'ai', cause: 'deadline', count: 2 }, { provider: 'reccobeats', cause: 'rate', count: 4 }]);
  expect(reload.get().malformed).toBe(true); expect(f.data.get('a:corrupt')).toEqual({ raw: 'preserve-original' });
});
it('completed external warnings remain warnings; informational budget alone is not failure', async () => {
  const f = fixture(); await f.store.activate('a');
  f.store.begin('a', '1', 'b', 1)?.notice('lookup_budget', 600);
  const r = f.store.begin('a', '1', 'b', 1); r?.notice('metadata_failed', 8); r?.finish('completed');
  expect(f.store.get().rows.find(x => x.run.id === r?.id)?.run.status).toBe('warnings');
});
it('offline queue survives reload; partial acceptance marks only confirmed stable revisions', async () => {
  const f = fixture(); await f.store.activate('a');
  for (let i = 0; i < 2; i++) { f.advance(1); f.store.begin('a', '1', 'b', 1)?.finish('completed'); }
  await f.store.settled(); const reload = createDiagnosticStore(f.storage, () => 1800000000100);
  await reload.activate('a');
  const send = vi.fn(async runs => ({ state: 'sent' as const, accepted: [{ id: runs[0].id, revision: runs[0].revision }] }));
  reload.setSender(send); await reload.flush(); await reload.settled();
  expect(send).toHaveBeenCalledTimes(1); expect(reload.get().rows.map(r => r.delivery).sort()).toEqual(['retry later', 'sent']);
  await reload.flush(); expect(send).toHaveBeenCalledTimes(1);
});
it('sign-out/account switch fences delayed loads, run callbacks and acknowledgements', async () => {
  const f = fixture(); await f.store.activate('a'); const r = f.store.begin('a', '1', 'b', 1); r?.finish('completed');
  let ack: (v: any) => void = () => {};
  f.store.setSender(() => new Promise(resolve => { ack = resolve; }));
  const pending = f.store.flush(); await Promise.resolve();
  await f.store.activate(null); await f.store.activate('b');
  r?.notice('metadata_failed', 9); ack({ state: 'sent', accepted: [{ id: r?.id, revision: 1 }] }); await pending;
  expect(f.store.get().rows).toEqual([]);
  await f.store.activate('a'); expect(f.store.get().rows[0].delivery).not.toBe('sent');
  await f.store.activate(null);
});
it('running account switch is cancelled, not timeout, with late callbacks ignored', async () => {
  const f = fixture(); await f.store.activate('a'); const r = f.store.begin('a', '1', 'b', 1);
  await f.store.activate('b'); r?.notice('metadata_timeout', 8); r?.finish('failed'); await f.store.activate('a');
  expect(f.store.get().rows[0].run.status).toBe('cancelled');
  expect(f.store.get().rows[0].run.notices.map(n => n.code)).toEqual(['cancelled']);
});
it('retention is 50 records / 30 days and does not delete malformed records', async () => {
  const f = fixture(); await f.store.activate('a'); f.data.set('a:bad', { unknown: true });
  for (let i = 0; i < MAX_RUNS + 7; i++) { f.advance(1); f.store.begin('a', '1', 'b', 1)?.finish('completed'); }
  await f.store.settled(); expect(f.store.get().rows).toHaveLength(50); expect(f.data.size).toBe(51);
  f.advance(RETENTION_MS + 1); await f.store.activate('b'); await f.store.activate('a'); await f.store.settled();
  expect(f.store.get().rows).toEqual([]); expect(f.data.get('a:bad')).toEqual({ unknown: true });
});
it('storage failure has explicit memory-only warning and retains current diagnostic across account return', async () => {
  const broken: DiagnosticStorage = { read: async () => { throw Error('dummy'); }, write: async () => { throw Error('dummy'); }, remove: async () => {} };
  const store = createDiagnosticStore(broken); await store.activate('a'); const r = store.begin('a', '1', 'b', 1); r?.finish('completed'); await store.settled();
  expect(store.get().memoryOnly).toBe(true); await store.activate('b'); await store.activate('a'); expect(store.get().rows[0].run.id).toBe(r?.id);
});
it('relay/copy rebuild allowlist with sensitive dummy fields and rejects invalid batch/config', async () => {
  const f = fixture(); await f.store.activate('a'); f.store.begin('a', '1', 'b', 34)?.finish('completed');
  const r = { ...f.store.get().rows[0].run, account: 'SENSITIVE', eventName: 'SENSITIVE', songs: ['SENSITIVE'], token: 'SENSITIVE', path: 'SENSITIVE', stack: 'SENSITIVE' };
  expect(copyDiagnostics(r)).not.toContain('SENSITIVE');
  const send = vi.fn(async (_url: any, init: any) => { expect(init.body).not.toContain('SENSITIVE'); expect(init.redirect).toBe('manual'); return new Response(null, { status: 202 }); });
  const result = await relayDiagnostics({ runs: [r] }, { token: 'test-only', host: 's123.eu-nbg-2.betterstack.com' }, send);
  expect(result.state).toBe('not configured'); expect(send).not.toHaveBeenCalled();
  const accepted = await relayDiagnostics({ runs: [r] }, { token: 'test-only', host: 's123.eu-nbg-2.in.logs.betterstack.com' }, send);
  expect(accepted.accepted).toEqual([{ id: r.id, revision: r.revision }]);
  expect(BatchSchema.safeParse({ runs: Array(6).fill(r) }).success).toBe(false);
  expect(BatchSchema.safeParse({ runs: [{ ...r, build: 'https://sensitive/path' }] }).success).toBe(false);
});
it.each([200, 401, 402, 403, 429, 500])('relay status %s is never falsely acknowledged', async status => {
  const f = fixture(); await f.store.activate('a'); f.store.begin('a', '1', 'b', 1)?.finish('completed');
  const reply = await relayDiagnostics({ runs: [f.store.get().rows[0].run] }, { token: 'dummy', host: 'in.logs.betterstack.com' }, async () => new Response(null, { status, headers: { 'retry-after': '999999' } }));
  expect(reply.accepted).toEqual([]); expect(reply.state).toBe('retry later'); expect(reply.retryAfterMs).toBeLessThanOrEqual(3600000);
});
it('hanging relay and missing configuration finish bounded without reading raw response bodies', async () => {
  vi.useFakeTimers(); const f = fixture(); await f.store.activate('a'); f.store.begin('a', '1', 'b', 1)?.finish('completed'); const input = { runs: [f.store.get().rows[0].run] };
  const send = vi.fn(() => new Promise<Response>(() => {}));
  expect((await relayDiagnostics(input, {}, send)).state).toBe('not configured'); expect(send).not.toHaveBeenCalled();
  const task = relayDiagnostics(input, { token: 'dummy', host: 'in.logs.betterstack.com' }, send);
  await vi.advanceTimersByTimeAsync(5000); expect(await task).toEqual({ accepted: [], state: 'retry later', retryAfterMs: 60000 });
});