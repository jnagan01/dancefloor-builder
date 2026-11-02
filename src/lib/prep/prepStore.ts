import { emptyKnowledge, readKnowledge, mergeKnowledgeAdditive, type PrepKnowledge } from "./knowledge";

/** Storage backend; the default is the same account-keyed IndexedDB store used for music indexes. */
export interface PrepBackend { read(key: string): Promise<unknown>; write(key: string, value: PrepKnowledge): Promise<void> }
export type PrepStatus = "signedOut" | "loading" | "ready" | "blocked";
export interface PrepState { account: string | null; status: PrepStatus; knowledge: PrepKnowledge; error: string | null }

const keyFor = (account: string) => `prepKnowledge:${account}`;

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
 * Account-fenced store. Every async step re-checks the account generation; writes are
 * serialized and only replace the in-memory copy after the write succeeds. Unreadable
 * saved data blocks writes so the original bytes are never overwritten.
 */
export function createPrepStore(backend: PrepBackend = idbBackend()) {
  let state: PrepState = { account: null, status: "signedOut", knowledge: emptyKnowledge(), error: null };
  let generation = 0, queue: Promise<unknown> = Promise.resolve(), loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: PrepState) => { state = next; listeners.forEach(l => l()); };
  function setAccount(account: string | null) {
    if (account === state.account && state.status !== "signedOut") return loading ?? Promise.resolve();
    const gen = ++generation;
    if (!account) { loading = null; set({ account: null, status: "signedOut", knowledge: emptyKnowledge(), error: null }); return Promise.resolve(); }
    set({ account, status: "loading", knowledge: emptyKnowledge(), error: null });
    loading = (async () => {
      try {
        const raw = await backend.read(keyFor(account));
        if (gen !== generation) return;
        if (raw === undefined || raw === null) { set({ account, status: "ready", knowledge: emptyKnowledge(), error: null }); return; }
        const k = readKnowledge(raw);
        if (!k) set({ account, status: "blocked", knowledge: emptyKnowledge(), error: "Saved preparation notes are unreadable. They are preserved untouched; changes are disabled." });
        else set({ account, status: "ready", knowledge: k, error: null });
      } catch (e) { if (gen === generation) set({ account, status: "blocked", knowledge: emptyKnowledge(), error: (e as Error).message }); }
    })();
    return loading;
  }
  /** Apply a pure change for the captured account; throws if the account changed or storage is blocked. */
  function update(account: string, change: (k: PrepKnowledge) => PrepKnowledge): Promise<PrepKnowledge> {
    const gen = generation;
    const run = queue.then(async () => {
      if (gen !== generation || state.account !== account) throw Error("Account changed; nothing was saved.");
      if (state.status !== "ready") throw Error(state.error ?? "Preparation notes are still loading.");
      const next = change(state.knowledge);
      if (next === state.knowledge) return next;
      if (!readKnowledge(next)) throw Error("Change rejected: it would produce unreadable data.");
      await backend.write(keyFor(account), next);
      if (gen !== generation || state.account !== account) throw Error("Account changed during save.");
      set({ ...state, knowledge: next, error: null });
      return next;
    });
    queue = run.catch(() => undefined);
    return run;
  }
  return {
    get: () => state, subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    setAccount, update,
    /** Backup section for this account, or undefined when unreadable (original stays in storage). */
    async backupSection(account: string): Promise<PrepKnowledge | undefined> {
      if (state.account !== account) await setAccount(account); else if (loading) await loading;
      await queue;
      return state.account === account && state.status === "ready" ? structuredClone(state.knowledge) : undefined;
    },
    async restoreAdditive(account: string, incoming: unknown): Promise<number> {
      const k = readKnowledge(incoming); if (!k) throw Error("Backup preparation notes are unreadable; nothing imported.");
      let added = 0;
      await update(account, cur => { const r = mergeKnowledgeAdditive(cur, k); added = r.added; return r.added ? r.next : cur; });
      return added;
    },
  };
}
export type PrepStore = ReturnType<typeof createPrepStore>;
let shared: PrepStore | null = null;
export const prepStore = () => (shared ??= createPrepStore());
