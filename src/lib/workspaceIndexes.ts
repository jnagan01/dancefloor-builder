import { buildAudioIndex, type AudioIndex } from "./audioMatch";
import { createIdentityIndex } from "./fileIdentity";
import { buildLibrary, type VdjTrack } from "./virtualDj";
type Source = { label: string; tracks: VdjTrack[] };

/** Reuse identity-only indexes across tag edits; library subjects still refresh with metadata. */
export function createWorkspaceIndexes() {
  let paths: string[] = [], rootsKey = "", lastFiles: File[] | undefined, audio: AudioIndex | undefined;
  let nativeVersion = -1;
  let native: ReturnType<typeof createIdentityIndex<{ relative: string; path: string }>> | undefined;
  return {
    paths(sources: Source[]) {
      const next = sources.flatMap(s => s.tracks.map(t => t.filePath));
      if (next.length !== paths.length || next.some((p, i) => p !== paths[i])) { paths = next; audio = undefined; native = undefined; }
      return paths;
    },
    audio(files: File[], known: string[], roots: Record<string, string>) {
      const key = JSON.stringify(roots);
      if (!audio || files !== lastFiles || rootsKey !== key) {
        audio = buildAudioIndex(files, [], known, roots); lastFiles = files; rootsKey = key;
      }
      return audio;
    },
    native(version: number, maps: Map<string, Map<string, string>>, known: string[], roots: Record<string, string>) {
      const key = JSON.stringify(roots);
      if (!native || nativeVersion !== version || rootsKey !== key) {
        const entries = [...maps.values()].flatMap(map => [...map].map(([relative, path]) => ({ relative, path })));
        native = createIdentityIndex(entries, f => f.relative, roots, known); nativeVersion = version; rootsKey = key;
      }
      return native;
    },
    library(sources: Source[]) {
      const seen = new Set<string>();
      return buildLibrary(sources.flatMap(s => s.tracks).filter(t => { if (seen.has(t.filePath)) return false; seen.add(t.filePath); return true; }));
    },
  };
}