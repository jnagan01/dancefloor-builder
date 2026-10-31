export interface EventDraft<T> {
  version: 1; account: string; event: string; token: string; createId: string;
  baseVersion: string | null; snapshot: T; savedAt: number;
}
const key = (account: string, event: string) => `setarchitect:recovery:${encodeURIComponent(account)}:${encodeURIComponent(event)}`;
export function storeEventDraft<T>(draft: EventDraft<T>, storage: Storage = localStorage) {
  storage.setItem(key(draft.account, draft.event), JSON.stringify(draft));
}
export function loadEventDraft<T>(account: string, event: string, storage: Storage = localStorage): EventDraft<T> | null {
  const raw = storage.getItem(key(account, event));
  if (!raw) return null;
  const value = JSON.parse(raw) as EventDraft<T>;
  if (value.version !== 1 || value.account !== account || value.event !== event || typeof value.token !== "string" || typeof value.createId !== "string" || !value.snapshot) throw new Error("Local recovery data could not be read. It has been preserved.");
  return value;
}
/** Remove only the exact draft acknowledged by the latest confirmed write. */
export function confirmEventDraft(account: string, event: string, token: string, storage: Storage = localStorage) {
  if (loadEventDraft(account, event, storage)?.token === token) storage.removeItem(key(account, event));
}