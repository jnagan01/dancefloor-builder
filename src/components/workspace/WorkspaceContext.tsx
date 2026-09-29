import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildLibrary, mergeLibraries, tracksFromAudioFiles, pickDirectoryFiles, type VdjLibrary, type VdjTrack } from "@/lib/virtualDj";
import { loadMusicLibrary, saveMusicLibrary } from "@/lib/libraryStore";
import { toast } from "sonner";

type Source = { label: string; tracks: VdjTrack[] };
type Workspace = {
  sources: Source[]; files: File[]; library: VdjLibrary | null; loading: boolean;
  addFolder: () => Promise<void>; rescan: () => Promise<void>; removeSource: (index: number) => void; addFile: (file: File) => void;
  editTrack: (source: number, index: number, patch: Partial<VdjTrack>) => void;
};
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return;
      const id = data.user?.id;
      if (!id) { setLoading(false); return; }
      const saved = await loadMusicLibrary(id);
      if (!active) return;
      setSources(saved?.sources ?? []);
      setUserId(id);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (userId && !loading) void saveMusicLibrary(sources, userId);
  }, [sources, userId, loading]);
  const library = useMemo(() => sources.length ? mergeLibraries(sources.map(s => buildLibrary(s.tracks))) : null, [sources]);
  async function addFolder() {
    const picked = await pickDirectoryFiles();
    const audio = picked.filter(f => /\.(mp3|m4a|wav|flac|ogg|aac|aiff?|wma|opus|alac)$/i.test(f.name));
    if (!audio.length) { toast.error("No audio files found in that folder"); return; }
    const label = (audio[0].webkitRelativePath || audio[0].name).split("/")[0];
    setSources(prev => [...prev.filter(s => s.label !== label), { label, tracks: tracksFromAudioFiles(audio) }]);
    setFiles(prev => [...prev.filter(f => (f.webkitRelativePath || f.name).split("/")[0] !== label), ...audio]);
    toast.success(`${audio.length} tracks indexed from ${label}`);
  }
  function addFile(file: File) {
    setSources(prev => {
      const label = "Manually picked files";
      const track = tracksFromAudioFiles([file])[0];
      if (!track) return prev;
      const source = prev.find(s => s.label === label);
      return [...prev.filter(s => s.label !== label), { label, tracks: [...(source?.tracks ?? []).filter(t => t.filePath !== track.filePath), track] }];
    });
    setFiles(prev => [...prev.filter(f => f.name !== file.name), file]);
  }
  return <Context.Provider value={{ sources, files, library, loading, addFolder, rescan: addFolder, addFile, removeSource: i => setSources(prev => prev.filter((_, j) => i !== j)), editTrack: (source, index, patch) => setSources(prev => prev.map((s, si) => si === source ? { ...s, tracks: s.tracks.map((t, ti) => ti === index ? { ...t, ...patch } : t) } : s)) }}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace not available");
  return value;
}
