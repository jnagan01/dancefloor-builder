import { CauseSchema, RunSchema, safeCount, safeVersion, safeBuild, type DiagnosticRun, type Delivery, type NoticeCode, type RelayReply } from './schema';

export type LocalRun = { run: DiagnosticRun; delivery: Delivery; attempts: number; nextAt: number };
export interface DiagnosticStorage { read(account: string): Promise<unknown[]>; write(account: string, value: LocalRun): Promise<void>; remove(account: string, id: string): Promise<void> }
export const RETENTION_MS = 30 * 86400_000;
export const MAX_RUNS = 50;
const decode = (value: unknown): LocalRun | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<LocalRun>, r = RunSchema.safeParse(v.run);
  if (!r.success) return null;
  return { run: r.data, delivery: ['sent', 'queued', 'not configured', 'retry later'].includes(v.delivery ?? '') ? v.delivery as Delivery : 'queued', attempts: Math.min(10, safeCount(v.attempts)), nextAt: typeof v.nextAt === 'number' && Number.isSafeInteger(v.nextAt) && v.nextAt >= 0 ? v.nextAt : 0 };
};

export function indexedDiagnosticStorage(): DiagnosticStorage {
  let database: Promise<IDBDatabase> | undefined;
  const open = () => database ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('setarchitect-generation-activity-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('runs');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Activity storage unavailable'));
    req.onblocked = () => reject(new Error('Activity storage blocked'));
  });
  async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('runs', mode); let value: T;
      tx.oncomplete = () => resolve(value); tx.onerror = tx.onabort = () => reject(new Error('Activity storage unavailable'));
      work(tx.objectStore('runs'), v => { value = v; });
    });
  }
  return {
    read: account => transaction('readonly', (s, done) => { const r = s.getAll(IDBKeyRange.bound([account, ''], [account, '\uffff'])); r.onsuccess = () => done(r.result); }),
    write: (account, value) => transaction('readwrite', (s, done) => { s.put(value, [account, value.run.id]); done(undefined); }),
    remove: (account, id) => transaction('readwrite', (s, done) => { s.delete([account, id]); done(undefined); }),
  };
}

export function createDiagnosticStore(storage: DiagnosticStorage, now = () => Date.now(), uuid = () => crypto.randomUUID()) {
  let account: string | null = null, epoch = 0, rows: LocalRun[] = [], fallback = false, warning = false;
  let ready: Promise<void> = Promise.resolve(), writes: Promise<void> = Promise.resolve();
  let sender: ((runs: DiagnosticRun[]) => Promise<RelayReply>) | undefined;
  let inFlight: number | undefined;
  const listeners = new Set<() => void>();
  const memory = new Map<string, LocalRun[]>();
  const emit = () => { for (const l of listeners) { try { l(); } catch { /* Never interfere with preparation. */ } } };
  const persist = (owner: string, row: LocalRun) => {
    const copy = structuredClone(row);
    const saved = memory.get(owner) ?? [];
    memory.set(owner, [copy, ...saved.filter(r => r.run.id !== copy.run.id)].slice(0, MAX_RUNS));
    writes = writes.then(() => storage.write(owner, copy)).catch(() => { fallback = true; emit(); });
  };
  const trim = (owner: string) => {
    rows.sort((a, b) => b.run.startedAt - a.run.startedAt);
    const kept = rows.filter(r => r.run.startedAt >= now() - RETENTION_MS).slice(0, MAX_RUNS);
    for (const r of rows) if (!kept.includes(r)) writes = writes.then(() => storage.remove(owner, r.run.id)).catch(() => { fallback = true; emit(); });
    rows = kept;
  };
  const update = (owner: string, row: LocalRun) => { row.delivery = 'queued'; row.nextAt = 0; row.run.revision++; persist(owner, row); emit(); };
  function finishRow(owner: string, row: LocalRun, status: DiagnosticRun['status']) {
    if (row.run.status !== 'running') return;
    row.run.status = status; row.run.endedAt = now(); row.run.elapsedMs = safeCount(now() - row.run.startedAt);
    if (status === 'cancelled' || status === 'interrupted' || status === 'failed') row.run.notices.push({ code: status, count: 1 });
    update(owner, row);
  }
  const api = {
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    get() { return { account, rows: structuredClone(rows), memoryOnly: fallback, malformed: warning }; },
    setSender(send: typeof sender) { sender = send; },
    async activate(owner: string | null) {
      if (account === owner) return ready;
      if (account) for (const row of rows) finishRow(account, row, 'cancelled');
      const fence = ++epoch; account = owner; rows = []; inFlight = undefined; warning = false; emit();
      if (!owner) return;
      ready = (async () => {
        let stored: unknown[] = [];
        try { await writes; stored = await storage.read(owner); } catch { if (epoch === fence) fallback = true; stored = memory.get(owner) ?? []; }
        if (epoch !== fence || account !== owner) return;
        for (const value of stored) {
          const row = decode(value);
          if (!row) { warning = true; continue; } // Never overwrite malformed originals.
          if (rows.some(r => r.run.id === row.run.id)) continue;
          rows.push(row);
          if (row.run.status === 'running') finishRow(owner, row, 'interrupted');
        }
        trim(owner); emit();
      })();
      await ready;
      if (epoch === fence) void api.flush();
    },
    begin(owner: string | null, version: unknown, build: unknown, requested: number, isCurrent = () => true) {
      if (!owner || owner !== account) return null;
      const fence = epoch;
      const row: LocalRun = { run: { schema: 1, kind: 'generation', id: uuid(), revision: 0, startedAt: now(), version: safeVersion(version), build: safeBuild(build), status: 'running', elapsedMs: 0, requested: safeCount(requested), notices: [], causes: [], coverage: [] }, delivery: 'queued', attempts: 0, nextAt: 0 };
      rows.unshift(row); persist(owner, row); trim(owner); emit();
      const live = () => {
        if (account !== owner || epoch !== fence || !rows.includes(row) || row.run.status !== 'running') return false;
        if (!isCurrent()) { finishRow(owner, row, 'cancelled'); return false; }
        return true;
      };
      return {
        id: row.run.id,
        notice(code: NoticeCode, count = 1, provider?: DiagnosticRun['notices'][number]['provider'], section?: DiagnosticRun['notices'][number]['section']) {
          if (!live()) return;
          const old = row.run.notices.find(n => n.code === code && n.provider === provider && n.section === section);
          if (old) old.count = safeCount(old.count + safeCount(count));
          else if (row.run.notices.length < 45) row.run.notices.push({ code, count: safeCount(count), provider, section });
          update(owner, row);
        },
        causes(input: unknown) {
          if (!live() || !input || typeof input !== 'object') return;
          for (const [provider, bucket] of Object.entries(input)) {
            if (!bucket || typeof bucket !== 'object') continue;
            for (const [cause, count] of Object.entries(bucket)) {
              const parsed = CauseSchema.safeParse({ provider, cause, count });
              if (!parsed.success) continue;
              const old = row.run.causes.find(c => c.provider === provider && c.cause === cause);
              if (old) old.count = safeCount(old.count + parsed.data.count);
              else if (row.run.causes.length < 77) row.run.causes.push(parsed.data);
            }
          }
          update(owner, row);
        },
        coverage(target: Record<string, number>, achieved: Record<string, number>) {
          if (!live()) return;
          row.run.coverage = (['warmUp', 'transition', 'peak'] as const).map(section => ({ section, targetSeconds: safeCount(target[section]), achievedSeconds: safeCount(achieved[section]) })); update(owner, row);
        },
        finish(status: DiagnosticRun['status']) {
          if (!live()) return;
          finishRow(owner, row, status === 'completed' && row.run.notices.some(n => !['continuation', 'lookup_budget', 'community_budget', 'candidate_strict_excluded', 'candidate_slow_excluded', 'context_window'].includes(n.code)) ? 'warnings' : status);
          void api.flush();
        },
      };
    },
    async flush() {
      const owner = account, fence = epoch, send = sender;
      if (!owner || !send || inFlight === fence) return;
      inFlight = fence;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await ready;
        if (account !== owner || epoch !== fence) return;
        const batch = rows.filter(r => r.run.status !== 'running' && r.delivery !== 'sent' && r.nextAt <= now()).slice(0, 5);
        if (!batch.length) return;
        const captured = batch.map(r => structuredClone(r.run));
        const reply = await Promise.race([send(captured), new Promise<RelayReply>(resolve => { timer = setTimeout(() => resolve({ accepted: [], state: 'retry later' }), 8000); })]);
        if (account !== owner || epoch !== fence) return;
        for (const row of batch) {
          const sent = captured.find(r => r.id === row.run.id);
          if (!sent || sent.revision !== row.run.revision) continue;
          const accepted = reply.accepted?.some(a => a.id === sent.id && a.revision === sent.revision);
          row.delivery = accepted ? 'sent' : reply.state === 'not configured' ? 'not configured' : 'retry later';
          row.attempts = Math.min(10, row.attempts + 1);
          const retry = typeof reply.retryAfterMs === 'number' && Number.isFinite(reply.retryAfterMs) ? reply.retryAfterMs : 0;
          row.nextAt = accepted ? 0 : now() + Math.min(3_600_000, Math.max(60_000 * 2 ** row.attempts, retry));
          persist(owner, row);
        }
        emit();
      } catch {
        if (account === owner && epoch === fence) {
          for (const row of rows.filter(r => r.run.status !== 'running' && r.delivery !== 'sent')) { row.delivery = 'retry later'; row.nextAt = now() + 120_000; persist(owner, row); }
          emit();
        }
      } finally { if (timer !== undefined) clearTimeout(timer); if (inFlight === fence) inFlight = undefined; }
    },
    settled() { return writes; },
  };
  return api;
}
let singleton: ReturnType<typeof createDiagnosticStore> | undefined;
export function diagnosticStore() { return singleton ??= createDiagnosticStore(indexedDiagnosticStorage()); }
export function beginGenerationDiagnostics(owner: string | null, version: unknown, build: unknown, requested: number, isCurrent = () => true) {
  try {
    const run = diagnosticStore().begin(owner, version, build, requested, isCurrent);
    if (!run) return null;
    return {
      id: run.id,
      notice: (...args: Parameters<typeof run.notice>) => { try { run.notice(...args); } catch { /* Diagnostics never stop generation. */ } },
      causes: (...args: Parameters<typeof run.causes>) => { try { run.causes(...args); } catch { /* Best effort. */ } },
      coverage: (...args: Parameters<typeof run.coverage>) => { try { run.coverage(...args); } catch { /* Best effort. */ } },
      finish: (...args: Parameters<typeof run.finish>) => { try { run.finish(...args); } catch { /* Best effort. */ } },
    };
  } catch { return null; }
}