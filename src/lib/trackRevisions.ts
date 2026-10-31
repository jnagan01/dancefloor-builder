import { trackIdentity } from "./fileIdentity";
import type { VdjTrack } from "./virtualDj";

/** Session-only revisions, never stored in tracks or music tags. */
export function createTrackRevisions() {
  let sequence = 0;
  const revisions = new Map<string, number>();
  const generations = new Map<string, number>();
  const key = (label: string, path: string, roots: Record<string, string>) => `${label}\u0000${trackIdentity(path, roots)}`;
  return {
    now: () => sequence,
    generation: (label: string) => generations.get(label) ?? 0,
    remove(label: string) { generations.set(label, (generations.get(label) ?? 0) + 1); sequence++; },
    revision(label: string, path: string, roots: Record<string, string>) { return revisions.get(key(label, path, roots)) ?? 0; },
    bump(label: string, path: string, roots: Record<string, string>) { const revision = ++sequence; revisions.set(key(label, path, roots), revision); return revision; },
    changedSince(label: string, track: VdjTrack, roots: Record<string, string>, start: number) { return (revisions.get(key(label, track.filePath, roots)) ?? 0) > start; },
  };
}