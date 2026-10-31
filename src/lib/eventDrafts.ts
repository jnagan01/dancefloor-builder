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
  storeEventDraft({ ...draft, baseRevision: saved.revision, baseVersion: saved.updatedAt ?? draft.baseVersion, savedId: saved.id, baseSnapshot: undefined }, storage);
}
const key = (account: string, event: string) => `setarchitect:recovery:${encodeURIComponent(account)}:${encodeURIComponent(event)}`;
export function storeEventDraft<T>(draft: EventDraft<T>, storage: Storage = localStorage) {
  storage.setItem(key(draft.account, draft.event), JSON.stringify(draft));
}
export function loadEventDraft<T>(account: string, event: string, storage: Storage = localStorage): EventDraft<T> | null {
  const raw = storage.getItem(key(account, event));
  if (raw === null) return null;
  const value = JSON.parse(raw) as EventDraft<T>;
  if (!value || value.version !== 1 || value.account !== account || value.event !== event || typeof value.token !== "string" || typeof value.createId !== "string" || !value.snapshot || (value.origin && (value.origin.account !== account || typeof value.origin.event !== "string" || typeof value.origin.token !== "string"))) throw new Error("Local recovery data could not be read. It has been preserved.");
  return value;
}
/** Explicit user recovery: retain the unreadable bytes before removing the blocked slot. */
export function archiveEventDraft(account: string, event: string, storage: Storage = localStorage) {
  const source = key(account, event), raw = storage.getItem(source);
  if (raw === null) return;
  storage.setItem(`${source}:unreadable:${crypto.randomUUID()}`, raw);
  storage.removeItem(source);
}
/** Remove only the exact draft acknowledged by the latest confirmed write. */
export function confirmEventDraft(account: string, event: string, token: string, storage: Storage = localStorage) {
  if (loadEventDraft(account, event, storage)?.token === token) storage.removeItem(key(account, event));
}