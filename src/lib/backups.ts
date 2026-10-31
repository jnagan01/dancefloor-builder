import { validSavedLibrary, type SavedLibrarySource } from "./libraryStore";
import { readEventSnapshot } from "./snapshotSafety";
import { EVENT_REVISION_FIELD } from "./eventRevision";
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
export interface Backup {
  format: "setarchitect-backup"; version: 1; account: string; createdAt: string;
  events: { id: string; snapshot: { name: string; inputs: Record<string, unknown>; lists: Record<string, unknown> } }[];
  sources: SavedLibrarySource[]; roots: Record<string, string>;
}
export function validateBackup(raw: string, account: string): Backup {
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) throw Error("Backup exceeds 32 MB; original preserved.");
  const b = JSON.parse(raw);
  if (!b || b.format !== "setarchitect-backup" || b.version !== 1 || b.account !== account || typeof b.createdAt !== "string" || !Number.isFinite(Date.parse(b.createdAt)) || !Array.isArray(b.events) || b.events.length > 500 || !validSavedLibrary({ version: 1, savedAt: Date.now(), sources: b.sources }) || b.sources.reduce((n: number, s: SavedLibrarySource) => n + s.tracks.length, 0) > 100000) throw Error("Backup version, account or contents are invalid; original preserved.");
  const inspect = (v: unknown, depth = 0) => {
    if (depth > 30) throw Error("Backup nesting is too deep.");
    if (typeof v === "string" && (v.length > 100000 || /\u0000/.test(v))) throw Error("Unsafe backup value.");
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      if (/^(?:__proto__|constructor|prototype|.*password.*|.*credential.*|.*session.*|.*access.?token.*|.*refresh.?token.*|.*secret.*|.*api.?key.*)$/i.test(k)) throw Error("Backup contains unsafe or private fields.");
      inspect(x, depth + 1);
    }
  };
  inspect(b);
  if (!b.roots || Array.isArray(b.roots) || typeof b.roots !== "object") throw Error("Invalid source mappings.");
  for (const [label, path] of Object.entries(b.roots)) if (!label || /[\\/\r\n]/.test(label) || typeof path !== "string" || path.length > 4000 || /[\r\n\u0000]/.test(path) || path.split(/[\\/]/).includes("..") || !(/^(?:\/|[A-Za-z]:[\\/])/.test(path))) throw Error("Unsafe source mapping.");
  const ids = new Set<string>();
  for (const event of b.events) {
    if (typeof event.id !== "string" || !event.id || event.id.length > 200 || ids.has(event.id)) throw Error("Invalid event identity.");
    ids.add(event.id); readEventSnapshot(event.snapshot);
    for (const section of ["warmUp", "transition", "peak"]) if ((event.snapshot.lists[section]?.length ?? 0) > 2000) throw Error("Event too large.");
  }
  return b;
}
export function recoveryFromBackup(backup: Backup, eventId: string) {
  const event = backup.events.find(e => e.id === eventId);
  if (!event) throw Error("Select one event to restore.");
  const snapshot = structuredClone(event.snapshot);
  delete snapshot.inputs[EVENT_REVISION_FIELD];
  return { version: 1 as const, account: backup.account, event: "new", token: crypto.randomUUID(), createId: crypto.randomUUID(), baseVersion: null, baseRevision: null, writeRevision: crypto.randomUUID(), snapshot, savedAt: Date.now() };
}
/** Preserve conflicting existing rows and roots; metadata import is never a replacement. */
export function previewMetadataRestore(backup: Backup, current: SavedLibrarySource[], roots: Record<string, string>) {
  const conflicts: string[] = [], additions: SavedLibrarySource[] = [], mappings: Record<string, string> = {};
  for (const source of backup.sources) {
    const existing = current.find(s => s.label === source.label);
    const root = backup.roots[source.label];
    if (roots[source.label] && roots[source.label] !== root) { conflicts.push(`${source.label}: different folder location`); continue; }
    if (existing) {
      for (const track of source.tracks) {
        const old = existing.tracks.find(t => t.filePath === track.filePath);
        if (!old || JSON.stringify(old) !== JSON.stringify(track)) conflicts.push(`${source.label}: ${track.filePath}`);
      }
      continue;
    }
    additions.push(source); if (root) mappings[source.label] = root;
  }
  return { conflicts, additions, mappings };
}