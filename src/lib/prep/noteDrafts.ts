/**
 * Unsaved note/tag drafts, kept separately per account + exact file identity + field, so a save
 * finishing for one field never overwrites unsaved text in the other, and text survives
 * closing/reopening the panel. Cleared on sign-out; never persisted.
 */
export type DraftField = "tags" | "note";
export function createNoteDrafts() {
  const m = new Map<string, string>();
  const listeners = new Set<() => void>();
  let version = 0;
  const key = (account: string, id: string, field: DraftField) => JSON.stringify([account, id, field]);
  const emit = () => { version++; listeners.forEach(l => l()); };
  return {
    get: (account: string, id: string, field: DraftField) => m.get(key(account, id, field)),
    set(account: string, id: string, field: DraftField, value: string) { m.set(key(account, id, field), value); emit(); },
    /** Clear only if the draft still equals what was saved (typing during the save keeps the newer text). */
    settle(account: string, id: string, field: DraftField, saved: string) { const k = key(account, id, field); if (m.get(k) === saved) { m.delete(k); emit(); } },
    discard(account: string, id: string, field: DraftField) { if (m.delete(key(account, id, field))) emit(); },
    clearAll() { if (m.size) { m.clear(); emit(); } },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    version: () => version,
  };
}
export const noteDrafts = createNoteDrafts();
