import { EVENT_REVISION_FIELD } from "./eventRevision";
import { readEventSnapshot } from "./snapshotSafety";
export interface EventDraft<T> {
  version: 1; account: string; event: string; token: string; createId: string;
  baseVersion: string | null; snapshot: T; savedAt: number;
  origin?: { account: string; event: string; token: string };
  baseSnapshot?: unknown;
  baseRevision?: string | null;
  writeRevision?: string;
  savedId?: string;
}
/** Rebase a newer pending draft after an earlier edit is confirmed; never remove its snapshot. */
export function checkpointEventDraft(account: string, event: string, saved: { id: string; updatedAt?: string; revision?: string | null }, storage: Storage = localStorage) {
  const draft = loadEventDraft(account, event, storage);
  if (!draft) return;
  if (draft.writeRevision === saved.revision) return; // Exact-write retry must retain its original expected marker.
  storeEventDraft({ ...draft, baseRevision: saved.revision, baseVersion: saved.updatedAt ?? draft.baseVersion, savedId: saved.id, baseSnapshot: undefined }, storage);
}
// Native journal is fsynced before returning, unlike Chromium's deferred localStorage flush.
function recoveryStorage(storage: Storage): Storage {
  if (typeof window === "undefined" || typeof localStorage === "undefined" || storage !== localStorage) return storage;
  const bridge = (window as unknown as { electronRecovery?: { get(key: string): string | null; set(key: string, raw: string): void; remove(key: string): void } }).electronRecovery;
  if (!bridge) return storage;
  return { getItem: key => bridge.get(key) ?? storage.getItem(key), setItem: (key, raw) => { bridge.set(key, raw); storage.setItem(key, raw); }, removeItem: key => { bridge.remove(key); storage.removeItem(key); }, clear: () => { throw Error("Recovery must be removed individually."); }, key: index => storage.key(index), get length() { return storage.length; } };
}
const key = (account: string, event: string) => `setarchitect:recovery:${encodeURIComponent(account)}:${encodeURIComponent(event)}`;
export function storeEventDraft<T>(draft: EventDraft<T>, storage: Storage = localStorage) {
  storage = recoveryStorage(storage);
  storage.setItem(key(draft.account, draft.event), JSON.stringify(draft));
}
export function loadEventDraft<T>(account: string, event: string, storage: Storage = localStorage): EventDraft<T> | null {
  storage = recoveryStorage(storage);
  const raw = storage.getItem(key(account, event));
  if (raw === null) return null;
  const value = JSON.parse(raw) as EventDraft<T>;
  if (!value || value.version !== 1 || value.account !== account || value.event !== event || typeof value.token !== "string" || typeof value.createId !== "string" || !value.snapshot ||
    (value.baseRevision !== undefined && value.baseRevision !== null && (typeof value.baseRevision !== "string" || !/^[0-9a-f-]{36}$/i.test(value.baseRevision))) ||
    (value.writeRevision !== undefined && (typeof value.writeRevision !== "string" || !/^[0-9a-f-]{36}$/i.test(value.writeRevision))) ||
    (value.origin && (value.origin.account !== account || typeof value.origin.event !== "string" || typeof value.origin.token !== "string"))) throw new Error("Local recovery data could not be read. It has been preserved.");
  return value;
}
/** Explicit user recovery: retain the unreadable bytes before removing the blocked slot. */
export function archiveEventDraft(account: string, event: string, storage: Storage = localStorage) {
  storage = recoveryStorage(storage);
  const source = key(account, event), raw = storage.getItem(source);
  if (raw === null) return;
  storage.setItem(`${source}:unreadable:${crypto.randomUUID()}`, raw);
  storage.removeItem(source);
}
/** Remove only the exact draft acknowledged by the latest confirmed write. */
export function confirmEventDraft(account: string, event: string, token: string, storage: Storage = localStorage) {
  storage = recoveryStorage(storage);
  if (loadEventDraft(account, event, storage)?.token === token) storage.removeItem(key(account, event));
}
/** Compare semantic persisted data, ignoring only the application's write marker. */
export function sameEventSnapshot(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): string => {
    const checked = readEventSnapshot(value).snapshot;
    const clean = { ...checked, inputs: { ...checked.inputs } };
    delete clean.inputs[EVENT_REVISION_FIELD];
    const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered) : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordered(x)])) : v;
    return JSON.stringify(ordered(clean));
  };
  try { return canonical(a) === canonical(b); } catch { return false; }
}
/** A changed exit token is harmless only when BOTH marker and exact semantic data agree. */
export function pendingRecoveryEvent(event: string) { return `${event}:pending-edit`; }
export function reconcileEventDraft(account: string, event: string, revision: string | null, snapshot: unknown, storage: Storage = localStorage): boolean {
  const draft = loadEventDraft(account, event, storage);
  if (!draft || !revision || draft.writeRevision !== revision || !sameEventSnapshot(draft.snapshot, snapshot)) return false;
  confirmEventDraft(account, event, draft.token, storage);
  return true;
}
