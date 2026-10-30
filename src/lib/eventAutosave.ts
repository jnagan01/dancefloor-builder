export type SaveState = "idle" | "saving" | "saved" | "error";

/** Latest-only, single-flight writer. Reset drops queued work, never an in-flight request. */
export function createEventAutosave<T>(options: {
  write: (id: string | null, snapshot: T) => Promise<{ id: string }>;
  onState: (state: SaveState) => void;
  onId: (id: string) => void;
  onError: () => void;
}) {
  type Job = { epoch: number; revision: number; snapshot: T; current: () => boolean };
  let epoch = 0;
  let revision = 0;
  let id: string | null = null;
  let pending: Job | null = null;
  let running = false;
  let ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const valid = (job: Job) => job.epoch === epoch && job.current();
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };

  async function drain() {
    if (running || !ready || !pending) return;
    const job = pending;
    if (!valid(job)) { pending = null; return; }
    pending = null;
    ready = false;
    running = true;
    options.onState("saving");
    try {
      const saved = await options.write(id, job.snapshot);
      if (valid(job)) {
        id = saved.id;
        options.onId(saved.id);
        if (job.revision === revision) options.onState("saved");
      }
    } catch {
      if (valid(job) && job.revision === revision) {
        pending = job; // Retain the latest failed snapshot for online/manual recovery.
        options.onState("error");
        options.onError();
      }
    } finally {
      running = false;
      // A newer edit can queue while writing, but cannot overtake that write.
      void drain();
    }
  }

  return {
    schedule(snapshot: T, eventId: string | null, current: () => boolean, delay = 1000) {
      if (eventId) id = eventId;
      pending = { epoch, revision: ++revision, snapshot, current };
      ready = false;
      clearTimer();
      timer = setTimeout(() => { timer = undefined; ready = true; void drain(); }, delay);
    },
    retry() {
      if (!pending || !valid(pending)) return;
      clearTimer();
      ready = true;
      void drain();
    },
    reset() {
      epoch += 1;
      revision += 1;
      clearTimer();
      pending = null;
      ready = false;
      id = null;
    },
  };
}