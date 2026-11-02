import { validSavedLibrary, type SavedLibrarySource } from "./libraryStore";
import { readEventSnapshot } from "./snapshotSafety";
import { EVENT_REVISION_FIELD } from "./eventRevision";
import { inspectBackupValues } from "./backupPolicy";
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
  inspectBackupValues(b);
  if (!b.roots || Array.isArray(b.roots) || typeof b.roots !== "object") throw Error("Invalid source mappings.");
  for (const [label, path] of Object.entries(b.roots)) if (!label || /[\\/\r\n]/.test(label) || typeof path !== "string" || path.length > 4000 || /[\r\n\u0000]/.test(path) || path.split(/[\\/]/).includes("..") || !(/^(?:\/|[A-Za-z]:[\\/])/.test(path))) throw Error("Unsafe source mapping.");
  const labels = new Set<string>();
  for (const source of b.sources) {
    if (!source.label || /[\\/\r\n]/.test(source.label) || labels.has(source.label)) throw Error("Duplicate source label; original preserved.");
    labels.add(source.label);
    const paths = new Set<string>();
    for (const track of source.tracks) {
      if (paths.has(track.filePath) || /[\r\n]/.test(track.filePath) || track.filePath.split(/[\\/]/).includes("..")) throw Error("Duplicate or unsafe track path.");
      paths.add(track.filePath);
    }
  }
  const rootPaths = new Set<string>();
  for (const root of Object.values(b.roots) as string[]) { if (rootPaths.has(root)) throw Error("One root has conflicting labels."); rootPaths.add(root); }
  const ids = new Set<string>();
  for (const event of b.events) {
    if (typeof event.id !== "string" || !event.id || event.id.length > 200 || ids.has(event.id)) throw Error("Invalid event identity.");
    ids.add(event.id); const checked = readEventSnapshot(event.snapshot).snapshot;
    if (checked.inputs.songs.length > 2000) throw Error("Event too large.");
    for (const selection of Object.values(checked.lists.selections ?? {})) for (const path of selection.paths) {
      if (path.length > 4000 || /[\r\n\u0000]/.test(path) || path.split(/[\\/]/).includes("..")) throw Error("Unsafe selected track path.");
    }
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
  let conflictCount = 0;
  const conflict = (text: string) => { conflictCount++; if (conflicts.length < 100) conflicts.push(text); };
  const existingSources = new Map(current.map(source => [source.label, source]));
  const rootOwners = new Map(Object.entries(roots).map(([label, root]) => [root, label]));
  for (const source of backup.sources) {
    const existing = existingSources.get(source.label), root = backup.roots[source.label];
    if ((roots[source.label] && roots[source.label] !== root) || (root && rootOwners.has(root) && rootOwners.get(root) !== source.label)) { conflict(`${source.label}: different folder location`); continue; }
    if (existing) {
      const oldTracks = new Map(existing.tracks.map(track => [track.filePath, track]));
      for (const track of source.tracks) {
        const old = oldTracks.get(track.filePath);
        if (!old || JSON.stringify(old) !== JSON.stringify(track)) conflict(`${source.label}: ${track.filePath}`);
      }
      continue;
    }
    additions.push(source); if (root) mappings[source.label] = root;
  }
  return { conflicts, conflictCount, additions, mappings };
}
