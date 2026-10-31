// Persist the parsed music library (VirtualDJ database + scanned folders)
// in IndexedDB so it reloads instantly on the next visit / login instead of
// having to be re-imported every time.
//
// Only the track index (paths + tags) is stored. Actual audio File objects
// cannot be persisted, so in-app playback still requires re-connecting the
// music folder for the session.

import type { VdjTrack } from "./virtualDj";

const DB_NAME = "dancefloor-store";
const STORE = "handles";
const DB_VERSION = 1;
const LIBRARY_KEY = "savedMusicLibrary";
const keyFor = (userId: string) => `${LIBRARY_KEY}:${userId}`;

export interface SavedLibrarySource {
  label: string;
  tracks: VdjTrack[];
}

export interface SavedLibraryPayload {
  version: 1;
  savedAt: number;
  sources: SavedLibrarySource[];
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function saveMusicLibrary(sources: SavedLibrarySource[], userId: string): Promise<number | null> {
  if (!validSavedLibrary({ version: 1, savedAt: Date.now(), sources })) return null;
  const db = await openDb();
  if (!db) return null;
  const savedAt = Date.now();
  const payload: SavedLibraryPayload = { version: 1, savedAt, sources };
  const ok = await new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(payload, keyFor(userId));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
  db.close();
  return ok ? savedAt : null;
}

function readKey(db: IDBDatabase, key: string): Promise<SavedLibraryPayload | null> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const val = req.result as SavedLibraryPayload | undefined;
        if (val === undefined || val === null) return resolve(null);
        if (!validSavedLibrary(val)) { reject(new Error("Saved music index is unreadable. Original data has been preserved; automatic saving is disabled.")); return; }
        resolve(val);
      };
      req.onerror = () => reject(new Error("Could not read the saved music index. Automatic saving is disabled."));
    } catch {
      reject(new Error("Could not read the saved music index. Automatic saving is disabled."));
    }
  });
}

export async function loadMusicLibrary(userId: string): Promise<SavedLibraryPayload | null> {
  const db = await openDb();
  if (!db) throw new Error("Music index storage is unavailable. Automatic saving is disabled.");
  try {
  let result = await readKey(db, keyFor(userId));
  if (!result) {
    // One-time migration: libraries saved before per-account storage used a
    // shared key. Move it to the first account that loads on this device.
    const legacy = await readKey(db, LIBRARY_KEY);
    if (legacy) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          store.put(legacy, keyFor(userId));
          store.delete(LIBRARY_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
      result = legacy;
    }
  }
  return result;
  } finally { db.close(); }
}

export async function clearMusicLibrary(userId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(keyFor(userId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export function countSavedTracks(payload: SavedLibraryPayload | null): number {
  if (!payload) return 0;
  return payload.sources.reduce((n, s) => n + (s.tracks?.length ?? 0), 0);
}

export function validSavedLibrary(value: unknown): value is SavedLibraryPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as SavedLibraryPayload;
  return v.version === 1 && Number.isFinite(v.savedAt) && Array.isArray(v.sources) && v.sources.every(s =>
    s && typeof s.label === "string" && Array.isArray(s.tracks) && s.tracks.every(t =>
      t && typeof t.filePath === "string" && typeof t.artist === "string" && typeof t.title === "string" &&
      ["bpm","key","genre","year","album","comment","fileSize","decade","remix","lastPlayTime"].every(k => (t as unknown as Record<string, unknown>)[k] === undefined || typeof (t as unknown as Record<string, unknown>)[k] === "string") &&
      (t.playCount === undefined || Number.isFinite(t.playCount))));
}
