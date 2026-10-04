import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildLibrary, mergeLibraries, tracksFromAudioFiles, pickDirectoryFiles, parseVdjDatabaseXml, setFolderRoot, getFolderRoots, cleanBpm, type VdjLibrary, type VdjTrack } from "@/lib/virtualDj";
import { loadMusicLibrary, saveMusicLibrary } from "@/lib/libraryStore";
import { readVdjDatabase, isDesktopApp, getNativeFilePath, chooseVdjRoot, getDefaultVdjRoot, vdjDatabaseIn, vdjPlaylistsIn, makeNativeDirHandle, supportsNativeScan, scanNativeFolder, chooseNativeMusicFolder, readNativeAudioFile, writeNativeTags } from "@/lib/desktopBridge";
import { pickDirectoryHandle } from "@/lib/virtualDj";
import { saveDirHandle, saveDirHandleMeta, loadDirHandle, verifyReadWrite, type AnyHandle } from "@/lib/dirHandleStore";
import { toast } from "sonner";

type Source = { label: string; tracks: VdjTrack[] };
type Workspace = {
  sources: Source[]; files: File[]; library: VdjLibrary | null; loading: boolean;
  addFolder: () => Promise<void>; rescan: () => Promise<void>; removeSource: (index: number) => void; addFile: (file: File) => void;
  editTrack: (source: number, index: number, patch: Partial<VdjTrack>) => void;
  /** Loads a remembered file from disk (desktop app) so it can be played. */
  ensureLocalFile: (filePath?: string) => Promise<File | null>;
  /** Writes edited details into the actual music file (desktop app). */
  saveTrackTags: (source: number, index: number, patch: Partial<VdjTrack>) => Promise<{ ok: boolean; error?: string }>;
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
/** Native scan entries → the shape the track indexer expects. */
const asFileLike = (files: ReadonlyArray<{ name: string; size?: number; relativePath: string; tags?: import("@/lib/virtualDj").AudioFileTags | null }>) =>
  files.map(f => ({ name: f.name, size: f.size, webkitRelativePath: f.relativePath, tags: f.tags }));
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
  async function syncVirtualDj(customPath?: string | null, silent = false) {
    if (!isDesktopApp()) return refreshBrowserVdj();
    setVdjSyncing(true);
    try {
      const result = await readVdjDatabase(customPath ?? vdjPath);
      if (!result.ok || !result.xml) { if (!silent) toast.error(result.error ?? "Couldn't read the VirtualDJ database."); return false; }
      if (result.path) { setVdjPath(result.path); localStorage.setItem(VDJ_PATH_KEY, result.path); }
      return applyVdjXml(result.xml, silent);
    } catch (e) {
      if (!silent) toast.error((e as Error).message);
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
  function applyVdjXml(xml: string, silent = false): boolean {
    {
      const tracks = parseVdjDatabaseXml(xml);
      if (!tracks.length) { if (!silent) toast.error("No tracks found in that VirtualDJ database."); return false; }
      const byName = new Map<string, VdjTrack>();
      for (const t of tracks) byName.set(basename(t.filePath), t);
      vdjInfo.current = byName;
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
      if (!silent) toast.success(`Synced ${tracks.length.toLocaleString()} VirtualDJ tracks · ${matched.toLocaleString()} matched in your folders`);
      return true;
    }
  }
  const autoScanned = useRef(false);
  const autoSynced = useRef(false);
  /** Last known VirtualDJ info by file name, so rescans keep play counts. */
  const vdjInfo = useRef(new Map<string, VdjTrack>());
  /** relative path / filename → full on-disk path, from native scans. */
  const nativePaths = useRef(new Map<string, string>());
  function indexNativeFiles(scanned: ReadonlyArray<{ name: string; path: string; relativePath: string }>) {
    for (const f of scanned) {
      nativePaths.current.set(f.relativePath.toLowerCase(), f.path);
      nativePaths.current.set(f.name.toLowerCase(), f.path);
    }
  }
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
  // and then re-read VirtualDJ so play counts are there without any manual refresh.
  useEffect(() => {
    if (loading || autoScanned.current || !supportsNativeScan()) return;
    const roots = getFolderRoots();
    if (!sources.some(s => roots[s.label])) return;
    autoScanned.current = true;
    void (async () => {
      await rescanNative(true);
      autoSynced.current = true;
      const root = localStorage.getItem(VDJ_ROOT_KEY);
      if (root) await syncVirtualDj(vdjDatabaseIn(root), true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, sources]);
  // Desktop app with a saved VirtualDJ folder but no scanned music folders.
  useEffect(() => {
    if (loading || autoSynced.current || autoScanned.current || !isDesktopApp()) return;
    const root = localStorage.getItem(VDJ_ROOT_KEY);
    if (!root) return;
    autoSynced.current = true;
    void syncVirtualDj(vdjDatabaseIn(root), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
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
      indexNativeFiles(result.files);
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
      indexNativeFiles(result.files);
      updates.set(source.label, tracksFromAudioFiles(asFileLike(result.files)));
    }
    if (updates.size) {
      setSources(prev => prev.map(s => {
        const fresh = updates.get(s.label);
        if (!fresh) return s;
        // Keep play counts, keys and BPM that came from VirtualDJ — audio tags don't carry them.
        const known = new Map<string, VdjTrack>();
        for (const t of s.tracks) known.set(basename(t.filePath), t);
        return { label: s.label, tracks: fresh.map(t => {
          const old = known.get(basename(t.filePath)) ?? vdjInfo.current.get(basename(t.filePath));
          if (!old) return t;
          return {
            ...t,
            playCount: t.playCount ?? old.playCount,
            lastPlayTime: t.lastPlayTime ?? old.lastPlayTime,
            key: t.key || old.key,
            bpm: t.bpm || old.bpm,
            genre: t.genre || old.genre,
            year: t.year || old.year,
          };
        }) };
      }));
      const total = [...updates.values()].reduce((n, t) => n + t.length, 0);
      if (!silent) toast.success(`${total.toLocaleString()} tracks re-read from your saved folders`);
    }
    if (problems.length && !silent) toast.error(problems[0]);
    return updates.size > 0;
  }
  async function rescan() {
    if (!sources.length) { await addFolder(); return; }
    if (supportsNativeScan() && (await rescanNative())) {
      const root = localStorage.getItem(VDJ_ROOT_KEY);
      if (root && isDesktopApp()) await syncVirtualDj(vdjDatabaseIn(root), true);
      return;
    }
    if (!files.length) { toast.info("Reconnect a music folder to rescan it."); await addFolder(); return; }
    const available = new Map<string, File[]>();
    for (const file of files) {
      const label = (file.webkitRelativePath || file.name).split("/")[0];
      available.set(label, [...(available.get(label) ?? []), file]);
    }
    setSources(prev => prev.map(source => available.has(source.label) ? { label: source.label, tracks: tracksFromAudioFiles(available.get(source.label) ?? []) } : source));
    toast.success("Connected music folders rescanned. Reconnect any other folders to scan them again.");
  }
  /**
   * Desktop app: pull a remembered track off disk on demand so it plays
   * without the folder having to be reconnected.
   */
  async function saveTrackTags(source: number, index: number, patch: Partial<VdjTrack>) {
    const track = sources[source]?.tracks[index];
    if (!track) return { ok: false, error: "Song not found." };
    const full = nativePaths.current.get(track.filePath.toLowerCase()) ?? nativePaths.current.get(basename(track.filePath));
    if (!full) return { ok: false, error: "Rescan this music folder in the Mac app first." };
    const fields = ["title", "artist", "album", "genre", "year", "bpm", "key", "comment"] as const;
    const tags: Record<string, string> = {};
    for (const k of fields) if (patch[k] !== undefined) tags[k] = String(patch[k] ?? "");
    const res = await writeNativeTags(full, tags);
    if (!res.ok) return { ok: false, error: res.error };
    const t = res.tags ?? {};
    const year = t.year || undefined;
    setSources(prev => prev.map((s, si) => si === source ? { ...s, tracks: s.tracks.map((tr, ti) => ti === index ? {
      ...tr,
      title: t.title || tr.title, artist: t.artist || tr.artist,
      album: t.album || undefined, genre: t.genre || undefined, year,
      decade: year && /^\d{4}$/.test(year) ? `${year.slice(0, 3)}0s` : tr.decade,
      bpm: cleanBpm(t.bpm), key: t.key || undefined, comment: t.comment || undefined, fromTags: true,
    } : tr) } : s));
    return { ok: true };
  }
  async function ensureLocalFile(filePath?: string): Promise<File | null> {
    if (!filePath) return null;
    const existing = files.find(f => (f.webkitRelativePath || f.name) === filePath || f.name === filePath.split(/[\\/]/).pop());
    if (existing) return existing;
    const full = nativePaths.current.get(filePath.toLowerCase()) ?? nativePaths.current.get(basename(filePath));
    if (!full) return null;
    const file = await readNativeAudioFile(full, filePath);
    if (file) setFiles(prev => [...prev.filter(f => (f.webkitRelativePath || f.name) !== filePath), file]);
    return file;
  }
  function addFile(file: File): string {
    // Files inside a connected music folder join that folder; only files from
    // anywhere else go to "Manually picked files".
    const owner = folderForPath(getNativeFilePath(file), getFolderRoots())
      ?? (file.webkitRelativePath && sources.some(s => s.label === file.webkitRelativePath.split("/")[0])
        ? { label: file.webkitRelativePath.split("/")[0], relativePath: file.webkitRelativePath } : null);
    const label = owner?.label ?? "Manually picked files";
    const rel = owner?.relativePath ?? (file.webkitRelativePath || file.name);
    const track = tracksFromAudioFiles([{ name: file.name, size: file.size, webkitRelativePath: rel }])[0];
    if (!track) return rel;
    setSources(prev => {
      const source = prev.find(s => s.label === label);
      const tracks = [...(source?.tracks ?? []).filter(t => t.filePath !== track.filePath), track];
      return source ? prev.map(s => s.label === label ? { ...s, tracks } : s) : [...prev, { label, tracks }];
    });
    const wrapped = rel === (file.webkitRelativePath || file.name) ? file : new File([file], file.name, { type: file.type, lastModified: file.lastModified });
    if (wrapped !== file) Object.defineProperty(wrapped, "webkitRelativePath", { value: rel });
    setFiles(prev => [...prev.filter(f => (f.webkitRelativePath || f.name) !== rel), wrapped]);
    return rel;
  }
  return <Context.Provider value={{ sources, files, library, loading, vdjSyncedAt, vdjPath, vdjSyncing, syncVirtualDj, vdjRoot, vdjTrackCount, chooseVdjFolder, useDefaultVdjFolder, refreshVdj, addFolder, rescan, addFile, ensureLocalFile, saveTrackTags, removeSource: i => setSources(prev => prev.filter((_, j) => i !== j)), editTrack: (source, index, patch) => setSources(prev => prev.map((s, si) => si === source ? { ...s, tracks: s.tracks.map((t, ti) => ti === index ? { ...t, ...patch } : t) } : s)) }}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace not available");
  return value;
}
