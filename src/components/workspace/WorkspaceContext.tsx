import { saveBackup } from "@/lib/backupClient";
import { prepareOfflineAccess, reportOfflineSession, type OfflineStatus } from "@/lib/offlineAccess";
import { lockUpdateEditing } from "@/lib/updatePreservation";
import { previewMetadataRestore, validateBackup, type Backup } from "@/lib/backups";
import { readEventSnapshot } from "@/lib/snapshotSafety";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildLibrary, mergeLibraries, tracksFromAudioFiles, pickDirectoryFiles, parseVdjDatabaseXmlDetailed, setFolderRoot, getFolderRoots, folderForPath, resolveExportPath, folderRootsProblem, cleanBpm, type VdjLibrary, type VdjTrack } from "@/lib/virtualDj";
import { loadMusicLibrary, saveMusicLibrary } from "@/lib/libraryStore";
import { readVdjDatabase, isDesktopApp, getNativeFilePath, chooseVdjRoot, getDefaultVdjRoot, vdjDatabaseIn, vdjPlaylistsIn, makeNativeDirHandle, supportsNativeScan, scanNativeFolder, chooseNativeMusicFolder, readNativeAudioFile, writeNativeTags, rememberNativeFilePath } from "@/lib/desktopBridge";
import { pickDirectoryHandle } from "@/lib/virtualDj";
import { saveDirHandle, saveDirHandleMeta, loadDirHandle, verifyReadWrite, type AnyHandle } from "@/lib/dirHandleStore";
import { toast } from "sonner";
import { buildAudioIndex, resolveAudioFile, type AudioIndex } from "@/lib/audioMatch";
import { allocateSourceLabel, relabelScan, normalizeFilePath, trackIdentity, createIdentityIndex } from "@/lib/fileIdentity";
import { metadataResolver, mergeTrackMetadata, carryRescanMetadata, vdjSyncSummary } from "@/lib/trackMetadataIdentity";
import { withoutSourceFiles, cachedFileIdentity } from "@/lib/workspaceFileCache";
import { createWorkspaceIndexes } from "@/lib/workspaceIndexes";
import { createTrackRevisions } from "@/lib/trackRevisions";
import { nativeScanProblem } from "@/lib/nativeScanSafety";
import { prepStore } from "@/lib/prep/prepStore";
import { noteDrafts } from "@/lib/prep/noteDrafts";
import type { EventPrep } from "@/lib/prep/knowledge";

type Source = { label: string; tracks: VdjTrack[] };
type Workspace = {
  /** Signed-in account id for account-scoped app-only data. */
  account: string | null;
  sources: Source[]; files: File[]; audioIndex: AudioIndex; library: VdjLibrary | null; loading: boolean; persistenceError: string | null;
  backup: () => Promise<Backup>; restoreMetadata: (backup: Backup) => Promise<void>; restorePrep: (backup: Backup) => Promise<number>; carryPrepToNewEvent: (entry: EventPrep, newEventId: string) => Promise<number>; prepareOffline: () => Promise<OfflineStatus>;
  addFolder: () => Promise<void>; rescan: () => Promise<void>; removeSource: (index: number) => void; addFile: (file: File) => string;
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
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const persistenceBlocked = useRef(false);
  const [indexes] = useState(createWorkspaceIndexes);
  const [revisions] = useState(createTrackRevisions);
  useEffect(() => {
    const problem = folderRootsProblem();
    if (problem) toast.error(problem);
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
      const report = parseVdjDatabaseXmlDetailed(xml);
      const tracks = report.tracks;
      if (!tracks.length) { if (!silent) toast.error("No tracks found in that VirtualDJ database."); return false; }
      vdjInfo.current = tracks;
      const roots = getFolderRoots();
      // Count from the current library synchronously: React may defer the
      // functional update below, so counting inside it reported 0 matches.
      const summary = vdjSyncSummary(tracks, sourcesRef.current, roots);
      setSources(prev => {
        const resolver = metadataResolver(tracks, prev.flatMap(s => s.tracks), roots);
        return prev.map(source => ({ ...source, tracks: source.tracks.map(track => mergeTrackMetadata(track, resolver.resolve(track.filePath), true)) }));
      });
      const at = Date.now();
      setVdjSyncedAt(at);
      localStorage.setItem(VDJ_SYNC_KEY, String(at));
      setVdjTrackCount(tracks.length);
      localStorage.setItem(VDJ_COUNT_KEY, String(tracks.length));
      if (report.skippedCount) console.warn("VirtualDJ database entries skipped (line: reason)", report.skipped.map(s => `${s.line}: ${s.reason}`));
      if (!silent) {
        toast.success(`Synced ${tracks.length.toLocaleString()} VirtualDJ tracks · ${summary.matched.toLocaleString()} matched in your folders · ${summary.withLength.toLocaleString()} with length`);
        if (report.mode === "recovered" && report.skippedCount) toast.warning(`${report.skippedCount.toLocaleString()} damaged VirtualDJ ${report.skippedCount === 1 ? "entry was" : "entries were"} skipped; those tracks keep their saved details.`);
      }
      return true;
    }
  }
  const autoScanned = useRef(false);
  const autoSynced = useRef(false);
  const vdjInfo = useRef<VdjTrack[]>([]);
  /** Native indexes are atomic and source-scoped; no basename aliases. */
  const nativePaths = useRef(new Map<string, Map<string, string>>());
  const fileCacheRevision = useRef(0);
  function indexNativeFiles(label: string, scanned: ReadonlyArray<{ path: string; relativePath: string }>) {
    fileCacheRevision.current += 1;
    nativePaths.current.set(label, new Map(scanned.map(f => [normalizeFilePath(f.relativePath), f.path])));
    setFiles(prev => withoutSourceFiles(prev, label, [], getFolderRoots()));
  }
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return;
      const id = data.user?.id;
      if (!id) { setLoading(false); return; }
      let saved;
      try { saved = await loadMusicLibrary(id); } catch (e) {
        persistenceBlocked.current = true;
        setPersistenceError((e as Error).message); toast.error((e as Error).message);
        setLoading(false); return;
      }
      if (!active) return;
      setSources(saved?.sources ?? []);
      setUserId(id);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (userId && !loading && !persistenceBlocked.current) void saveMusicLibrary(sources, userId).then(at => {
      if (!at) { setPersistenceError("Music index changes could not be saved on this device. Your previous saved index is preserved."); toast.error("Could not save music index changes. Check available device storage."); }
      else setPersistenceError(null);
    });
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
  const library = useMemo(() => sources.length ? indexes.library(sources) : null, [sources, indexes]);
  const knownPaths = indexes.paths(sources);
  const audioIndex = indexes.audio(files, knownPaths, getFolderRoots());
  const backupSession = useRef({ account: userId, liveAccount: undefined as string | null | undefined, generation: 0, sources });
  if (backupSession.current.account !== userId) backupSession.current.generation++;
  backupSession.current.account = userId; backupSession.current.sources = sources;
  useEffect(() => {
    const subscription = supabase.auth.onAuthStateChange?.((event, session) => { backupSession.current.generation++; backupSession.current.liveAccount = session?.user.id ?? null; const liveId = session?.user.id ?? null; if (!liveId) { noteDrafts.clearAll(); void prepStore().setAccount(null); } else if (event === "SIGNED_IN" || event === "USER_UPDATED" || prepStore().get().account !== liveId) void prepStore().setAccount(liveId, true); reportOfflineSession(event, session?.user.id); });
    return () => { backupSession.current.generation++; subscription?.data.subscription.unsubscribe(); };
  }, []);
  function captureBackupOwner() {
    if (!userId || loading || persistenceBlocked.current || (backupSession.current.account !== userId || (backupSession.current.liveAccount !== undefined && backupSession.current.liveAccount !== userId))) throw Error("Sign in and resolve unreadable library data before backup.");
    // userId was just verified as the live session account, so it is safe to start loading its
    // notes here (startup backups can run before the effect below); backupSection waits for the load.
    if (prepStore().get().account !== userId) void prepStore().setAccount(userId);
    const prepOwner = prepStore().owner();
    if (!prepOwner || prepOwner.account !== userId) throw Error("Preparation notes are not loaded for this account yet. Try again in a moment.");
    const owner = { account: userId, generation: backupSession.current.generation, prepOwner, sources: structuredClone(sources), roots: structuredClone(getFolderRoots()) };
    const check = () => {
      const p = prepStore().get(); if (p.account !== owner.account || p.generation !== prepOwner.generation) throw Error("Account/session changed; operation stopped.");
      if (backupSession.current.account !== owner.account || backupSession.current.generation !== owner.generation || (backupSession.current.liveAccount !== undefined && backupSession.current.liveAccount !== owner.account)) throw Error("Account/session changed; operation stopped.");
    };
    check(); return { ...owner, check };
  }
  async function backup(): Promise<Backup> {
    const owner = captureBackupOwner();
    // Read-only owner-scoped collection. No remote writes, credentials or audio.
    const { data, error } = await supabase.from("workflow_history").select("id,name,inputs,lists").eq("user_id", owner.account).limit(501);
    owner.check();
    if (error || !data || data.length > 500) throw Error("Could not read all events for backup. Operation stopped.");
    const events = data.map(row => {
      const snapshot = { name: row.name, inputs: row.inputs, lists: row.lists };
      readEventSnapshot(snapshot); return { id: row.id, snapshot };
    });
    const prep = await prepStore().backupSection(owner.prepOwner); owner.check();
    const b = { format: "setarchitect-backup" as const, version: 1 as const, account: owner.account, createdAt: new Date().toISOString(), events, sources: owner.sources, roots: owner.roots, ...(prep ? { prep } : {}) } as Backup;
    validateBackup(JSON.stringify(b), owner.account); owner.check();
    await saveBackup(b); owner.check(); return b;
  }
  useEffect(() => {
    if (!isDesktopApp()) return;
    const host = window as unknown as { __setarchitectBeforeUpdate?: () => Promise<void> };
    const capture = async () => {
      const lock = lockUpdateEditing();
      try {
        const saved = await backup();
        if (JSON.stringify(backupSession.current.sources) !== JSON.stringify(saved.sources) || JSON.stringify(getFolderRoots()) !== JSON.stringify(saved.roots)) throw Error("Library changed while preparing the update. Try again; nothing installed.");
        lock.checkpoint();
      } catch (error) { lock.release(); throw error; }
    };
    host.__setarchitectBeforeUpdate = capture;
    return () => { if (host.__setarchitectBeforeUpdate === capture) delete host.__setarchitectBeforeUpdate; };
  }, [userId, loading, sources]);
  async function prepareOffline() {
    const owner = captureBackupOwner();
    return prepareOfflineAccess(owner, backup);
  }
  async function restoreMetadata(b: Backup) {
    const owner = captureBackupOwner();
    const imported = validateBackup(JSON.stringify(b), owner.account);
    await backup(); owner.check();
    if (JSON.stringify(backupSession.current.sources) !== JSON.stringify(owner.sources) || JSON.stringify(getFolderRoots()) !== JSON.stringify(owner.roots)) throw Error("Library changed during restore; preview again. Nothing replaced.");
    const plan = previewMetadataRestore(imported, owner.sources, owner.roots);
    owner.check();
    for (const [label, root] of Object.entries(plan.mappings)) setFolderRoot(label, root);
    setSources(prev => { owner.check(); return [...prev, ...plan.additions.filter(source => !prev.some(s => s.label === source.label))]; });
    if (imported.prep) { owner.check(); await prepStore().restoreAdditive(owner.prepOwner, imported.prep); }
  }
  /** Preparation-only additive restore; works with zero library additions. A fresh backup is taken first. */
  async function restorePrep(b: Backup): Promise<number> {
    const owner = captureBackupOwner();
    const imported = validateBackup(JSON.stringify(b), owner.account);
    if (!imported.prep) return 0;
    await backup(); owner.check();
    return prepStore().restoreAdditive(owner.prepOwner, imported.prep);
  }
  async function carryPrepToNewEvent(entry: EventPrep, newEventId: string): Promise<number> {
    const owner = captureBackupOwner();
    return prepStore().carryToNewEvent(owner.prepOwner, entry, newEventId);
  }
  async function addFolder() {
    const rootProblem = folderRootsProblem();
    if (rootProblem) { toast.error(rootProblem); return; }
    const scanStart = revisions.now();
    if (supportsNativeScan()) {
      const root = await chooseNativeMusicFolder();
      if (!root) return;
      try { await backup(); } catch (e) { toast.error((e as Error).message); return; }
      const result = await scanNativeFolder(root);
      const actualRoot = result.root ?? root;
      const label = allocateSourceLabel(result.label ?? root.split("/").filter(Boolean).pop() ?? "Music", actualRoot, sources.map(s => s.label), getFolderRoots());
      const problem = nativeScanProblem(result, sources.find(s => s.label === label)?.tracks.length ?? 0);
      if (problem || !result.files?.length) { toast.error(problem ?? "No audio files found in that folder"); return; }
      const scanned = relabelScan(result.files, label);
      setFolderRoot(label, actualRoot);
      indexNativeFiles(label, scanned);
      setSources(prev => {
        const old = prev.find(s => s.label === label);
        const resolver = metadataResolver(old?.tracks ?? [], old?.tracks ?? [], getFolderRoots());
        const tracks = tracksFromAudioFiles(asFileLike(scanned)).map(t => reconcileScan(label, t, resolver.resolve(t.filePath), undefined, scanStart));
        return old ? prev.map(s => s.label === label ? { label, tracks } : s) : [...prev, { label, tracks }];
      });
      toast.success(`${scanned.length} tracks indexed from ${label}`);
      return;
    }
    const picked = await pickDirectoryFiles();
    const audio = picked.filter(f => /\.(mp3|m4a|wav|flac|ogg|aac|aiff?|wma|opus|alac)$/i.test(f.name));
    if (!audio.length) { toast.error("No audio files found in that folder"); return; }
    const name = (audio[0].webkitRelativePath || audio[0].name).split("/")[0];
    // Without absolute roots the browser cannot prove two same-named folders are identical.
    const label = allocateSourceLabel(name, null, sources.map(s => s.label), getFolderRoots());
    const wrapped = audio.map(file => wrapFile(file, `${label}/${(file.webkitRelativePath || file.name).split("/").slice(1).join("/") || file.name}`));
    setSources(prev => [...prev, { label, tracks: tracksFromAudioFiles(wrapped) }]);
    setFiles(prev => [...prev, ...wrapped]);
    toast.success(`${audio.length} tracks indexed from ${label}`);
  }
  /** Re-reads every remembered folder from disk (desktop app only). */
  async function rescanNative(silent = false): Promise<boolean> {
    try { await backup(); } catch (e) { toast.error((e as Error).message); return false; }
    const roots = getFolderRoots();
    const scanStart = revisions.now();
    const targets = sources.filter(s => roots[s.label]);
    const generations = new Map(targets.map(s => [s.label, revisions.generation(s.label)]));
    if (!targets.length) return false;
    const updates = new Map<string, VdjTrack[]>();
    const problems: string[] = [];
    for (const source of targets) {
      const result = await scanNativeFolder(roots[source.label]);
      if (revisions.generation(source.label) !== generations.get(source.label)) continue;
      const problem = nativeScanProblem(result, source.tracks.length);
      if (problem || !result.files) { problems.push(`${source.label}: ${problem ?? "couldn't be read"}`); continue; }
      const scanned = relabelScan(result.files, source.label);
      indexNativeFiles(source.label, scanned);
      updates.set(source.label, tracksFromAudioFiles(asFileLike(scanned)));
    }
    if (updates.size) {
      setSources(prev => {
        const allTracks = prev.flatMap(source => source.tracks);
        const known = metadataResolver(allTracks, allTracks, roots);
        const vdj = metadataResolver(vdjInfo.current, allTracks, roots);
        return prev.map(s => {
          const fresh = updates.get(s.label);
          if (!fresh) return s;
          return { label: s.label, tracks: fresh.map(t => reconcileScan(s.label, t, known.resolve(t.filePath), vdj.resolve(t.filePath), scanStart)) };
        });
      });
      const total = [...updates.values()].reduce((n, t) => n + t.length, 0);
      if (!silent) toast.success(`${total.toLocaleString()} tracks re-read from your saved folders`);
    }
    if (problems.length) toast.error(problems[0]);
    return updates.size > 0;
  }
  async function rescan() {
    if (!sources.length) { await addFolder(); return; }
    if (supportsNativeScan()) {
      const updated = await rescanNative();
      const root = localStorage.getItem(VDJ_ROOT_KEY);
      if (updated && root && isDesktopApp()) await syncVirtualDj(vdjDatabaseIn(root), true);
      return;
    }
    if (!files.length) { toast.info("Reconnect a music folder to rescan it."); await addFolder(); return; }
    const available = new Map<string, File[]>();
    for (const file of files) {
      const label = (file.webkitRelativePath || file.name).split("/")[0];
      let bucket = available.get(label);
      if (!bucket) { bucket = []; available.set(label, bucket); }
      bucket.push(file);
    }
    setSources(prev => {
      const all = prev.flatMap(s => s.tracks), known = metadataResolver(all, all, getFolderRoots());
      return prev.map(source => available.has(source.label) ? { label: source.label, tracks: tracksFromAudioFiles(available.get(source.label) ?? []).map(t => {
        const old = known.resolve(t.filePath); return old ?? t;
      }) } : source);
    });
    toast.success("Connected music folders rescanned. Reconnect any other folders to scan them again.");
  }
  /**
   * Desktop app: pull a remembered track off disk on demand so it plays
   * without the folder having to be reconnected.
   */
  async function saveTrackTags(source: number, index: number, patch: Partial<VdjTrack>) {
    const sourceLabel = sources[source]?.label;
    const track = sources[source]?.tracks[index];
    if (!track || !sourceLabel) return { ok: false, error: "Song not found." };
    const full = exactNativePath(track.filePath);
    if (!full) return { ok: false, error: "Rescan this music folder in the Mac app first." };
    const roots = getFolderRoots();
    const identity = trackIdentity(track.filePath, roots);
    const generation = revisions.generation(sourceLabel);
    const revision = revisions.bump(sourceLabel, track.filePath, roots);
    const fields = ["title", "artist", "album", "genre", "year", "bpm", "key", "comment"] as const;
    const tags: Record<string, string> = {};
    for (const k of fields) if (patch[k] !== undefined) tags[k] = String(patch[k] ?? "");
    const res = await writeNativeTags(full, tags);
    if (!res.ok) return { ok: false, error: res.error };
    const t = res.tags ?? {};
    const year = t.year || undefined;
    if (revisions.generation(sourceLabel) !== generation || revisions.revision(sourceLabel, track.filePath, roots) !== revision) return { ok: true };
    // Completion is a separate edit boundary: a scan may have started after the request.
    const completedRevision = revisions.bump(sourceLabel, track.filePath, roots);
    setSources(prev => {
      if (revisions.generation(sourceLabel) !== generation || revisions.revision(sourceLabel, track.filePath, roots) !== completedRevision) return prev;
      return prev.map(s => s.label === sourceLabel ? { ...s, tracks: s.tracks.map(tr => trackIdentity(tr.filePath, roots) === identity ? {
      ...tr,
      title: t.title || tr.title, artist: t.artist || tr.artist,
      album: t.album || undefined, genre: t.genre || undefined, year,
      decade: year && /^\d{4}$/.test(year) ? `${year.slice(0, 3)}0s` : tr.decade,
      bpm: cleanBpm(t.bpm), key: t.key || undefined, comment: t.comment || undefined, fromTags: true,
    } : tr) } : s);
    });
    return { ok: true };
  }
  function exactNativePath(filePath: string): string | null {
    const roots = getFolderRoots();
    const selected = indexes.native(fileCacheRevision.current, nativePaths.current, knownPaths, roots).resolve(filePath);
    if (selected) return selected.path;
    return resolveExportPath(filePath, roots);
  }
  async function ensureLocalFile(filePath?: string): Promise<File | null> {
    if (!filePath) return null;
    const existing = resolveAudioFile(audioIndex, { filePath });
    if (existing) return existing;
    const full = exactNativePath(filePath);
    if (!full) return null;
    const revision = fileCacheRevision.current;
    const file = await readNativeAudioFile(full, filePath);
    if (revision !== fileCacheRevision.current) return null;
    if (file) setFiles(prev => [...prev.filter(f => cachedFileIdentity(f, getFolderRoots()) !== trackIdentity(full, getFolderRoots())), file]);
    return file;
  }
  function wrapFile(file: File, rel: string): File {
    if (rel === (file.webkitRelativePath || file.name)) return file;
    const wrapped = new File([file], file.name, { type: file.type, lastModified: file.lastModified });
    Object.defineProperty(wrapped, "webkitRelativePath", { value: rel });
    rememberNativeFilePath(wrapped, getNativeFilePath(file));
    return wrapped;
  }
  function removeSource(index: number) {
    const source = sources[index];
    if (!source) return;
    fileCacheRevision.current += 1;
    revisions.remove(source.label);
    nativePaths.current.delete(source.label);
    setFiles(prev => withoutSourceFiles(prev, source.label, source.tracks.map(t => t.filePath), getFolderRoots()));
    setSources(prev => prev.filter((_, i) => i !== index));
    // Keep the retired root mapping reserved for existing saved-event references.
  }
  function addFile(file: File): string {
    // Files inside a connected music folder join that folder; only files from
    // anywhere else go to "Manually picked files".
    const owner = folderForPath(getNativeFilePath(file), getFolderRoots())
      ?? (file.webkitRelativePath && sources.some(s => s.label === file.webkitRelativePath.split("/")[0])
        ? { label: file.webkitRelativePath.split("/")[0], relativePath: file.webkitRelativePath } : null);
    const label = owner?.label ?? "Manually picked files";
    const rel = owner?.relativePath ?? (getNativeFilePath(file) || file.webkitRelativePath || file.name);
    const track = tracksFromAudioFiles([{ name: file.name, size: file.size, webkitRelativePath: rel }])[0];
    if (!track) return rel;
    setSources(prev => {
      const source = prev.find(s => s.label === label);
      const tracks = [...(source?.tracks ?? []).filter(t => t.filePath !== track.filePath), track];
      return source ? prev.map(s => s.label === label ? { ...s, tracks } : s) : [...prev, { label, tracks }];
    });
    const wrapped = wrapFile(file, rel);
    setFiles(prev => [...prev.filter(f => (f.webkitRelativePath || f.name) !== rel), wrapped]);
    return rel;
  }
  function reconcileScan(label: string, fresh: VdjTrack, old: VdjTrack | undefined, vdj: VdjTrack | undefined, start: number) {
    if (old && revisions.changedSince(label, old, getFolderRoots(), start)) return old;
    return carryRescanMetadata(fresh, old, vdj);
  }
  function editTrack(source: number, index: number, patch: Partial<VdjTrack>) {
    const selected = sources[source], track = selected?.tracks[index];
    if (!selected || !track) return;
    const roots = getFolderRoots(), identity = trackIdentity(track.filePath, roots);
    revisions.bump(selected.label, track.filePath, roots);
    setSources(prev => prev.map(s => s.label === selected.label ? { ...s, tracks: s.tracks.map(t => trackIdentity(t.filePath, roots) === identity ? { ...t, ...patch, filePath: t.filePath } : t) } : s));
  }
  useEffect(() => { void prepStore().setAccount(userId); }, [userId, loading]);
  return <Context.Provider value={{ account: userId, sources, files, audioIndex, library, loading, persistenceError, vdjSyncedAt, vdjPath, vdjSyncing, syncVirtualDj, vdjRoot, vdjTrackCount, chooseVdjFolder, useDefaultVdjFolder, refreshVdj, backup, restoreMetadata, restorePrep, carryPrepToNewEvent, prepareOffline, addFolder, rescan, addFile, ensureLocalFile, saveTrackTags, removeSource, editTrack }}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace not available");
  return value;
}
