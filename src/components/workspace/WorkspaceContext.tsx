import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildLibrary, mergeLibraries, tracksFromAudioFiles, pickDirectoryFiles, parseVdjDatabaseXml, setFolderRoot, getFolderRoots, type VdjLibrary, type VdjTrack } from "@/lib/virtualDj";
import { loadMusicLibrary, saveMusicLibrary } from "@/lib/libraryStore";
import { readVdjDatabase, isDesktopApp, getNativeFilePath, chooseVdjRoot, getDefaultVdjRoot, vdjDatabaseIn, vdjPlaylistsIn, makeNativeDirHandle, supportsNativeScan, scanNativeFolder, chooseNativeMusicFolder } from "@/lib/desktopBridge";
import { pickDirectoryHandle } from "@/lib/virtualDj";
import { saveDirHandle, saveDirHandleMeta, loadDirHandle, verifyReadWrite, type AnyHandle } from "@/lib/dirHandleStore";
import { toast } from "sonner";

type Source = { label: string; tracks: VdjTrack[] };
type Workspace = {
  sources: Source[]; files: File[]; library: VdjLibrary | null; loading: boolean;
  addFolder: () => Promise<void>; rescan: () => Promise<void>; removeSource: (index: number) => void; addFile: (file: File) => void;
  editTrack: (source: number, index: number, patch: Partial<VdjTrack>) => void;
  vdjSyncedAt: number | null; vdjPath: string | null; vdjSyncing: boolean;
  syncVirtualDj: (customPath?: string | null) => Promise<boolean>;
  vdjRoot: string | null; vdjTrackCount: number | null;
  chooseVdjFolder: () => Promise<void>; useDefaultVdjFolder: () => Promise<void>; refreshVdj: () => Promise<void>;
};
export const VDJ_ROOT_KEY = "dancefloor:vdjRoot";
export const VDJ_COUNT_KEY = "dancefloor:vdjTrackCount";
export const VDJ_EXPORT_KEY = "vdjExportFolder";
const VDJ_ROOT_HANDLE_KEY = "vdjRootFolder";
type BrowserDir = AnyHandle & {
  getFileHandle(n: string): Promise<{ getFile(): Promise<File> }>;
  getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<AnyHandle>;
};
export const VDJ_PATH_KEY = "dancefloor:vdjDatabasePath";
export const VDJ_SYNC_KEY = "dancefloor:vdjSyncedAt";
const basename = (p: string) => (p.split(/[\\/]/).pop() ?? p).toLowerCase();
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [vdjSyncedAt, setVdjSyncedAt] = useState<number | null>(null);
  const [vdjPath, setVdjPath] = useState<string | null>(null);
  const [vdjSyncing, setVdjSyncing] = useState(false);
  const [vdjRoot, setVdjRoot] = useState<string | null>(null);
  const [vdjTrackCount, setVdjTrackCount] = useState<number | null>(null);
  useEffect(() => {
    const saved = Number(localStorage.getItem(VDJ_SYNC_KEY));
    if (saved) setVdjSyncedAt(saved);
    const path = localStorage.getItem(VDJ_PATH_KEY);
    setVdjPath(path);
    const count = Number(localStorage.getItem(VDJ_COUNT_KEY));
    if (count) setVdjTrackCount(count);
    // Migrate: older versions stored only the database file path.
    const root = localStorage.getItem(VDJ_ROOT_KEY) ?? (path ? path.replace(/[\\/]database\.xml$/i, "") : null);
    setVdjRoot(root);
  }, []);
  async function syncVirtualDj(customPath?: string | null) {
    if (!isDesktopApp()) return refreshBrowserVdj();
    setVdjSyncing(true);
    try {
      const result = await readVdjDatabase(customPath ?? vdjPath);
      if (!result.ok || !result.xml) { toast.error(result.error ?? "Couldn't read the VirtualDJ database."); return false; }
      if (result.path) { setVdjPath(result.path); localStorage.setItem(VDJ_PATH_KEY, result.path); }
      return applyVdjXml(result.xml);
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setVdjSyncing(false);
    }
  }
  async function linkRoot(root: string, hasDatabase: boolean) {
    setVdjRoot(root);
    localStorage.setItem(VDJ_ROOT_KEY, root);
    const exportDir = makeNativeDirHandle(vdjPlaylistsIn(root));
    await saveDirHandle(VDJ_EXPORT_KEY, exportDir);
    await saveDirHandleMeta(VDJ_EXPORT_KEY, { savedAt: Date.now() });
    if (!hasDatabase) { toast.error("No VirtualDJ database in that folder — pick the main VirtualDJ folder."); return; }
    await syncVirtualDj(vdjDatabaseIn(root));
  }
  async function chooseVdjFolder() {
    try {
      if (isDesktopApp()) {
        const picked = await chooseVdjRoot();
        if (picked) await linkRoot(picked.path, picked.hasDatabase);
        return;
      }
      const handle = (await pickDirectoryHandle()) as unknown as BrowserDir | null;
      if (!handle) return;
      await saveDirHandle(VDJ_ROOT_HANDLE_KEY, handle);
      const name = handle.name ?? "VirtualDJ";
      setVdjRoot(name);
      localStorage.setItem(VDJ_ROOT_KEY, name);
      await readBrowserFolder(handle);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function useDefaultVdjFolder() {
    if (!isDesktopApp()) { toast.info("Pick your VirtualDJ folder with Change folder — the browser can't open it automatically."); return; }
    const root = await getDefaultVdjRoot();
    if (root) await linkRoot(root, true);
  }
  async function readBrowserFolder(handle: BrowserDir) {
    setVdjSyncing(true);
    try {
      const playlists = await handle.getDirectoryHandle("Playlists", { create: true });
      await saveDirHandle(VDJ_EXPORT_KEY, playlists);
      await saveDirHandleMeta(VDJ_EXPORT_KEY, { savedAt: Date.now() });
      let xml: string;
      try { xml = await (await (await handle.getFileHandle("database.xml")).getFile()).text(); }
      catch { toast.error("No VirtualDJ database in that folder — pick the main VirtualDJ folder."); return false; }
      return applyVdjXml(xml);
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setVdjSyncing(false);
    }
  }
  async function refreshBrowserVdj() {
    const handle = (await loadDirHandle(VDJ_ROOT_HANDLE_KEY)) as BrowserDir | null;
    if (!handle) { toast.info("Choose your VirtualDJ folder first."); return false; }
    if (!(await verifyReadWrite(handle))) { toast.error("Permission to that folder was not granted."); return false; }
    return readBrowserFolder(handle);
  }
  async function refreshVdj() {
    if (isDesktopApp()) await syncVirtualDj(vdjRoot ? vdjDatabaseIn(vdjRoot) : null);
    else await refreshBrowserVdj();
  }
  function applyVdjXml(xml: string): boolean {
    {
      const tracks = parseVdjDatabaseXml(xml);
      if (!tracks.length) { toast.error("No tracks found in that VirtualDJ database."); return false; }
      const byName = new Map<string, VdjTrack>();
      for (const t of tracks) byName.set(basename(t.filePath), t);
      let matched = 0;
      setSources(prev => prev.map(source => ({
        ...source,
        tracks: source.tracks.map(track => {
          const info = byName.get(basename(track.filePath));
          if (!info) return track;
          matched += 1;
          return {
            ...track,
            playCount: info.playCount ?? track.playCount,
            lastPlayTime: info.lastPlayTime ?? track.lastPlayTime,
            key: info.key || track.key,
            bpm: info.bpm || track.bpm,
            genre: info.genre || track.genre,
            year: info.year || track.year,
          };
        }),
      })));
      const at = Date.now();
      setVdjSyncedAt(at);
      localStorage.setItem(VDJ_SYNC_KEY, String(at));
      setVdjTrackCount(tracks.length);
      localStorage.setItem(VDJ_COUNT_KEY, String(tracks.length));
      toast.success(`Synced ${tracks.length.toLocaleString()} VirtualDJ tracks · ${matched.toLocaleString()} matched in your folders`);
      return true;
    }
  }
  const autoScanned = useRef(false);
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
  // Desktop app: silently re-read remembered music folders from disk on launch
  // so nothing has to be reconnected.
  useEffect(() => {
    if (loading || autoScanned.current || !supportsNativeScan()) return;
    const roots = getFolderRoots();
    if (!sources.some(s => roots[s.label])) return;
    autoScanned.current = true;
    void rescanNative(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sources]);
  const library = useMemo(() => sources.length ? mergeLibraries(sources.map(s => buildLibrary(s.tracks))) : null, [sources]);
  async function addFolder() {
    // Desktop app: use the native picker so we learn the folder's real
    // location and can re-read it later without asking again.
    if (supportsNativeScan()) {
      const root = await chooseNativeMusicFolder();
      if (!root) return;
      const result = await scanNativeFolder(root);
      if (!result.ok || !result.files?.length) {
        toast.error(result.error ?? "No audio files found in that folder");
        return;
      }
      const label = result.label ?? root.split("/").filter(Boolean).pop() ?? "Music";
      setFolderRoot(label, result.root ?? root);
      setSources(prev => [...prev.filter(s => s.label !== label), { label, tracks: tracksFromAudioFiles(asFileLike(result.files ?? [])) }]);
      toast.success(`${result.files.length} tracks indexed from ${label}`);
      return;
    }
    const picked = await pickDirectoryFiles();
    const audio = picked.filter(f => /\.(mp3|m4a|wav|flac|ogg|aac|aiff?|wma|opus|alac)$/i.test(f.name));
    if (!audio.length) { toast.error("No audio files found in that folder"); return; }
    const label = (audio[0].webkitRelativePath || audio[0].name).split("/")[0];
    // Desktop app: learn the folder's full location so exports use full paths.
    const abs = getNativeFilePath(audio[0]);
    const rel = audio[0].webkitRelativePath || audio[0].name;
    if (abs && abs.replace(/\\/g, "/").endsWith(rel)) setFolderRoot(label, abs.slice(0, abs.length - rel.length) + label);
    setSources(prev => [...prev.filter(s => s.label !== label), { label, tracks: tracksFromAudioFiles(audio) }]);
    setFiles(prev => [...prev.filter(f => (f.webkitRelativePath || f.name).split("/")[0] !== label), ...audio]);
    toast.success(`${audio.length} tracks indexed from ${label}`);
  }
  /** Re-reads every remembered folder from disk (desktop app only). */
  async function rescanNative(silent = false): Promise<boolean> {
    const roots = getFolderRoots();
    const targets = sources.filter(s => roots[s.label]);
    if (!targets.length) return false;
    const updates = new Map<string, VdjTrack[]>();
    const problems: string[] = [];
    for (const source of targets) {
      const result = await scanNativeFolder(roots[source.label]);
      if (!result.ok || !result.files) { problems.push(`${source.label}: ${result.error ?? "couldn't be read"}`); continue; }
      updates.set(source.label, tracksFromAudioFiles(result.files));
    }
    if (updates.size) {
      setSources(prev => prev.map(s => updates.has(s.label) ? { label: s.label, tracks: updates.get(s.label) ?? s.tracks } : s));
      const total = [...updates.values()].reduce((n, t) => n + t.length, 0);
      if (!silent) toast.success(`${total.toLocaleString()} tracks re-read from your saved folders`);
    }
    if (problems.length && !silent) toast.error(problems[0]);
    return updates.size > 0;
  }
  async function rescan() {
    if (!sources.length) { await addFolder(); return; }
    if (supportsNativeScan() && (await rescanNative())) return;
    if (!files.length) { toast.info("Reconnect a music folder to rescan it."); await addFolder(); return; }
    const available = new Map<string, File[]>();
    for (const file of files) {
      const label = (file.webkitRelativePath || file.name).split("/")[0];
      available.set(label, [...(available.get(label) ?? []), file]);
    }
    setSources(prev => prev.map(source => available.has(source.label) ? { label: source.label, tracks: tracksFromAudioFiles(available.get(source.label) ?? []) } : source));
    toast.success("Connected music folders rescanned. Reconnect any other folders to scan them again.");
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
  return <Context.Provider value={{ sources, files, library, loading, vdjSyncedAt, vdjPath, vdjSyncing, syncVirtualDj, vdjRoot, vdjTrackCount, chooseVdjFolder, useDefaultVdjFolder, refreshVdj, addFolder, rescan, addFile, removeSource: i => setSources(prev => prev.filter((_, j) => i !== j)), editTrack: (source, index, patch) => setSources(prev => prev.map((s, si) => si === source ? { ...s, tracks: s.tracks.map((t, ti) => ti === index ? { ...t, ...patch } : t) } : s)) }}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace not available");
  return value;
}
