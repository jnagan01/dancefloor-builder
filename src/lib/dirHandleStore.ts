// Persist a File System Access `FileSystemDirectoryHandle` across reloads
// using IndexedDB (handles are structured-cloneable). Browser-only; all
// methods no-op safely when `indexedDB` is unavailable.

const DB_NAME = "dancefloor-store";
const STORE = "handles";
const DB_VERSION = 1;

// Loose handle type so this file stays usable outside DOM-typed contexts.
export interface AnyHandle {
  name?: string;
  queryPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: "read" | "readwrite" }) => Promise<PermissionState>;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function saveDirHandle(key: string, handle: AnyHandle): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

export async function loadDirHandle(key: string): Promise<AnyHandle | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await new Promise<AnyHandle | null>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as AnyHandle) ?? null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return result;
}

export async function clearDirHandle(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

interface DirMeta {
  savedAt: number;
}

export async function saveDirHandleMeta(key: string, meta: DirMeta): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(meta, `${key}:meta`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

export async function loadDirHandleMeta(key: string): Promise<DirMeta | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await new Promise<DirMeta | null>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(`${key}:meta`);
    req.onsuccess = () => resolve((req.result as DirMeta) ?? null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return result;
}

export async function clearDirHandleMeta(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(`${key}:meta`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

/**
 * Ensure we still have readwrite permission. Returns true if permission was
 * already granted or successfully re-requested.
 */
export async function verifyReadWrite(handle: AnyHandle): Promise<boolean> {
  try {
    if (handle.queryPermission) {
      const status = await handle.queryPermission({ mode: "readwrite" });
      if (status === "granted") return true;
    }
    if (handle.requestPermission) {
      const status = await handle.requestPermission({ mode: "readwrite" });
      return status === "granted";
    }
  } catch {
    return false;
  }
  return false;
}
