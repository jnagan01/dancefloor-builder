export type SaveState = "idle" | "saving" | "saved" | "error";
export interface SaveAttempt { signal: AbortSignal; expectedUpdatedAt: string | null; createId: string; create: boolean; expectedRevision: string | null; writeRevision: string }
export interface ConfirmedEvent { id: string; updatedAt?: string; revision?: string | null }
/** Serialized per identity; timed-out requests may retry ONLY with atomic CAS/idempotent creation. */
export function createEventAutosave<T>(options: {
  write: (id: string | null, snapshot: T, attempt: SaveAttempt) => Promise<ConfirmedEvent>;
  onState: (state: SaveState) => void; onId: (id: string) => void; onError: () => void;
  onConfirmed?: (snapshot: T, saved: ConfirmedEvent) => void;
  onCheckpoint?: (snapshot: T, saved: ConfirmedEvent, latest: boolean) => void;
  timeoutMs?: number; safeWriteContract?: boolean;
}) {
  type Job = { epoch: number; revision: number; snapshot: T; current: () => boolean; key: string; writeRevision: string };
  let epoch = 0, revision = 0, id: string | null = null, version: string | null = null;
  let createId: string = crypto.randomUUID(), key: string = createId, pending: Job | null = null, ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flights = new Map<string, { controller: AbortController; uncertain: boolean }>();
  const uncertainKeys = new Set<string>();
  const knownVersions = new Map<string, string>();
  let expectedRevision: string | null = null;
  const valid = (job: Job) => job.epoch === epoch && job.current();
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const rekeyPending = () => { if (pending) pending.key = key; };
  async function drain() {
    if (!ready || !pending || flights.has(pending.key)) return;
    const job = pending;
    if (!valid(job)) { pending = null; return; }
    pending = null; ready = false;
    const controller = new AbortController(), flight = { controller, uncertain: false };
    flights.set(job.key, flight);
    options.onState("saving");
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true; flight.uncertain = true; controller.abort();
      uncertainKeys.add(job.key);
      if (options.safeWriteContract) flights.delete(job.key);
      if (valid(job)) {
        if (job.revision === revision) pending = job;
        options.onState("error"); options.onError();
      }
      // Unknown outcome: no automatic retry. Explicit retry uses the same CAS version/create UUID.
    }, options.timeoutMs ?? 15000);
    try {
      const saved = await options.write(id, job.snapshot, { signal: controller.signal, expectedUpdatedAt: version, createId, create: !id, expectedRevision, writeRevision: job.writeRevision });
      if (!timedOut && valid(job)) {
        id = saved.id; version = saved.updatedAt ?? version; key = id;
        expectedRevision = saved.revision ?? job.writeRevision;
        if (saved.updatedAt) knownVersions.set(saved.id, saved.updatedAt);
        rekeyPending();
        options.onId(saved.id);
        uncertainKeys.delete(job.key);
        options.onCheckpoint?.(job.snapshot, { ...saved, revision: expectedRevision }, job.revision === revision);
        if (job.revision === revision) { options.onConfirmed?.(job.snapshot, saved); options.onState("saved"); }
      }
    } catch {
      if (!timedOut && valid(job) && job.revision === revision) {
        pending = job; options.onState("error"); options.onError();
      }
    } finally {
      clearTimeout(timeout);
      if (flights.get(job.key) === flight) flights.delete(job.key);
      if (!timedOut && !uncertainKeys.has(job.key)) void drain();
    }
  }
  return {
    schedule(snapshot: T, eventId: string | null, current: () => boolean, delay = 1000, writeRevision: string = crypto.randomUUID()) {
      if (eventId) { id = eventId; key = eventId; version = knownVersions.get(eventId) ?? version; }
      pending = { epoch, revision: ++revision, snapshot, current, key, writeRevision };
      ready = false; options.onState("idle"); clearTimer();
      timer = setTimeout(() => { timer = undefined; ready = true; void drain(); }, delay);
    },
    dirty() { revision++; options.onState("idle"); },
    retry() { if (!pending || !valid(pending)) return; clearTimer(); ready = true; void drain(); },
    configure(eventId: string | null, updatedAt: string | null, stableCreateId?: string, marker: string | null = null) {
      id = eventId; version = updatedAt; createId = stableCreateId ?? crypto.randomUUID(); key = id ?? createId;
      expectedRevision = marker;
      if (eventId && updatedAt) knownVersions.set(eventId, updatedAt);
    },
    reset(stableCreateId: string = crypto.randomUUID()) { epoch++; revision++; clearTimer(); pending = null; ready = false; id = null; version = null; expectedRevision = null; createId = stableCreateId; key = createId; return createId; },
  };
}
