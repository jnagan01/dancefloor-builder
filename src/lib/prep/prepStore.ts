import { emptyKnowledge, readKnowledge, mergeKnowledgeAdditive, carryEventPrep, type PrepKnowledge, type EventPrep } from "./knowledge";

/** Storage backend; the default is the same account-keyed IndexedDB store used for music indexes. */
export interface PrepBackend { read(key: string): Promise<unknown>; write(key: string, value: PrepKnowledge): Promise<void> }
export type PrepStatus = "signedOut" | "loading" | "ready" | "blocked";
/** `generation` changes synchronously on every account/session change; callers bind writes to it. */
export interface PrepState { account: string | null; generation: number; status: PrepStatus; knowledge: PrepKnowledge; error: string | null }
export interface PrepOwner { account: string; generation: number }

const keyFor = (account: string) => `prepKnowledge:${account}`;
export const STALE = "Account or session changed; nothing was saved.";

function idbBackend(): PrepBackend {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(Error("Preparation storage is unavailable."));
    const req = indexedDB.open("dancefloor-store", 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("handles")) req.result.createObjectStore("handles"); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(Error("Preparation storage is unavailable."));
  });
  return {
    async read(key) { const db = await open(); try { return await new Promise((res, rej) => { const r = db.transaction("handles", "readonly").objectStore("handles").get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(Error("Could not read preparation notes.")); }); } finally { db.close(); } },
    async write(key, value) { const db = await open(); try { await new Promise<void>((res, rej) => { const tx = db.transaction("handles", "readwrite"); tx.objectStore("handles").put(value, key); tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(Error("Could not save preparation notes; the last saved copy is kept.")); }); } finally { db.close(); } },
  };
}

/**
 * Account+session fenced store.
 * - Every account/session change bumps `generation` synchronously, so callbacks bound to an
 *   older render are rejected before any rerender happens.
 * - Writes are serialized; reloads queue behind pending writes so the in-memory copy always
 *   reflects what reached storage. In-memory state only changes after a successful write.
 * - Unreadable saved data blocks writes and backups so the original bytes are never overwritten
 *   or silently left out of a backup.
 */
export function createPrepStore(backend: PrepBackend = idbBackend()) {
  let state: PrepState = { account: null, generation: 0, status: "signedOut", knowledge: emptyKnowledge(), error: null };
  let queue: Promise<unknown> = Promise.resolve(), loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: PrepState) => { state = next; listeners.forEach(l => l()); };
  const live = (o: PrepOwner) => state.account === o.account && state.generation === o.generation;

  /** `force` starts a new session generation even for the same account (sign-in again, user update). */
  function setAccount(account: string | null, force = false): Promise<void> {
    if (!force && account === state.account && state.status !== "signedOut") return loading ?? Promise.resolve();
    if (!force && account === null && state.status === "signedOut") return Promise.resolve();
    const generation = state.generation + 1;
    if (!account) { loading = null; set({ account: null, generation, status: "signedOut", knowledge: emptyKnowledge(), error: null }); return Promise.resolve(); }
    set({ account, generation, status: "loading", knowledge: emptyKnowledge(), error: null });
    const owner = { account, generation };
    const run = queue.catch(() => undefined).then(async () => {
      try {
        const raw = await backend.read(keyFor(account));
        if (!live(owner)) return;
        if (raw === undefined || raw === null) { set({ ...state, status: "ready", knowledge: emptyKnowledge(), error: null }); return; }
        const k = readKnowledge(raw);
        if (!k) set({ ...state, status: "blocked", error: "Saved preparation notes are unreadable. They are preserved untouched; changes and backups are paused until this is resolved." });
        else set({ ...state, status: "ready", knowledge: k, error: null });
      } catch (e) { if (live(owner)) set({ ...state, status: "blocked", error: `${(e as Error).message} Changes and backups are paused.` }); }
    });
    loading = run; queue = run;
    return run;
  }
  const owner = (): PrepOwner | null => state.account ? { account: state.account, generation: state.generation } : null;

  /** Apply a pure change for a captured owner. Rejects if the account/session changed or storage is blocked. */
  function update(o: PrepOwner, change: (k: PrepKnowledge) => PrepKnowledge): Promise<PrepKnowledge> {
    if (!live(o)) return Promise.reject(Error(STALE));
    const run = queue.catch(() => undefined).then(async () => {
      if (!live(o)) throw Error(STALE);
      if (state.status !== "ready") throw Error(state.error ?? "Preparation notes are still loading.");
      const next = change(state.knowledge);
      if (next === state.knowledge) return next;
      if (!readKnowledge(next)) throw Error("Change rejected: it would produce unreadable data.");
      await backend.write(keyFor(o.account), next);
      if (!live(o)) throw Error(STALE);
      set({ ...state, knowledge: next, error: null });
      return next;
    });
    queue = run;
    return run;
  }
  return {
    get: () => state, owner, subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    setAccount, update,
    /**
     * Knowledge after every write queued so far has finished, for exactly this owner. Loops until no newer
     * write was queued meanwhile. Throws when stale or not ready, so callers never fall back to older data.
     */
    async settled(o: PrepOwner): Promise<PrepKnowledge> {
      for (let seen: Promise<unknown> | null = null; seen !== queue;) { seen = queue; await queue.catch(() => undefined); }
      if (!live(o)) throw Error(STALE);
      if (state.status !== "ready") throw Error(state.error ?? "Preparation notes are still loading.");
      return state.knowledge;
    },
    /**
     * Backup section for exactly this owner. Never switches accounts. Throws (blocking the backup
     * and any update that depends on it) when stale or unreadable; returns undefined only when the
     * account has no preparation data at all.
     */
    async backupSection(o: PrepOwner): Promise<PrepKnowledge | undefined> {
      if (!live(o)) throw Error(STALE);
      await queue.catch(() => undefined);
      if (!live(o)) throw Error(STALE);
      if (state.status === "blocked") throw Error(`Backup stopped: ${state.error}`);
      if (state.status !== "ready") throw Error("Backup stopped: preparation notes are still loading.");
      const k = state.knowledge;
      const empty = !k.presets.length && !k.tracks.length && !k.groups.length && !k.feedback.length && !k.events.length && !k.enrichment.length;
      return empty ? undefined : structuredClone(k);
    },
    async restoreAdditive(o: PrepOwner, incoming: unknown): Promise<number> {
      const k = readKnowledge(incoming); if (!k) throw Error("Backup preparation notes are unreadable; nothing imported.");
      let added = 0;
      await update(o, cur => { const r = mergeKnowledgeAdditive(cur, k); added = r.added; return r.added ? r.next : cur; });
      return added;
    },
    /** Copy one backed-up event's preparation onto the id a restored-as-new event will be created with. */
    async carryToNewEvent(o: PrepOwner, entry: EventPrep, newEventId: string): Promise<number> {
      let added = 0;
      await update(o, cur => { const r = carryEventPrep(cur, entry, newEventId); added = r.added; return r.added ? r.next : cur; });
      return added;
    },
  };
}
export type PrepStore = ReturnType<typeof createPrepStore>;
let shared: PrepStore | null = null;
export const prepStore = () => (shared ??= createPrepStore());
