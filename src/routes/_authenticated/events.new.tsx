import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import JSZip from "jszip";
import {
  parseFile,
  dedupeSongs,
  dedupeKey,
  SongKeySet,
  generateLists,
  reorderForEnergyProgression,
  topUpSectionsFromLibrary,
  songsToCsv,
  combinedCsv,
  downloadBlob,
  formatMinutes,
  parseDoNotPlay,
  parseDoNotPlayFile,
  doNotPlayEntriesToText,
  normalizeKey,
  detectExplicitFromTitle,

  type Song,
  type GenerationResult,
  type Preferences,
  buildGapProfile,
  isFavoriteArtist,
  FAVORITE_ARTIST_CAP,
} from "@/lib/danceFloor";

import {
  buildLibrary,
  tracksFromAudioFiles,
  mergeLibraries,
  matchSong,
  searchLibrary,
  searchLibraryScored,

  buildTxtPlaylist,
  buildM3u,
  countUnresolvedPaths,
  resolveExportPath,
  pickDirectoryFiles,
  pickDirectoryHandle,
  writeFileToDir,
  supportsDirectoryWrite,
  type VdjLibrary,
  type VdjTrack,
  type SongMatch,
  type MatchStatus,
  type ExportSongRef,
} from "@/lib/virtualDj";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Trash2, Upload, Plus, Download, Music, AlertTriangle, FolderOpen, Search, X, Check, CheckCircle2, Sparkles, Database, HardDrive, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Map as MapIcon } from "lucide-react";
import { StepRail, type StepDef } from "@/components/builder/StepRail";
import { StepPanel } from "@/components/builder/StepPanel";

import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { DjAccountBar, type WorkflowSnapshot } from "@/components/HistoryPanel";
import { useServerFn } from "@tanstack/react-start";
import { recommendSongsForSection } from "@/lib/recommend.functions";
import { getArtistNeighbors } from "@/lib/neighbors.functions";
import { getArtistCrowdData, type ArtistCrowd } from "@/lib/lastfm.functions";
import { enrichSongs, type EnrichedSong } from "@/lib/enrich.functions";
import { type PreviewTarget } from "@/components/PreviewPlayer";
import { buildAudioIndex, resolveAudioFile, resolveAudioMatch, type AudioIndex } from "@/lib/audioMatch";
import { Play } from "lucide-react";
import { saveDirHandle, loadDirHandle, clearDirHandle, verifyReadWrite, saveDirHandleMeta, loadDirHandleMeta, clearDirHandleMeta } from "@/lib/dirHandleStore";
import { supabase } from "@/integrations/supabase/client";
import { buildRecommendExisting, nextWorkflowInstanceId } from "@/lib/workflowIsolation";
import { toCamelot, parseBpm } from "@/lib/musicTheory";
import type { ResultSong } from "@/lib/danceFloor";
import { ProfileSettingsDialog } from "@/components/ProfileSettingsDialog";
import { APP_VERSION, formatBuildDate } from "@/lib/appVersion";
import { useWorkspace } from "@/components/workspace/WorkspaceContext";
import { isDesktopApp, makeNativeDirHandle, vdjPlaylistsIn } from "@/lib/desktopBridge";
import { saveWorkflow, updateWorkflow, getWorkflow } from "@/lib/history.functions";
import { pageHead } from "@/lib/pageHead";
import { WaveformPlayer } from "@/components/workspace/WaveformPlayer";
import { jsPDF } from "jspdf";
import { MATCH_LIMIT_KEY, MATCH_AUTO_KEY, DJ_SOFTWARE_KEY } from "./settings";
import { UserCog } from "lucide-react";

const VDJ_DIR_KEY = "vdjExportFolder";

export const Route = createFileRoute("/_authenticated/events/new")({
  validateSearch: (search: Record<string, unknown>): { eventId?: string } => ({ eventId: typeof search.eventId === "string" ? search.eventId : undefined }),
  component: Index,
  head: () => pageHead("New event", "Build and review three dance floor playlists from your client song list."),
});

const DECADES = ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];

interface UploadStatus {
  id: string;
  name: string;
  state: "parsing" | "done" | "error";
  count?: number;
  message?: string;
}

function formatSavedAt(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

type SectionKey = "warmUp" | "transition" | "peak";
const SECTION_FILES: Record<SectionKey, string> = {
  warmUp: "warm-up",
  transition: "transition",
  peak: "peak",
};
const MAX_AI_RECOMMENDATION_BATCH_SIZE = 40;

interface DirHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<unknown>;
}

function Index() {
  const navigate = useNavigate();
  const { eventId: openedEventId } = Route.useSearch();
  const workspace = useWorkspace();
  const saveEventFn = useServerFn(saveWorkflow);
  const updateEventFn = useServerFn(updateWorkflow);
  const getEventFn = useServerFn(getWorkflow);
  const [savedEventId, setSavedEventId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle"|"saving"|"saved"|"error">("idle");
  const saveRevision = useRef(0);
  const restoredEvent = useRef(false);
  const [buffer, setBuffer] = useState(2);
  const [activeSection, setActiveSection] = useState<SectionKey>("warmUp");
  const [spotifyLink, setSpotifyLink] = useState("");
  const [matchLimit, setMatchLimit] = useState(10);
  const [matcherOn, setMatcherOn] = useState(true);
  const [software, setSoftware] = useState("VirtualDJ");
  const [reviewMode, setReviewMode] = useState<"first" | "most" | "all" | "none">("first");
  function applyReviewMode(mode: "first" | "most" | "all" | "none", section: SectionKey) {
    setReviewMode(mode);
    if (!result || !mergedLibrary) return;
    result[section].forEach((song, index) => {
      const key = songKey(section, index, song);
      if (mode === "none") { markUnresolved(key); return; }
      const found = searchLibrary(`${song.artist} ${song.song}`, mergedLibrary, mode === "all" ? matchLimit : 1);
      if (!found.length) return;
      const automatic = matchSong(song, mergedLibrary);
      updateMatch(key, { status: "Manually Matched", confidence: automatic.confidence, trackIndex: found[0], alternatives: [], extraTrackIndices: mode === "all" ? found.slice(1) : [] });
    });
  }
  useEffect(() => { setMatchLimit(Number(localStorage.getItem(MATCH_LIMIT_KEY))||10); setMatcherOn(localStorage.getItem(MATCH_AUTO_KEY)!=="false"); setSoftware(localStorage.getItem(DJ_SOFTWARE_KEY)||"VirtualDJ"); }, []);
  const [songs, setSongs] = useState<Song[]>([]);
  const [hours, setHours] = useState<string>("3");
  const [artistsInput, setArtistsInput] = useState("");
  const [genresInput, setGenresInput] = useState("");
  const [decades, setDecades] = useState<string[]>(["2000s", "2010s", "2020s"]);
  const [notes, setNotes] = useState("");
  const [doNotPlayInput, setDoNotPlayInput] = useState("");
  const [expand, setExpand] = useState(false);
  const [includeCombined, setIncludeCombined] = useState(false);
  const [eventName, setEventName] = useState("");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const recommendFn = useServerFn(recommendSongsForSection);
  const neighborsFn = useServerFn(getArtistNeighbors);
  const crowdFn = useServerFn(getArtistCrowdData);
  const enrichFn = useServerFn(enrichSongs);
  const [dragOver, setDragOver] = useState(false);
  const [uploadStatuses, setUploadStatuses] = useState<UploadStatus[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dnpFileRef = useRef<HTMLInputElement>(null);
  const [dnpDragOver, setDnpDragOver] = useState(false);

  async function handleDnpFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const valid = arr.filter((f) => /\.(csv|txt)$/i.test(f.name));
    if (!valid.length) {
      toast.error("Please upload .csv or .txt files");
      return;
    }
    let total = 0;
    const newLines: string[] = [];
    for (const f of valid) {
      try {
        const entries = await parseDoNotPlayFile(f);
        if (entries.length) {
          newLines.push(doNotPlayEntriesToText(entries));
          total += entries.length;
        }
      } catch {
        toast.error(`Could not parse ${f.name}`);
      }
    }
    if (!total) {
      toast.error("No do-not-play entries found");
      return;
    }
    setDoNotPlayInput((prev) => {
      const existing = prev.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const incoming = newLines.join("\n").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const l of [...existing, ...incoming]) {
        const k = l.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(l);
      }
      return merged.join("\n");
    });
    toast.success(`Imported ${total} do-not-play entr${total === 1 ? "y" : "ies"}`);
  }

  // VirtualDJ state
  const [matches, setMatches] = useState<Record<string, SongMatch>>({});
  // Mirror of `matches` readable synchronously inside export handlers, which
  // may add match entries and consume them in the same tick (before React
  // has re-rendered with the new state).
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  // Guards against a slow in-flight generate() overwriting newer state.
  const genTokenRef = useRef(0);
  const [vdjDirHandle, setVdjDirHandle] = useState<DirHandleLike | null>(null);
  const [vdjDirName, setVdjDirName] = useState<string | null>(null);
  const [vdjDirSavedAt, setVdjDirSavedAt] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState<{ section: SectionKey; idx: number; key: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  // Bumped whenever the workflow is reset or a saved workflow is loaded.
  // Used as a React `key` on workflow-scoped components so any internal state
  // they hold is dropped — guarantees no cross-workflow leakage in the UI.
  const [workflowInstanceId, setWorkflowInstanceId] = useState(0);
  const [danceFloorConfirmed, setDanceFloorConfirmed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // Per-user defaults pulled from the profile; used for new/reset workflows.
  const defaultsRef = useRef({ hours: "3", decades: ["2000s", "2010s", "2020s"] as string[], expand: false });

  // Resets every piece of state that belongs to a single workflow. Device-level
  // setup (connected music folders, VirtualDJ export folder) is intentionally
  // left alone — those represent the DJ's machine, not workflow content.
  function clearWorkflowState() {
    setSongs([]);
    setHours(defaultsRef.current.hours);
    setArtistsInput("");
    setGenresInput("");
    setDecades([...defaultsRef.current.decades]);
    setNotes("");
    setDoNotPlayInput("");
    setExpand(defaultsRef.current.expand);
    setIncludeCombined(false);
    setEventName("");
    setResult(null);
    setMatches({});
    setSearchOpen(null);
    setSearchQuery("");
    setPreviewTarget(null);
    setIsGenerating(false);
    setDanceFloorConfirmed(false);
    setSavedEventId(null);
    setSaveState("idle");
    setBuffer(2);
    setActiveSection("warmUp");
    setSpotifyLink("");
    restoredEvent.current = false;
    savedSelectionsRef.current = null;
    saveRevision.current += 1;
    setWorkflowInstanceId((n) => nextWorkflowInstanceId(n));
  }

  const pendingFilePick = useRef<{key:string;path:string}|null>(null);
  const [canDirWrite, setCanDirWrite] = useState(false);
  const [musicSetupOpen, setMusicSetupOpen] = useState(false);
  const [musicSetupCompleted, setMusicSetupCompleted] = useState<boolean | null>(null);
  useEffect(() => { setCanDirWrite(supportsDirectoryWrite()); }, []);

  // Load the user's profile settings (setup flag + saved defaults) once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("profiles")
        .select("music_setup_completed, default_hours, default_decades, default_expand, favorite_artists")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled || !data) return;
      setMusicSetupCompleted(!!data.music_setup_completed);
      defaultsRef.current = {
        hours: data.default_hours || "3",
        decades: data.default_decades?.length ? data.default_decades : ["2000s", "2010s", "2020s"],
        expand: !!data.default_expand,
      };
      // Apply the saved defaults to the current (untouched) workflow.
      setHours(defaultsRef.current.hours);
      setDecades([...defaultsRef.current.decades]);
      setExpand(defaultsRef.current.expand);
      if (data.favorite_artists) {
        setArtistsInput((prev) => (prev.trim() ? prev : data.favorite_artists));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist "setup completed" once music and an export folder are configured.
  useEffect(() => {
    if (musicSetupCompleted === false && workspace.sources.length > 0 && vdjDirHandle) {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from("profiles").update({ music_setup_completed: true }).eq("id", user.id);
        setMusicSetupCompleted(true);
      })();
    }
  }, [workspace.sources.length, vdjDirHandle, musicSetupCompleted]);

  const audioIndex = useMemo<AudioIndex>(() => {
    return buildAudioIndex(workspace.files, []);
  }, [workspace.files]);

  async function addAudioFolder() { await workspace.addFolder(); }
  function removeAudioSource(id: string) { const i = workspace.sources.findIndex(s => s.label === id); if(i>=0) workspace.removeSource(i); }

  const resolveLocalFile = useMemo(
    () => (q: { artist?: string; title?: string; filePath?: string }) => resolveAudioFile(audioIndex, q),
    [audioIndex]
  );

  const resolveLocalMatch = useMemo(
    () => (q: { artist?: string; title?: string; filePath?: string }) => resolveAudioMatch(audioIndex, q),
    [audioIndex]
  );



  // An empty index still renders inline search, so a DJ can browse a local file
  // before connecting an entire folder.
  const emptyLibrary = useMemo(() => buildLibrary([]), []);
  const mergedLibrary = workspace.library ?? emptyLibrary;

  useEffect(() => {
    const picked = pendingFilePick.current;
    if (!picked) return;
    const index = mergedLibrary.tracks.findIndex(t => t.filePath === picked.path);
    if (index < 0) return;
    pendingFilePick.current = null;
    updateMatch(picked.key, {status:"Manually Matched",confidence:1,trackIndex:index,alternatives:[],extraTrackIndices:[]});
  }, [mergedLibrary]);

  useEffect(() => {
    if (!result || !matcherOn || !mergedLibrary.tracks.length) return;
    setMatches(prev => {
      const next = { ...prev };
      for (const sec of ["warmUp","transition","peak"] as SectionKey[]) result[sec].forEach((song,i) => {
        const key = songKey(sec,i,song);
        const prevPath = prev[key]?.trackIndex != null ? mergedLibrary.tracks[prev[key].trackIndex]?.filePath : undefined;
        if (!prev[key] || (prev[key].trackIndex != null && !prevPath)) next[key] = matchSong(song,mergedLibrary);
      });
      return next;
    });
  }, [mergedLibrary, result]);

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    songs.forEach((s) => {
      const k = dedupeKey(s.artist, s.song);
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
  }, [songs]);

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    const base = Date.now();
    const entries: UploadStatus[] = arr.map((f, i) => ({
      id: `${base}-${i}`,
      name: f.name,
      state: "parsing",
    }));
    setUploadStatuses((prev) => [...entries, ...prev].slice(0, 20));
    const update = (id: string, patch: Partial<UploadStatus>) =>
      setUploadStatuses((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

    let added = 0;
    let okFiles = 0;
    const collected: Song[] = [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      const id = entries[i].id;
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (!/\.(csv|txt)$/i.test(f.name)) {
        const hint =
          ext === "xlsx" || ext === "xls" || ext === "numbers"
            ? "Spreadsheets aren't supported yet — use File › Save As › CSV, then drop it here."
            : ext === "pdf" || ext === "docx" || ext === "doc"
              ? "Documents can't be read — copy the song list into a .txt file (one \"Artist - Song\" per line)."
              : ext === "xml"
                ? "This looks like a VirtualDJ database — add it from Music setup instead."
                : `.${ext || "unknown"} files aren't supported. Please use a .csv or .txt file.`;
        update(id, { state: "error", message: hint });
        continue;
      }
      if (f.size === 0) {
        update(id, { state: "error", message: "This file is empty." });
        continue;
      }
      if (f.size > 5 * 1024 * 1024) {
        update(id, { state: "error", message: "File is larger than 5 MB — is this really a song list?" });
        continue;
      }
      try {
        const parsed = await parseFile(f);
        if (!parsed.length) {
          update(id, {
            state: "error",
            message: "No songs found. Use columns \"Artist\" and \"Song\", or one \"Artist - Song\" per line.",
          });
          continue;
        }
        added += parsed.length;
        okFiles++;
        collected.push(...parsed);
        update(id, { state: "done", count: parsed.length });
      } catch {
        update(id, { state: "error", message: "We couldn't read this file. Check that it's plain text or CSV." });
      }
    }
    if (collected.length) setSongs((prev) => [...prev, ...collected]);
    if (okFiles) toast.success(`Imported ${added} songs from ${okFiles} file${okFiles > 1 ? "s" : ""}`);
    else toast.error("No songs imported — see file details below the drop zone.");
  }

  const hoursNum = parseFloat(hours) || 0;
  const sectionMinutes = formatMinutes(hoursNum);

  const doNotPlayEntries = useMemo(() => parseDoNotPlay(doNotPlayInput), [doNotPlayInput]);

  function buildCurrentPrefs(): Preferences {
    return {
      artists: artistsInput.split(",").map((s) => s.trim()).filter(Boolean),
      genres: genresInput.split(",").map((s) => s.trim()).filter(Boolean),
      decades,
      notes,
      doNotPlay: parseDoNotPlay(doNotPlayInput),
    };
  }

  const dnpDuplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    doNotPlayEntries.forEach((e) => {
      const k = `${normalizeKey(e.artist)}|${normalizeKey(e.song || "")}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k));
  }, [doNotPlayEntries]);

  function removeDoNotPlayEntry(index: number) {
    const next = [...doNotPlayEntries];
    next.splice(index, 1);
    setDoNotPlayInput(doNotPlayEntriesToText(next));
  }

  function removeDnpDuplicates() {
    const before = doNotPlayEntries.length;
    const seen = new Set<string>();
    const next = doNotPlayEntries.filter((e) => {
      const k = `${normalizeKey(e.artist)}|${normalizeKey(e.song || "")}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const removed = before - next.length;
    if (removed > 0) {
      setDoNotPlayInput(doNotPlayEntriesToText(next));
      toast.success(`Removed ${removed} duplicate do-not-play entr${removed === 1 ? "y" : "ies"}`);
    }
  }

  function songKey(section: SectionKey, idx: number, s: Song): string {
    return `${section}:${idx}:${dedupeKey(s.artist, s.song)}`;
  }




  function eventSnapshot(nextResult: GenerationResult, nextMatches: Record<string,SongMatch>) {
    const selections: Record<string,{paths:string[];excluded?:boolean}> = { ...savedSelectionsRef.current };
    for (const sec of ["warmUp","transition","peak"] as SectionKey[]) nextResult[sec].forEach((song,i) => {
      const key = songKey(sec,i,song), match = nextMatches[key];
      if (!match || !mergedLibrary) return;
      const paths = [match.trackIndex,...(match.extraTrackIndices??[])].filter((v):v is number=>typeof v==="number").map(v=>mergedLibrary.tracks[v]?.filePath).filter((v):v is string=>!!v);
      if(paths.length || match.excludedFromVdj) selections[key]={paths,excluded:match.excludedFromVdj};
      else if (mergedLibrary.tracks.length) delete selections[key];
    });
    return { name:(eventName.trim() || `Event — ${new Date().toLocaleDateString()}`).slice(0,200),
      inputs:{songs:songs.filter(s=>s.artist.trim()&&s.song.trim()),hours,artistsInput,genresInput,decades,notes,doNotPlayInput,expand,eventName,buffer},
      lists:{warmUp:nextResult.warmUp,transition:nextResult.transition,peak:nextResult.peak,selections} };
  }
  useEffect(() => {
    if(!openedEventId) return;
    let cancelled=false;
    restoredEvent.current = false;
    getEventFn({data:{id:openedEventId}}).then(row=>{
      if(cancelled)return;
      const inputs=row.inputs as unknown as WorkflowSnapshot["inputs"];
      const lists=row.lists as unknown as WorkflowSnapshot["lists"];
      if(!inputs || !lists)return;
      setSongs(inputs.songs??[]);setHours(inputs.hours??"3");setArtistsInput(inputs.artistsInput??"");setGenresInput(inputs.genresInput??"");setDecades(inputs.decades??[]);setNotes(inputs.notes??"");setDoNotPlayInput(inputs.doNotPlayInput??"");setExpand(!!inputs.expand);setEventName(inputs.eventName??"");setBuffer(inputs.buffer??2);
      const per=Math.ceil((Math.max(0,Number(inputs.hours) || 0)*15/3)*(inputs.buffer??2));
      const shortfall={warmUp:Math.max(0,per-lists.warmUp.length),transition:Math.max(0,per-lists.transition.length),peak:Math.max(0,per-lists.peak.length),total:0};
      shortfall.total=shortfall.warmUp+shortfall.transition+shortfall.peak;
      setResult({warmUp:lists.warmUp,transition:lists.transition,peak:lists.peak,targetTotal:per*3,perSectionTarget:per,perSectionBase:Math.ceil(per/(inputs.buffer??2)),shortfall,finalShortfall:shortfall,duplicatesRemoved:0,blockedCount:0});
      savedSelectionsRef.current=lists.selections??null;
      restoredEvent.current=true;
      saveRevision.current+=1;
      setSavedEventId(openedEventId);setSaveState("saved");setActiveSection("warmUp");
    }).catch(()=>toast.error("Could not open this event"));
    return ()=>{cancelled=true};
  },[openedEventId]);
  const savedSelectionsRef=useRef<Record<string,{paths:string[];excluded?:boolean}>|null>(null);
  useEffect(()=>{
    if(!result || !workspace.library || !savedSelectionsRef.current)return;
    const selections=savedSelectionsRef.current;
    setMatches(prev=>{const next={...prev};for(const [key,value] of Object.entries(selections)){
      const indices=value.paths.map(path=>mergedLibrary.tracks.findIndex(t=>t.filePath===path)).filter(i=>i>=0);
      next[key]={...(next[key]??{status:"Missing From Library",confidence:0,alternatives:[]}),...(indices.length?{status:"Manually Matched" as const,confidence:1,trackIndex:indices[0],extraTrackIndices:indices.slice(1)}:{}),excludedFromVdj:value.excluded};
    }return next});
  },[result,workspace.library]);
  useEffect(()=>{
    if(!result || !savedEventId || saveState==="error" || (!restoredEvent.current && !!openedEventId))return;
    const revision=++saveRevision.current;
    const timer=setTimeout(async()=>{
      if(revision!==saveRevision.current)return;
      setSaveState("saving");try{const snap=eventSnapshot(result,matches);await updateEventFn({data:{id:savedEventId,...snap}});if(revision===saveRevision.current)setSaveState("saved")}catch{if(revision===saveRevision.current){setSaveState("error");toast.error("Could not save event changes")}}
    },1000);
    return ()=>{clearTimeout(timer);saveRevision.current+=1};
  },[result,matches,songs,hours,artistsInput,genresInput,decades,notes,doNotPlayInput,expand,eventName,buffer,savedEventId]);

  async function generate() {
    if (!songs.length) {
      toast.error("Upload at least one song first");
      return;
    }
    if (hoursNum <= 0) {
      toast.error("Enter a valid dance floor length");
      return;
    }
    const myToken = ++genTokenRef.current;
    setIsGenerating(true);
    try {
    const uniqueSongs = dedupeSongs(songs);
    const prefs = buildCurrentPrefs();
    // Always build the base from uploads only; AI fills the gap when expand=true,
    // with the built-in library as a fallback if AI is unavailable.
    let r = generateLists({
      uploaded: uniqueSongs,
      hours: hoursNum,
      expand: false,
      buffer,
      prefs,
    });

    // Metadata enrichment strategy (per user request):
    //   1) Online sources (ReccoBeats + MusicBrainz) via `enrichSongs`.
    //   2) VirtualDJ tags as an offline fallback for anything the online
    //      sources didn't return.
    //   3) Existing per-song heuristics stay as the last-resort default.
    // We only fetch metadata for songs actually used in a generation.
    const applyOnlineEnrichment = (s: ResultSong, e: EnrichedSong | undefined): ResultSong => {
      if (!e || e.source === "none") return s;
      return {
        ...s,
        energy: s.energy ?? e.energy,
        danceability: s.danceability ?? e.danceability,
        popularity: s.popularity ?? e.popularity,
        valence: s.valence ?? e.valence,
        bpm: s.bpm ?? e.bpm,
        camelot: s.camelot ?? e.camelot,
        genre: s.genre ?? e.genre,
        year: s.year ?? e.year,
        metaSource: s.metaSource ?? "Online",
      };
    };
    const enrichFromLibrary = (s: ResultSong): ResultSong => {
      if (!mergedLibrary) return s;
      const m = matchSong({ artist: s.artist, song: s.song }, mergedLibrary);
      if (m.trackIndex == null) return s;
      const t = mergedLibrary.tracks[m.trackIndex];
      if (!t) return s;
      const bpmNum = parseBpm(t.bpm);
      const cam = toCamelot(t.key);
      const yearNum = t.year && /^\d{4}$/.test(t.year) ? parseInt(t.year, 10) : undefined;
      return {
        ...s,
        bpm: s.bpm ?? bpmNum,
        camelot: s.camelot ?? cam,
        genre: s.genre ?? t.genre,
        year: s.year ?? yearNum,
        metaSource: s.metaSource ?? "VirtualDJ",
      };
    };
    // Small helper: fetch online enrichment for a flat list of songs and
    // return a map keyed by "artist||song" (raw values). Best-effort — a
    // network failure returns an empty map so generation continues.
    let enrichFailed = false;
    const enrichBatch = async (list: ResultSong[]): Promise<Map<string, EnrichedSong>> => {
      const map = new Map<string, EnrichedSong>();
      if (!list.length) return map;
      try {
        const payload = list.slice(0, 200).map((s) => ({ artist: s.artist, song: s.song }));
        const res = await enrichFn({ data: { songs: payload } });
        for (const e of res.results) {
          map.set(`${e.artist}||${e.song}`, e);
        }
      } catch (err) {
        console.warn("Online enrichment failed — falling back to VirtualDJ/heuristic", err);
        if (!enrichFailed) {
          enrichFailed = true;
          toast.warning(
            "Couldn't reach the online music data service — energy, BPM and genre are estimated for this run.",
          );
        }
      }
      return map;
    };

    // Enrich uploads: online first, then VirtualDJ fallback.
    const initialFlat = ([...r.warmUp, ...r.transition, ...r.peak]);
    const initialOnline = await enrichBatch(initialFlat);
    (["warmUp", "transition", "peak"] as SectionKey[]).forEach((k) => {
      r[k] = r[k].map((s) =>
        enrichFromLibrary(applyOnlineEnrichment(s, initialOnline.get(`${s.artist}||${s.song}`))),
      );
    });

    if (expand) {
      {
        const sectionMap: Array<{ key: SectionKey; label: "Warm Up" | "Transition" | "Peak" }> = [
          { key: "warmUp", label: "Warm Up" },
          { key: "transition", label: "Transition" },
          { key: "peak", label: "Peak" },
        ];
        // IMPORTANT: workflow isolation.
        // `prefs` is rebuilt above from current form state only, and each AI
        // call below rebuilds `existing` strictly from the freshly-computed
        // `r` (which itself comes only from the current uploaded `songs`).
        // Do not add any data here that could come from a previous workflow —
        // the AI recommender must only see the active workflow's inputs.



        const failed: SectionKey[] = [];
        const favoriteArtists = (prefs.artists ?? []).filter(Boolean);
        // Shared mapper so the favorites pass and the general pass produce
        // identical song records.
        const toAiSong = (sug: {
          artist: string;
          song: string;
          energy: number;
          danceability: number;
          popularity: number;
          valence: number;
          bpm?: number;
          camelot?: string;
          genre: string;
          year?: number;
          mood?: string;
          explicit?: boolean;
          reason: string;
        }) => ({
          artist: sug.artist,
          song: sug.song,
          fromUpload: false,
          energy: sug.energy,
          danceability: sug.danceability,
          popularity: sug.popularity,
          valence: sug.valence,
          bpm: typeof sug.bpm === "number" ? sug.bpm : undefined,
          camelot: toCamelot(sug.camelot),
          genre: sug.genre,
          year: typeof sug.year === "number" ? sug.year : undefined,
          mood: sug.mood,
          explicit:
            typeof sug.explicit === "boolean" ? sug.explicit : detectExplicitFromTitle(sug.song),
          metaSource: "AI" as const,
          aiSuggestion: true,
          aiReason: sug.reason,
        });

        // ---- MUSIC-MAP NEIGHBOR GRAPH -------------------------------------
        // Build a similarity cluster around the artists the client actually
        // asked for, then look through the DJ's own library for songs by those
        // neighbours BEFORE the AI invents anything.
        let neighborArtists: string[] = [];
        let crowdArtists: Array<{ artist: string; listeners?: number; tags: string[] }> = [];
        try {
          const seedCounts = new Map<string, number>();
          for (const s of uniqueSongs) {
            const a = (s.artist ?? "").trim();
            if (!a) continue;
            seedCounts.set(a, (seedCounts.get(a) ?? 0) + 1);
          }
          const seeds = [
            ...favoriteArtists,
            ...[...seedCounts.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a),
          ];
          const seenSeed = new Set<string>();
          const uniqueSeeds = seeds.filter((a) => {
            const k = normalizeKey(a);
            if (!k || seenSeed.has(k)) return false;
            seenSeed.add(k);
            return true;
          }).slice(0, 20);
          if (uniqueSeeds.length) {
            const res = await neighborsFn({
              data: { artists: uniqueSeeds, genres: prefs.genres ?? [], perArtist: 8 },
            });
            const seedKeys = new Set(uniqueSeeds.map((a) => normalizeKey(a)));
            const seenNeighbor = new Set<string>();
            const ordered: Array<{ name: string; seed: string }> = [];
            for (const c of res.clusters) {
              for (const n of c.neighbors) {
                const k = normalizeKey(n);
                if (!k || seedKeys.has(k) || seenNeighbor.has(k)) continue;
                seenNeighbor.add(k);
                ordered.push({ name: n, seed: c.artist });
              }
            }
            neighborArtists = ordered.map((n) => n.name).slice(0, 100);

            // ---- YOUR CRATES FIRST ----------------------------------------
            if (mergedLibrary?.tracks.length && ordered.length) {
              const have = new SongKeySet();
              for (const s of [...r.warmUp, ...r.transition, ...r.peak]) have.add(s.artist, s.song);
              const perArtistCap = 2;
              const crateFinds: ResultSong[] = [];
              for (const { name, seed } of ordered) {
                let taken = 0;
                for (const idx of searchLibrary(name, mergedLibrary, 6)) {
                  if (taken >= perArtistCap) break;
                  const t = mergedLibrary.tracks[idx];
                  if (!t?.artist || !t.title) continue;
                  if (normalizeKey(t.artist).indexOf(normalizeKey(name)) < 0) continue;
                  if (!have.tryAdd(t.artist, t.title)) continue;
                  const yearNum = t.year && /^\d{4}$/.test(t.year) ? parseInt(t.year, 10) : undefined;
                  crateFinds.push({
                    artist: t.artist,
                    song: t.title,
                    fromUpload: false,
                    bpm: parseBpm(t.bpm),
                    camelot: toCamelot(t.key),
                    genre: t.genre,
                    year: yearNum,
                    explicit: detectExplicitFromTitle(t.title),
                    metaSource: "Library",
                    aiReason: `In your library — close musical neighbour of ${seed}.`,
                  } as ResultSong);
                  taken += 1;
                }
              }
              if (crateFinds.length) {
                // Spread them across the sections that still have room; the
                // energy re-bucketing later puts each one where it belongs.
                const quota = Math.max(1, Math.round(r.perSectionTarget * 0.35));
                let cursor = 0;
                for (const { key } of sectionMap) {
                  let placed = 0;
                  while (
                    cursor < crateFinds.length &&
                    placed < quota &&
                    r[key].length < r.perSectionTarget
                  ) {
                    const pick = crateFinds[cursor++];
                    if (!pick) break;
                    r[key].push(pick as (typeof r)[typeof key][number]);
                    placed += 1;
                  }
                }
              }
            }
          }
        } catch (err) {
          console.warn("Neighbor map unavailable — continuing without it", err);
        }

        await Promise.all(
          sectionMap.map(async ({ key, label }) => {
            // PASS 1 — favorite artists first. Fill this section with songs by
            // the DJ's favorite artists (max 3 per artist per list) before we
            // look anywhere else. The recommender is allowed to return fewer
            // (or zero) when nothing by those artists fits the section.
            if (favoriteArtists.length) {
              const FAV_ATTEMPTS = 3;
              for (let favAttempt = 0; favAttempt < FAV_ATTEMPTS; favAttempt++) {
                if (r[key].length >= r.perSectionTarget) break;
                // Artists still under the per-list cap for THIS section.
                const counts = new Map<string, number>();
                for (const s of r[key]) {
                  const hit = favoriteArtists.find((f) => isFavoriteArtist(s.artist, [f]));
                  if (hit) counts.set(hit, (counts.get(hit) ?? 0) + 1);
                }
                const eligible = favoriteArtists.filter(
                  (f) => (counts.get(f) ?? 0) < FAVORITE_ARTIST_CAP,
                );
                if (!eligible.length) break;
                const need = r.perSectionTarget - r[key].length;
                const requestCount = Math.min(
                  need,
                  MAX_AI_RECOMMENDATION_BATCH_SIZE,
                  eligible.length * FAVORITE_ARTIST_CAP,
                );
                if (requestCount <= 0) break;
                try {
                  const existingNow = buildRecommendExisting({
                    warmUp: r.warmUp,
                    transition: r.transition,
                    peak: r.peak,
                  });
                  const res = await recommendFn({
                    data: {
                      section: label,
                      count: requestCount,
                      prefs,
                      existing: existingNow,
                      onlyArtists: eligible,
                      neighborArtists,
                    },
                  });
                  if (!res.suggestions.length) break;
                  const seen = new SongKeySet();
                  for (const s of [...r.warmUp, ...r.transition, ...r.peak, ...existingNow]) seen.add(s.artist, s.song);
                  let added = 0;
                  for (const sug of res.suggestions) {
                    if (r[key].length >= r.perSectionTarget) break;
                    if (seen.has(sug.artist, sug.song)) continue;
                    // Enforce the per-list cap client-side too.
                    const owner = favoriteArtists.find((f) => isFavoriteArtist(sug.artist, [f]));
                    if (!owner) continue;
                    if ((counts.get(owner) ?? 0) >= FAVORITE_ARTIST_CAP) continue;
                    counts.set(owner, (counts.get(owner) ?? 0) + 1);
                    seen.add(sug.artist, sug.song);
                    r[key].push(toAiSong(sug) as (typeof r)[typeof key][number]);
                    added += 1;
                  }
                  if (added === 0) break;
                } catch (err) {
                  console.error("Favorite-artist recommend failed", err);
                  break;
                }
              }
            }

            // PASS 2 — general gap-driven fill for whatever is still missing.
            // Retry loop: AI may return fewer items than requested (dedupes,
            // MAX_TOKENS truncation, over-cautious schema output). Keep asking
            // for the remaining shortfall until we either fill the section or
            // hit the attempt cap. Without this a single short response leaves
            // the playlist under the ${buffer}× buffer target.
            // The server recommender accepts at most 40 songs per call. Long
            // dance floors can need more than that for a single section, so
            // chunk the shortfall into multiple AI calls instead of sending an
            // over-limit request that gets rejected before the AI can add any
            // songs.
            const MAX_ATTEMPTS = Math.max(
              4,
              Math.ceil(r.perSectionTarget / MAX_AI_RECOMMENDATION_BATCH_SIZE) + 3,
            );
            let attempt = 0;
            let lastErr: unknown = null;
            let gotAny = false;
            while (r[key].length < r.perSectionTarget && attempt < MAX_ATTEMPTS) {
              attempt += 1;
              const need = r.perSectionTarget - r[key].length;
              const requestCount = Math.min(need, MAX_AI_RECOMMENDATION_BATCH_SIZE);
              try {
                // Rebuild `existing` each attempt so the AI sees everything
                // already picked (uploads + prior AI additions) and never
                // re-suggests the same songs.
                const existingNow = buildRecommendExisting({
                  warmUp: r.warmUp,
                  transition: r.transition,
                  peak: r.peak,
                });
                // Tell the AI which holes to fill (genre/decade/tempo gaps,
                // artists already at the cap) so batches stop repeating.
                const gaps = buildGapProfile(
                  r[key],
                  [...r.warmUp, ...r.transition, ...r.peak],
                  label,
                  { favoriteArtists },
                );
                const res = await recommendFn({
                  data: {
                    section: label,
                    count: requestCount,
                    prefs,
                    existing: existingNow,
                    gaps,
                    favoriteArtists,
                    neighborArtists,
                  },
                });

                if (!res.suggestions.length) {
                  // No progress this attempt — stop looping to avoid burning
                  // credits on a section the model can't fill.
                  break;
                }
                gotAny = true;
                const seen = new SongKeySet();
                for (const s of [...r.warmUp, ...r.transition, ...r.peak, ...existingNow]) seen.add(s.artist, s.song);
                let addedThisAttempt = 0;
                for (const sug of res.suggestions) {
                  if (r[key].length >= r.perSectionTarget) break;
                  if (!seen.tryAdd(sug.artist, sug.song)) continue;
                  r[key].push({
                    artist: sug.artist,
                    song: sug.song,
                    fromUpload: false,
                    energy: sug.energy,
                    danceability: sug.danceability,
                    popularity: sug.popularity,
                    valence: sug.valence,
                    bpm: typeof sug.bpm === "number" ? sug.bpm : undefined,
                    camelot: toCamelot(sug.camelot),
                    genre: sug.genre,
                    year: typeof sug.year === "number" ? sug.year : undefined,
                    mood: sug.mood,
                    explicit:
                      typeof sug.explicit === "boolean"
                        ? sug.explicit
                        : detectExplicitFromTitle(sug.song),
                    metaSource: "AI",
                    aiSuggestion: true,
                    aiReason: sug.reason,
                  } as (typeof r)[typeof key][number] & { aiSuggestion?: boolean; aiReason?: string });

                  addedThisAttempt += 1;
                }
                if (addedThisAttempt === 0) break; // all suggestions were duplicates
              } catch (err) {
                lastErr = err;
                console.error("AI recommend failed", err);
                break;
              }
            }
            // NOTE: online + VirtualDJ enrichment for AI picks runs after all
            // sections finish (see enrichBatch call below) so we do it once.
            // Mark section as failed only when AI produced nothing at all
            // AND we still have a gap — that's when we need library fallback.
            if (!gotAny && r[key].length < r.perSectionTarget) {
              if (lastErr) failed.push(key);
              else failed.push(key);
            }
          }),
        );

        // Top up any sections still short (even after successful AI calls)
        // from the built-in library so we always hit the buffered target.
        const stillShort = sectionMap.filter(({ key }) => r[key].length < r.perSectionTarget);
        if (stillShort.length) {
          const fallback = generateLists({
            uploaded: uniqueSongs,
            hours: hoursNum,
            expand: true,
            buffer,
            prefs,
          });
          // Track keys across ALL sections so a library song can't be added
          // to two different lists during the fallback pass.
          const globalHave = new SongKeySet();
          for (const s of [...r.warmUp, ...r.transition, ...r.peak]) globalHave.add(s.artist, s.song);
          for (const { key } of stillShort) {
            for (const s of fallback[key]) {
              if (r[key].length >= r.perSectionTarget) break;
              if (!globalHave.tryAdd(s.artist, s.song)) continue;
              r[key].push({ ...s, metaSource: "Library" });
            }
          }
          if (failed.length) {
            toast.error("AI suggestions unavailable for some sections — used built-in library.");
          }
        }

        // Enrich AI-added picks online too, so section re-bucketing uses real
        // ReccoBeats/MusicBrainz values instead of the AI's self-reported guesses.
        // Only fetch for songs whose metaSource is still AI/Library (i.e. skip
        // uploads we already enriched above).
        const needsAiEnrich: ResultSong[] = [];
        (["warmUp", "transition", "peak"] as SectionKey[]).forEach((k) => {
          for (const s of r[k]) {
            if (s.metaSource === "AI" || s.metaSource === "Library") needsAiEnrich.push(s);
          }
        });
        if (needsAiEnrich.length) {
          const aiOnline = await enrichBatch(needsAiEnrich);
          (["warmUp", "transition", "peak"] as SectionKey[]).forEach((k) => {
            r[k] = r[k].map((s) => {
              if (s.metaSource !== "AI" && s.metaSource !== "Library") return s;
              const e = aiOnline.get(`${s.artist}||${s.song}`);
              if (!e || e.source === "none") return enrichFromLibrary(s);
              // For AI picks the model's numbers were guesses — prefer online.
              return enrichFromLibrary({
                ...s,
                energy: e.energy ?? s.energy,
                danceability: e.danceability ?? s.danceability,
                popularity: e.popularity ?? s.popularity,
                valence: e.valence ?? s.valence,
                bpm: e.bpm ?? s.bpm,
                camelot: e.camelot ?? s.camelot,
                genre: e.genre ?? s.genre,
                year: e.year ?? s.year,
                metaSource: "Online",
              });
            });
          });
        }

      }
    }

    // Re-bucket + sort the merged set so uploads and AI picks interleave into
    // a single ascending energy ramp from the first warm-up song to the last
    // peak song.
    r = reorderForEnergyProgression(r, { favoriteArtists: prefs.artists ?? [] });
    if (expand && r.finalShortfall && r.finalShortfall.total > 0) {
      r = topUpSectionsFromLibrary(r, prefs);
    }

    // A newer generate() (or a workflow reset) started while we were awaiting
    // AI/enrichment — drop this stale result instead of clobbering state.
    if (genTokenRef.current !== myToken) return;

    setResult(r);
    setActiveSection("warmUp");
    const existingEventId = savedEventId;
    setSavedEventId(null);
    setSaveState("saving");
    setMatches({});
    if (mergedLibrary) {
      // fresh matching
      const m: Record<string, SongMatch> = {};
      (["warmUp", "transition", "peak"] as SectionKey[]).forEach((section) => {
        r[section].forEach((s, i) => {
          if (matcherOn) m[songKey(section, i, s)] = matchSong(s, mergedLibrary);
        });
      });
      matchesRef.current = m;
      setMatches(m);
    } else {
      matchesRef.current = {};
    }
    try {
      const snapshot = eventSnapshot(r, matchesRef.current);
      const saved = existingEventId ? await updateEventFn({data:{id:existingEventId,...snapshot}}) : await saveEventFn({data:snapshot});
      if(genTokenRef.current === myToken){setSavedEventId(saved.id);setSaveState("saved");}
    }catch{if(genTokenRef.current === myToken){setSaveState("error");toast.error("Lists generated, but the event could not be saved. Try regenerating.");}}
    const fs = r.finalShortfall;
    if (fs && fs.total > 0) {
      const parts: string[] = [];
      if (fs.warmUp > 0) parts.push(`${fs.warmUp} short in Warm Up`);
      if (fs.transition > 0) parts.push(`${fs.transition} short in Transition`);
      if (fs.peak > 0) parts.push(`${fs.peak} short in Peak`);
      toast.warning(
        `Not enough songs to fill every section — ${parts.join(", ")}. Lowest-energy songs are still first, highest last. Add more songs or enable AI/library expansion to close the gap.`,
        { duration: 8000 },
      );
    } else {
      toast.success("Lists generated");
    }
    setTimeout(() => {
      document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    } finally {
      setIsGenerating(false);
    }
  }

  function removeDuplicates() {
    const before = songs.length;
    const next = dedupeSongs(songs);
    const removed = before - next.length;
    setSongs(next);
    toast.success(`Removed ${removed} duplicate song${removed === 1 ? "" : "s"}`);
  }

  // The configured VirtualDJ folder in Settings is the single source of truth
  // for where playlists are written (desktop app only — browsers can't build a
  // folder handle from a path). Any older cached export folder is replaced.
  const configuredExportPath =
    isDesktopApp() && workspace.vdjRoot ? vdjPlaylistsIn(workspace.vdjRoot) : null;

  useEffect(() => {
    if (!configuredExportPath) return;
    const handle = makeNativeDirHandle(configuredExportPath);
    setVdjDirHandle(handle as unknown as DirHandleLike);
    setVdjDirName(configuredExportPath);
    const now = Date.now();
    setVdjDirSavedAt(now);
    void saveDirHandle(VDJ_DIR_KEY, handle as unknown as Parameters<typeof saveDirHandle>[1]);
    void saveDirHandleMeta(VDJ_DIR_KEY, { savedAt: now });
  }, [configuredExportPath]);

  // Otherwise restore a previously chosen export folder from IndexedDB on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (configuredExportPath) return;
      const handle = await loadDirHandle(VDJ_DIR_KEY);
      const meta = await loadDirHandleMeta(VDJ_DIR_KEY);
      if (cancelled || !handle) return;
      if (meta) setVdjDirSavedAt(meta.savedAt);
      await verifyReadWrite(handle);
      if (cancelled) return;
      setVdjDirHandle(handle as unknown as DirHandleLike);
      setVdjDirName(handle.name ?? "VirtualDJ folder");
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configuredExportPath]);

  async function chooseMyListsFolder() {
    if (!supportsDirectoryWrite()) {
      toast.error("Direct folder writing not supported in this browser");
      return;
    }
    let handle: DirHandleLike | null = null;
    try {
      handle = await pickDirectoryHandle();
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    if (handle) {
      const name = (handle as DirHandleLike & { name?: string }).name ?? "VirtualDJ folder";
      const now = Date.now();
      setVdjDirHandle(handle);
      setVdjDirName(name);
      setVdjDirSavedAt(now);
      try {
        await saveDirHandle(VDJ_DIR_KEY, handle as unknown as Parameters<typeof saveDirHandle>[1]);
        await saveDirHandleMeta(VDJ_DIR_KEY, { savedAt: now });
        toast.success(`VirtualDJ folder saved · ${name}`);
      } catch {
        toast.warning(`Folder linked for this session · ${name}`, {
          description: "It couldn't be remembered for next time — you may need to pick it again after restarting.",
        });
      }
    }
  }

  function clearMyListsFolder() {
    setVdjDirHandle(null);
    setVdjDirName(null);
    setVdjDirSavedAt(null);
    void clearDirHandle(VDJ_DIR_KEY);
    void clearDirHandleMeta(VDJ_DIR_KEY);
    toast.success("VirtualDJ folder unlinked");
  }

  // Ensure we have a writable folder handle, prompting the user if needed.
  // Returns the handle or null if the user cancelled / permission denied.
  async function ensureExportFolder(): Promise<DirHandleLike | null> {
    // Always follow the VirtualDJ folder configured in Settings, so a stale
    // cached folder can never receive the export.
    if (configuredExportPath) {
      return makeNativeDirHandle(configuredExportPath) as unknown as DirHandleLike;
    }
    if (vdjDirHandle) {
      const ok = await verifyReadWrite(vdjDirHandle as unknown as Parameters<typeof verifyReadWrite>[0]);
      if (ok) return vdjDirHandle;
    }
    if (!supportsDirectoryWrite()) return null;
    let handle: DirHandleLike | null = null;
    try {
      handle = await pickDirectoryHandle();
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    }
    if (!handle) return null;
    setVdjDirHandle(handle);
    const name = (handle as DirHandleLike & { name?: string }).name ?? "VirtualDJ folder";
    setVdjDirName(name);
    const now = Date.now();
    setVdjDirSavedAt(now);
    try {
      await saveDirHandle(VDJ_DIR_KEY, handle as unknown as Parameters<typeof saveDirHandle>[1]);
      await saveDirHandleMeta(VDJ_DIR_KEY, { savedAt: now });
      toast.success(`VirtualDJ folder saved · ${name}`);
    } catch {
      toast.warning(`Folder linked for this session · ${name}`);
    }
    return handle;
  }



  // --- Match controls ---

  function updateMatch(key: string, patch: Partial<SongMatch>) {
    setMatches((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function confirmMatch(key: string) {
    const m = matches[key];
    if (!m || m.trackIndex == null) return;
    updateMatch(key, { status: "Matched", confidence: 1 });
  }

  function chooseAlternative(key: string, trackIndex: number) {
    const m = matches[key];
    if (!m) return;
    if(trackIndex === -1){updateMatch(key,{status:"Missing From Library",confidence:0,trackIndex:undefined,alternatives:[],extraTrackIndices:m.extraTrackIndices??[]});return;}
    const others = [m.trackIndex, ...m.alternatives].filter((i): i is number => i != null && i !== trackIndex);
    const extras = (m.extraTrackIndices ?? []).filter((i) => i !== trackIndex);
    updateMatch(key, { status: "Manually Matched", confidence: 1, trackIndex, alternatives: others, extraTrackIndices: extras });
  }

  function markUnresolved(key: string) {
    updateMatch(key, { status: "Missing From Library", confidence: 0, trackIndex: undefined, alternatives: [], extraTrackIndices: [] });
  }

  function toggleExtraPick(key: string, trackIndex: number) {
    const m = matches[key];
    if (!m) return;
    if (m.trackIndex === trackIndex) return; // it's the primary, ignore
    const extras = m.extraTrackIndices ?? [];
    const next = extras.includes(trackIndex)
      ? extras.filter((i) => i !== trackIndex)
      : [...extras, trackIndex];
    updateMatch(key, { extraTrackIndices: next });
  }

  function toggleExclude(key: string) {
    const m = matches[key];
    updateMatch(key, { excludedFromVdj: !m?.excludedFromVdj });
  }

  function openSearch(section: SectionKey, idx: number, s: Song) {
    const key = songKey(section, idx, s);
    setSearchOpen({ section, idx, key });
    setSearchQuery(`${s.artist} ${s.song}`);
  }

  function applySearchPick(trackIndex: number) {
    if (!searchOpen) return;
    const m = matches[searchOpen.key];
    const extras = (m?.extraTrackIndices ?? []).filter((i) => i !== trackIndex);
    updateMatch(searchOpen.key, {
      status: "Manually Matched",
      confidence: 1,
      trackIndex,
      alternatives: [],
      extraTrackIndices: extras,
    });
    setSearchOpen(null);
    setSearchQuery("");
  }

  function pickLocalFileForMatch(key: string, file: File) {
    if (!/\.(mp3|m4a|wav|flac|ogg|aac|aif{1,2}|wma|opus|alac)$/i.test(file.name)) {
      toast.error("Unsupported audio file type");
      return;
    }
    pendingFilePick.current = {key, path: file.name};
    workspace.addFile(file);
    toast.success(`Added ${file.name} to search results`);
  }

  // --- Export helpers ---

  function getSectionRefs(section: SectionKey): ExportSongRef[] {
    if (!result) return [];
    return getSectionRefsForResult(result, section);
  }

  function getSectionRefsForResult(source: GenerationResult, section: SectionKey): ExportSongRef[] {
    return source[section].map((s, i) => ({
      song: s,
      match: matchesRef.current[songKey(section, i, s)],
    }));
  }

  function ensureBufferedResultForExport(): GenerationResult | null {
    if (!result) return null;
    if (!expand || !result.finalShortfall || result.finalShortfall.total === 0) return result;
    const topped = topUpSectionsFromLibrary(result, buildCurrentPrefs());
    setResult(topped);
    if (mergedLibrary) {
      // Preserve existing matches (manual picks, extra tracks, VDJ exclusions)
      // and only auto-match songs that were just added by the top-up.
      const existing = matchesRef.current;
      const m: Record<string, SongMatch> = { ...existing };
      (["warmUp", "transition", "peak"] as SectionKey[]).forEach((section) => {
        topped[section].forEach((s, i) => {
          const key = songKey(section, i, s);
          if (!m[key]) m[key] = matchSong(s, mergedLibrary);
        });
      });
      matchesRef.current = m;
      setMatches(m);
    }
    toast.success("Filled short sections from the built-in library before export");
    return topped;
  }

  function exportSectionCsv(section: SectionKey) {
    const exportResult = ensureBufferedResultForExport();
    if (!exportResult) return;
    const list = exportResult[section];
    if (!list.length) {
      toast.error("No songs in this section");
      return;
    }
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    downloadBlob(
      new Blob([songsToCsv(list)], { type: "text/csv" }),
      `${prefix}${SECTION_FILES[section]}.csv`,
    );
  }

  function unmatchedCount(section: SectionKey): number {
    if (!result) return 0;
    return unmatchedCountForResult(result, section);
  }

  function unmatchedCountForResult(source: GenerationResult, section: SectionKey): number {
    return getSectionRefsForResult(source, section).filter(
      (r) => !r.match || r.match.trackIndex == null || r.match.excludedFromVdj,
    ).length;
  }

  function confirmUnmatched(exportResult: GenerationResult, section: SectionKey): boolean {
    const unmatched = unmatchedCountForResult(exportResult, section);
    if (unmatched === 0) return true;
    return window.confirm(
      `${unmatched} songs are not matched to files in your VirtualDJ library. They will remain in your CSV reference lists but will not appear in the VirtualDJ M3U playlist unless matched. Continue?`,
    );
  }

  async function exportSectionXml(section: SectionKey) {
    if (!mergedLibrary) {
      toast.error("Load a VirtualDJ database first");
      return;
    }
    const exportResult = ensureBufferedResultForExport();
    if (!exportResult) return;
    if (!confirmUnmatched(exportResult, section)) return;
    const refs = getSectionRefsForResult(exportResult, section);
    const xml = buildTxtPlaylist(refs, mergedLibrary);
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    downloadBlob(
      new Blob([xml], { type: "text/plain" }),
      `${prefix}${SECTION_FILES[section]}.txt`,
    );
  }

  function exportSectionM3u(section: SectionKey) {
    if (!mergedLibrary) {
      toast.error("Load a VirtualDJ database first");
      return;
    }
    const exportResult = ensureBufferedResultForExport();
    if (!exportResult) return;
    const refs = getSectionRefsForResult(exportResult, section);
    const m3u = buildM3u(refs, mergedLibrary);
    warnUnresolvedPaths(countUnresolvedPaths(refs, mergedLibrary));
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    downloadBlob(
      new Blob([m3u], { type: "audio/x-mpegurl" }),
      `${prefix}${SECTION_FILES[section]}.m3u`,
    );
  }

  // --- Direct-to-VirtualDJ folder exports ---

  async function exportSectionXmlToVdj(section: SectionKey) {
    if (!mergedLibrary) {
      toast.error("Load a VirtualDJ database first");
      return;
    }
    const exportResult = ensureBufferedResultForExport();
    if (!exportResult) return;
    if (!confirmUnmatched(exportResult, section)) return;
    const dir = await ensureExportFolder();
    if (!dir) {
      toast.error("Pick a VirtualDJ export folder first");
      return;
    }
    const refs = getSectionRefsForResult(exportResult, section);
    const xml = buildTxtPlaylist(refs, mergedLibrary);
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    const fname = `${prefix}${SECTION_FILES[section]}.txt`;
    try {
      await writeFileToDir(dir, fname, xml);
      toast.success(`Saved ${fname} to ${vdjDirName ?? "VirtualDJ folder"}`);
    } catch {
      toast.error("Could not write to VirtualDJ folder, downloading instead");
      downloadBlob(new Blob([xml], { type: "text/plain" }), fname);
    }
  }

  async function exportSectionM3uToVdj(section: SectionKey) {
    if (!mergedLibrary) {
      toast.error("Load a VirtualDJ database first");
      return;
    }
    const exportResult = ensureBufferedResultForExport();
    if (!exportResult) return;
    const dir = await ensureExportFolder();
    if (!dir) {
      toast.error("Pick a VirtualDJ export folder first");
      return;
    }
    const refs = getSectionRefsForResult(exportResult, section);
    const m3u = buildM3u(refs, mergedLibrary);
    warnUnresolvedPaths(countUnresolvedPaths(refs, mergedLibrary));
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    const fname = `${prefix}${SECTION_FILES[section]}.m3u`;
    try {
      await writeFileToDir(dir, fname, m3u);
      toast.success(`Saved ${fname} to ${vdjDirName ?? "VirtualDJ folder"}`);
    } catch {
      toast.error("Could not write to VirtualDJ folder, downloading instead");
      downloadBlob(new Blob([m3u], { type: "audio/x-mpegurl" }), fname);
    }
  }

  function warnUnresolvedPaths(count: number) {
    if (count > 0) {
      toast.warning(
        `${count} song${count === 1 ? "" : "s"} may not be found by VirtualDJ — set the full folder location in Settings › DJ software & folders.`,
      );
    }
  }

  async function exportAllToVdj() {
    const exportResult = ensureBufferedResultForExport();
    if (!exportResult) return;
    const dir = await ensureExportFolder();
    if (!dir) {
      toast.error("Pick a VirtualDJ export folder first");
      return;
    }
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    const sections: SectionKey[] = ["warmUp", "transition", "peak"];
    let written = 0;
    let unresolvedTotal = 0;
    let failed = 0;
    for (const section of sections) {
      const list = exportResult[section];
      if (!list.length) continue;
      const files: Array<{ name: string; data: string }> = [
        { name: `${prefix}${SECTION_FILES[section]}.csv`, data: songsToCsv(list) },
      ];
      if (mergedLibrary) {
        const refs = getSectionRefsForResult(exportResult, section);
        files.push({ name: `${prefix}${SECTION_FILES[section]}.txt`, data: buildTxtPlaylist(refs, mergedLibrary) });
        files.push({ name: `${prefix}${SECTION_FILES[section]}.m3u`, data: buildM3u(refs, mergedLibrary) });
        unresolvedTotal += countUnresolvedPaths(refs, mergedLibrary);
      }
      for (const f of files) {
        try {
          await writeFileToDir(dir, f.name, f.data);
          written += 1;
        } catch {
          failed += 1;
        }
      }
    }
    if (includeCombined) {
      try {
        await writeFileToDir(dir, `${prefix}combined-dance-floor-lists.csv`, combinedCsv(exportResult));
        written += 1;
      } catch {
        failed += 1;
      }
    }
    warnUnresolvedPaths(unresolvedTotal);
    if (failed === 0) {
      toast.success(`Saved ${written} file${written === 1 ? "" : "s"} to ${vdjDirName ?? "VirtualDJ folder"}`);
    } else {
      toast.error(`Saved ${written}, failed ${failed}. Check folder permissions.`);
    }
  }

  async function exportAllZip() {
    const exportResult = ensureBufferedResultForExport();
    if (!exportResult) return;
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    const zip = new JSZip();
    (["warmUp", "transition", "peak"] as SectionKey[]).forEach((section) => {
      zip.file(`${prefix}${SECTION_FILES[section]}.csv`, songsToCsv(exportResult[section]));
      if (mergedLibrary) {
        const refs = getSectionRefsForResult(exportResult, section);
        zip.file(`${prefix}${SECTION_FILES[section]}.txt`, buildTxtPlaylist(refs, mergedLibrary));
        zip.file(`${prefix}${SECTION_FILES[section]}.m3u`, buildM3u(refs, mergedLibrary));
      }
    });
    if (includeCombined) zip.file(`${prefix}combined-dance-floor-lists.csv`, combinedCsv(exportResult));
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${prefix}dance-floor-lists.zip`);
  }

  function exportSectionPdf(section: SectionKey) {
    if (!result) return;
    const pdf = new jsPDF();
    const name = section === "warmUp" ? "Warm Up" : section === "transition" ? "Transition" : "Peak";
    pdf.setFontSize(18); pdf.text(`${eventName || "Event"} — ${name}`, 15, 20);
    pdf.setFontSize(10);
    let y = 32;
    result[section].forEach((song, i) => {
      const line = `${i + 1}. ${song.artist} — ${song.song}`;
      const lines = pdf.splitTextToSize(line, 175) as string[];
      if (y + lines.length * 6 > 280) { pdf.addPage(); y = 20; }
      pdf.text(lines, 15, y); y += lines.length * 6 + 2;
    });
    pdf.save(`${eventName ? `${toKebabCase(eventName)}-` : ""}${SECTION_FILES[section]}.pdf`);
  }

  // --- Summary ---

  const summary = useMemo(() => {
    if (!result) return null;
    const sections: SectionKey[] = ["warmUp", "transition", "peak"];
    let total = 0,
      matched = 0,
      possible = 0,
      multiple = 0,
      missing = 0,
      excluded = 0;
    const sourceCounts: Record<SectionKey, { uploads: number; ai: number; library: number }> = {
      warmUp: { uploads: 0, ai: 0, library: 0 },
      transition: { uploads: 0, ai: 0, library: 0 },
      peak: { uploads: 0, ai: 0, library: 0 },
    };
    const perSection: Record<SectionKey, { total: number; matched: number; attention: number }> = {
      warmUp: { total: 0, matched: 0, attention: 0 },
      transition: { total: 0, matched: 0, attention: 0 },
      peak: { total: 0, matched: 0, attention: 0 },
    };
    sections.forEach((sec) => {
      result[sec].forEach((s, i) => {
        total += 1;
        const sExt = s as Song & { fromUpload?: boolean; aiSuggestion?: boolean };
        if (sExt.aiSuggestion) {
          sourceCounts[sec].ai += 1;
        } else if (sExt.fromUpload) {
          sourceCounts[sec].uploads += 1;
        } else {
          sourceCounts[sec].library += 1;
        }
        perSection[sec].total += 1;
        const m = matches[songKey(sec, i, s)];
        if (!m) {
          missing += 1;
          perSection[sec].attention += 1;
          return;
        }
        if (m.excludedFromVdj) excluded += 1;
        switch (m.status) {
          case "Matched":
          case "Manually Matched":
            matched += 1;
            perSection[sec].matched += 1;
            break;
          case "Possible Match":
            possible += 1;
            perSection[sec].attention += 1;
            break;
          case "Multiple Matches":
            multiple += 1;
            perSection[sec].attention += 1;
            break;
          case "Missing From Library":
            missing += 1;
            perSection[sec].attention += 1;
            break;
        }
      });
    });
    return { total, matched, possible, multiple, missing, excluded, csvIncluded: total, sourceCounts, perSection };
  }, [result, matches]);

  const searchResults = useMemo(() => {
    if (!searchOpen || !mergedLibrary || !searchQuery.trim()) return [];
    return searchLibrary(searchQuery, mergedLibrary, 30);
  }, [searchOpen, searchQuery, mergedLibrary]);

  const debouncedHours = useDebounce(hoursNum, 120);
  const debouncedExpand = useDebounce(expand, 120);
  const debouncedSongs = useDebounce(songs, 120);

  const [isPendingLive, startLiveTransition] = useTransition();

  function computeLiveTargets(songsArg: Song[], hoursArg: number) {
    const safeHours = hoursArg > 0 ? hoursArg : 0;
    const r = generateLists({
      uploaded: songsArg,
      hours: safeHours,
      expand: false,
      buffer,
      prefs: { artists: [], genres: [], decades: [], notes: "" },
    });
    return {
      total: r.perSectionTarget * 3,
      perSection: r.perSectionTarget,
      perSectionBase: r.perSectionBase,
      shortfall: r.shortfall,
    };
  }

  const [liveTargets, setLiveTargets] = useState(() =>
    computeLiveTargets(songs, hoursNum),
  );

  useEffect(() => {
    startLiveTransition(() => {
      setLiveTargets(computeLiveTargets(debouncedSongs, debouncedHours));
    });
    // debouncedExpand is intentionally part of deps for visual pending state only
    void debouncedExpand;
  }, [debouncedSongs, debouncedHours, debouncedExpand, buffer]);


  const [step, setStep] = useState(1);
  useEffect(() => {
    if (result) setStep(5);
  }, [result]);

  const stepDefs: StepDef[] = [
    { id: 1, label: "Dance floor", hint: hoursNum > 0 ? `${hoursNum}h` : "Set the vibe", done: !!result || (danceFloorConfirmed && hoursNum > 0) },
    { id: 2, label: "Upload lists", hint: "CSV or TXT", done: songs.length > 0 },
    { id: 3, label: "Review songs", hint: `${songs.length} imported`, done: songs.length > 0 },
    { id: 4, label: "Song expansion", hint: expand ? "On" : "Off", done: !!result },
    { id: 5, label: "Review & export", hint: result ? "Ready" : "Generate first", done: !!result, disabled: !result },
  ];

  return (
    <div className="min-h-dvh bg-background">
      <Toaster richColors position="top-right" />

      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0"><p className="eyebrow">Events / Builder</p><h1 className="mt-2 break-words font-display text-3xl tracking-tight sm:text-4xl">{eventName||"New event"}</h1></div>
        <div className="text-xs text-muted-foreground" role="status">{result ? saveState==="saving"?"Saving event…":saveState==="saved"?"Event saved automatically":saveState==="error"?"Event not saved":"Preparing event…" : "Not generated yet"}</div>
      </header>
      <div className="space-y-6 pb-32 pt-6">
        <div className="sticky top-3 z-30">
          <StepRail steps={stepDefs} current={step} onSelect={setStep} />
        </div>

        <main className="min-w-0 space-y-6">

        {/* Step 1 */}
        {step === 1 && (
        <StepPanel
          eyebrow="Step 1"
          title="Dance floor details"
          description="Set the vibe and length of the open dance floor."
        >
          <div className="space-y-5">

            <div>
              <Label htmlFor="eventName">Couple / Event name (optional)</Label>
              <Input
                id="eventName"
                placeholder="e.g. Smith Johnson Wedding"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                className="mt-1.5"
              />
              {eventName && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Files will be named: <code className="rounded bg-muted px-1 py-0.5 text-xs">{toKebabCase(eventName)}-warm-up.csv</code>
                </p>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="hours">Dance floor length (hours)</Label>
                <Input
                  id="hours"
                  type="number"
                  step="0.25"
                  min="0"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="mt-1.5"
                />
                {hoursNum > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground transition-opacity duration-150">
                    Warm Up ~{sectionMinutes} min · Transition ~{sectionMinutes} min · Peak ~{sectionMinutes} min · Target <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs (<span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> per section, {buffer}× buffer)
                  </p>
                )}
              </div>
              <div>
                <Label>Preferred decades</Label>
                <div className="mt-2 flex flex-wrap gap-3">
                  {DECADES.map((d) => (
                    <label key={d} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={decades.includes(d)}
                        onCheckedChange={(v) =>
                          setDecades(v ? [...decades, d] : decades.filter((x) => x !== d))
                        }
                      />
                      {d}
                    </label>
                  ))}
                </div>
                {hoursNum > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground transition-opacity duration-150">
                    Target <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs · <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> per section ({buffer}× buffer)

                  </p>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="artists">Favorite artists (comma separated)</Label>
              <Input id="artists" value={artistsInput} onChange={(e) => setArtistsInput(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="genres">Favorite genres (comma separated)</Label>
              <Input id="genres" value={genresInput} onChange={(e) => setGenresInput(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="notes">Additional notes</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" rows={3} />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="donotplay">Do Not Play list</Label>
                <div className="flex items-center gap-2">
                  <input
                    ref={dnpFileRef}
                    type="file"
                    accept=".csv,.txt"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void handleDnpFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => dnpFileRef.current?.click()}>
                    <Upload className="mr-1 h-4 w-4" />
                    Upload list
                  </Button>
                  {dnpDuplicateKeys.size > 0 && (
                    <Button type="button" variant="outline" size="sm" onClick={removeDnpDuplicates}>
                      <Check className="mr-1 h-4 w-4" />
                      Remove duplicates
                    </Button>
                  )}
                  {doNotPlayInput && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDoNotPlayInput("")}>
                      <Trash2 className="mr-1 h-4 w-4" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDnpDragOver(true); }}
                onDragLeave={() => setDnpDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDnpDragOver(false);
                  if (e.dataTransfer.files?.length) void handleDnpFiles(e.dataTransfer.files);
                }}
                className={`mt-1.5 rounded-md ${dnpDragOver ? "ring-2 ring-primary" : ""}`}
              >
                <Textarea
                  id="donotplay"
                  value={doNotPlayInput}
                  onChange={(e) => setDoNotPlayInput(e.target.value)}
                  className="font-mono text-sm"
                  rows={4}
                  placeholder={"One per line\nArtist - Song  (blocks that track)\nArtist          (blocks all songs by that artist)\n\nOr drop a .csv/.txt file here"}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Upload a .csv (Artist, Song columns) or .txt file, or type entries. Blocked songs are removed from your uploads and excluded from library expansion, with duplicates filtered out of the final CSV exports.
                {doNotPlayEntries.length > 0 && (
                  <span className="ml-1 font-medium text-foreground">
                    {doNotPlayEntries.length} blocked
                  </span>
                )}
              </p>
              {doNotPlayEntries.length > 0 && (
                <div className="mt-3 rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Artist</TableHead>
                        <TableHead>Song</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {doNotPlayEntries.map((entry, i) => {
                        const dupKey = `${normalizeKey(entry.artist)}|${normalizeKey(entry.song || "")}`;
                        const isDup = dnpDuplicateKeys.has(dupKey);
                        return (
                          <TableRow key={`${entry.artist}-${entry.song || ""}-${i}`} className={isDup ? "bg-warning/10" : undefined}>
                            <TableCell className="py-2">
                               <span className={isDup ? "font-medium text-warning" : undefined}>
                                {entry.artist}
                              </span>
                            </TableCell>
                            <TableCell className="py-2 text-muted-foreground">
                              {entry.song || <span className="italic">All songs</span>}
                            </TableCell>
                            <TableCell className="py-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => removeDoNotPlayEntry(i)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            </div>
          </StepPanel>

        )}


        {/* Step 2 */}
        {step === 2 && (
        <StepPanel
          eyebrow="Step 2"
          title="Upload song lists"
          description="Drop one or more CSV or TXT files. Processed in your browser."
        >

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
                dragOver ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
              }`}
            >
              <Upload className={`mb-3 h-8 w-8 ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
              <p className="font-medium">
                {dragOver ? "Release to upload" : "Drop CSV or TXT files here, or click to browse"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Multiple files supported · max 5 MB each</p>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="mt-6 border-t border-border pt-5"><Label htmlFor="spotify-url">Spotify playlist link (optional)</Label><div className="mt-2 flex flex-wrap gap-2"><Input id="spotify-url" type="url" value={spotifyLink} onChange={e=>setSpotifyLink(e.target.value)} placeholder="https://open.spotify.com/playlist/…" className="min-w-52 flex-1"/><Button variant="outline" onClick={()=>toast.info("Spotify does not provide track lists from public links without account access. Export that playlist as CSV or TXT and upload it above.")}>Import link</Button></div><p className="mt-2 text-xs text-muted-foreground">Public links may require Spotify access. CSV or TXT always works without connecting an account.</p></div>
            {uploadStatuses.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Files</p>
                  <Button variant="ghost" size="sm" onClick={() => setUploadStatuses([])}>
                    Clear
                  </Button>
                </div>
                <ul className="space-y-2">
                  {uploadStatuses.map((s) => (
                    <li
                      key={s.id}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        s.state === "error"
                          ? "border-destructive/50 bg-destructive/10"
                          : s.state === "done"
                            ? "border-primary/40 bg-primary/5"
                            : "border-border"
                      }`}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <span className="truncate font-medium">{s.name}</span>
                        <span className="shrink-0 text-xs">
                          {s.state === "parsing" && <span className="text-muted-foreground">Reading…</span>}
                          {s.state === "done" && <span className="text-primary">✓ {s.count} songs</span>}
                          {s.state === "error" && <span className="text-destructive">Not imported</span>}
                        </span>
                      </div>
                      {s.message && <p className="mt-1 text-xs text-muted-foreground">{s.message}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </StepPanel>
        )}


        {/* Step 3 */}
        {step === 3 && (
        <StepPanel
          eyebrow="Step 3"
          title="Review imported songs"
          description={`${songs.length} song${songs.length === 1 ? "" : "s"} imported · edit, add, or remove rows`}
          actions={
            <>
              {duplicateKeys.size > 0 && (
                <Button variant="destructive" size="sm" onClick={removeDuplicates}>
                  <AlertTriangle className="mr-1 h-4 w-4" />
                  Remove {duplicateKeys.size} duplicate{duplicateKeys.size > 1 ? "s" : ""}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setSongs([...songs, { artist: "", song: "" }])}>
                <Plus className="mr-1 h-4 w-4" />
                Add row
              </Button>
            </>
          }
        >

            {duplicateKeys.size > 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="flex-1">
                  {duplicateKeys.size} unique duplicate{duplicateKeys.size > 1 ? "s" : ""} detected.
                </span>
              </div>
            )}
            {songs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No songs imported yet</p>
            ) : (
              <div className="max-h-96 overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artist</TableHead>
                      <TableHead>Song</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {songs.map((s, i) => {
                      const isDup = duplicateKeys.has(dedupeKey(s.artist, s.song));
                      return (
                        <TableRow key={i} className={isDup ? "bg-destructive/10 border-destructive/30" : ""}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {isDup && (
                                <span title="Duplicate song" className="shrink-0">
                                  <AlertTriangle className="h-4 w-4 text-destructive" />
                                </span>
                              )}
                              <Input
                                value={s.artist}
                                onChange={(e) => {
                                  const next = [...songs];
                                  next[i] = { ...next[i], artist: e.target.value };
                                  setSongs(next);
                                }}
                                className={isDup ? "border-destructive/50" : ""}
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={s.song}
                              onChange={(e) => {
                                const next = [...songs];
                                next[i] = { ...next[i], song: e.target.value };
                                setSongs(next);
                              }}
                              className={isDup ? "border-destructive/50" : ""}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Remove song"
                              onClick={() => setSongs(songs.filter((_, j) => j !== i))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </StepPanel>
        )}


        {/* Step 4 */}
        {step === 4 && (
        <StepPanel
          eyebrow="Step 4"
          title="Song expansion"
          description="Let the AI reach beyond the uploaded lists to fill each section."
        >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 rounded-lg border border-border/70 bg-surface/60 p-4">
              <div className="min-w-0">
                <p className="font-medium">Add additional songs based on artist, genre, and decade preferences</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  When turned off, the app will only use songs from the uploaded files.
                </p>
                {hoursNum > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground transition-opacity duration-150">
                    Target <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs · <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> per section ({buffer}× buffer)
                  </p>
                )}
              </div>
              <Switch checked={expand} onCheckedChange={setExpand} className="shrink-0" />
            </div>
            <div className="mt-5 flex items-center gap-3"><Label htmlFor="buffer">Song buffer</Label><select id="buffer" className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={buffer} onChange={e=>setBuffer(Number(e.target.value))}>{[2,3,4].map(n=><option key={n} value={n}>{n}×</option>)}</select></div>
            {hoursNum > 0 && !expand && liveTargets.shortfall.total > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />

                <div>
                  <p className="font-medium">Not enough uploaded songs to hit the {buffer}× buffer.</p>
                  <p className="mt-1 text-xs">
                    Short by <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.shortfall.warmUp}</span> in Warm Up,
                    {" "}<span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.shortfall.transition}</span> in Transition,
                    {" "}<span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.shortfall.peak}</span> in Peak
                    {" "}(<span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.shortfall.total}</span> total).
                    Turn on song expansion above to fill the gap from the library.
                  </p>
                </div>
              </div>
            )}

          </StepPanel>
        )}


        {/* Results */}
        {step === 5 && result && (
          <StepPanel
            eyebrow="Step 5"
            title="Review & export"
            description="Each CSV exports with exactly two columns: Artist, Song."
          >
            <div className="space-y-4">

              {summary && <div className="grid gap-4 sm:grid-cols-2"><div className="border-y border-border py-3"><h3 className="text-xs font-semibold uppercase text-muted-foreground">Match summary · {activeSection === "warmUp" ? "Warm Up" : activeSection === "transition" ? "Transition" : "Peak"}</h3><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm"><span>{summary.perSection[activeSection].matched} matched</span><span className="text-warning">{summary.perSection[activeSection].attention} need attention</span><span>{summary.perSection[activeSection].total} total</span></div></div><div className="border-y border-border py-3"><h3 className="text-xs font-semibold uppercase text-muted-foreground">Song sources</h3><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm"><span>{summary.sourceCounts[activeSection].uploads} Upload</span><span>{summary.sourceCounts[activeSection].ai} AI</span><span>{summary.sourceCounts[activeSection].library} Library</span></div></div></div>}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={exportAllZip}>
                  <Download className="mr-1 h-4 w-4" /> Export All Files as ZIP
                </Button>
                <Button
                  variant="secondary"
                  onClick={exportAllToVdj}
                  disabled={!canDirWrite || software !== "VirtualDJ"}
                  title={
                    canDirWrite
                      ? vdjDirName
                        ? `Write all files directly to ${vdjDirName}`
                        : "Choose a folder, then write all files directly to it"
                      : "Direct folder export requires a Chromium-based browser"
                  }
                >
                  <FolderOpen className="mr-1 h-4 w-4" />
                  {vdjDirName ? `Export All to VirtualDJ (${vdjDirName})` : "Export All to VirtualDJ folder…"}
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={includeCombined} onCheckedChange={(v) => setIncludeCombined(!!v)} />
                  Include combined reference CSV
                </label>
              </div>

              {result.finalShortfall && result.finalShortfall.total > 0 ? (
                 <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="w-full">
                    <div className="font-medium">Not enough songs to fully fill every section</div>
                    <div className="mt-1.5 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                       <div className="rounded border border-warning/30 bg-warning/5 px-2 py-1.5 text-center">
                        <div className="font-semibold">Warm Up</div>
                        <div>{result.warmUp.length} / {result.perSectionTarget}</div>
                         <div className="text-warning">-{result.finalShortfall.warmUp} short</div>
                      </div>
                       <div className="rounded border border-warning/30 bg-warning/5 px-2 py-1.5 text-center">
                        <div className="font-semibold">Transition</div>
                        <div>{result.transition.length} / {result.perSectionTarget}</div>
                         <div className="text-warning">-{result.finalShortfall.transition} short</div>
                      </div>
                       <div className="rounded border border-warning/30 bg-warning/5 px-2 py-1.5 text-center">
                        <div className="font-semibold">Peak</div>
                        <div>{result.peak.length} / {result.perSectionTarget}</div>
                         <div className="text-warning">-{result.finalShortfall.peak} short</div>
                      </div>
                    </div>

                    <div className="mt-1.5 text-xs">
                      Target {result.perSectionTarget} songs per section. The lowest-energy songs are still first and the highest-energy last — add more uploads, turn on AI/library expansion, or shorten the dance-floor length to close the gap.
                    </div>
                  </div>
                </div>
              ) : null}

              <Tabs value={activeSection} onValueChange={v=>setActiveSection(v as SectionKey)}>
                 <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 border-b border-border bg-transparent p-0">
                  {(["warmUp", "transition", "peak"] as SectionKey[]).map((sec) => {
                    const label = sec === "warmUp" ? "Warm Up" : sec === "transition" ? "Transition" : "Peak";
                    const ps = summary?.perSection[sec];
                    const shortfall = result.finalShortfall?.[sec] ?? 0;
                    return (
                       <TabsTrigger key={sec} value={sec} className="h-auto min-w-0 whitespace-normal rounded-none border-b-2 border-transparent px-3 py-2 text-left leading-tight data-[state=active]:border-primary data-[state=active]:bg-sidebar-accent">
                        <span className="flex flex-col gap-0.5">
                          <span>
                            {label} ({result[sec].length}{shortfall > 0 ? ` / ${result.perSectionTarget}, -${shortfall}` : ""})
                          </span>
                          {ps && (
                            <span className="flex flex-wrap items-center gap-1 text-[10px] font-normal">
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-1.5 py-0.5 text-success">
                                <CheckCircle2 className="h-2.5 w-2.5" /> {ps.matched} matched
                              </span>
                              {ps.attention > 0 ? (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-warning">
                                  <AlertTriangle className="h-2.5 w-2.5" /> {ps.attention} need attention
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-1.5 py-0.5 text-success">
                                  all matched
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {(["warmUp", "transition", "peak"] as SectionKey[]).map((sec) => (
                  <TabsContent key={sec} value={sec}>
                    <SectionView
                      section={sec}
                      songs={result[sec]}
                      matches={matches}
                      library={mergedLibrary}
                      songKey={songKey}
                      onExportCsv={() => exportSectionCsv(sec)}
                       onExportPdf={() => exportSectionPdf(sec)}
                      onExportXml={() => exportSectionXml(sec)}
                      onExportM3u={() => exportSectionM3u(sec)}
                      onExportXmlToVdj={() => exportSectionXmlToVdj(sec)}
                      onExportM3uToVdj={() => exportSectionM3uToVdj(sec)}
                      canWriteToVdj={canDirWrite}
                      vdjFolderName={vdjDirName}
                      onConfirm={confirmMatch}
                      onChoose={chooseAlternative}
                      onMarkUnresolved={markUnresolved}
                      onToggleExclude={toggleExclude}
                       onToggleExtra={toggleExtraPick}
                       matchLimit={matchLimit}
                       matcherOn={matcherOn}
                       software={software}
                       reviewMode={reviewMode}
                       onReviewModeChange={mode => applyReviewMode(mode, sec)}
                     onOpenSearch={openSearch}
                     onPickLocalFile={pickLocalFileForMatch}
                      onPreview={(t) => setPreviewTarget(t)}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </StepPanel>
        )}

        <footer className="space-y-1 py-6 text-center text-xs text-muted-foreground">
          <p>Audio files stay on your computer. Event lists and your library index are saved for your account.</p>
          <p className="text-[11px] opacity-80">
            Dancefloor Builder v{APP_VERSION} · Updated {formatBuildDate()}
          </p>
        </footer>
        </main>
      </div>

      {/* Sticky action bar */}
      <div className={`fixed inset-x-0 ${previewTarget ? "bottom-24" : "bottom-0"} z-30 lg:left-60 border-t border-border/70 bg-background/90 backdrop-blur`}>
        <div className="mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          <p className="min-w-0 truncate text-center text-xs text-muted-foreground">
            {hoursNum > 0
              ? `Target ${liveTargets.total} songs · ${liveTargets.perSection} per section (${buffer}× buffer)`
              : "Set the dance floor length to see song targets"}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {step < 4 && (
              <Button
                size="sm"
                onClick={() => {
                  if (step === 1 && hoursNum > 0) setDanceFloorConfirmed(true);
                  setStep((s) => Math.min(5, s + 1));
                }}
              >
                Continue <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
            {step === 4 && (
              <Button size="sm" className="glow-gold" onClick={generate} disabled={isGenerating}>
                {isGenerating ? "Generating with AI…" : "Generate dance floor lists"}
              </Button>
            )}
            {step === 5 && (
              <>
                <Button size="sm" variant="outline" onClick={generate} disabled={isGenerating}>
                  {isGenerating ? "Generating…" : "Regenerate"}
                </Button>
                <Button size="sm" className="glow-gold" onClick={exportAllZip}>
                  <Download className="mr-1 h-4 w-4" /> Export all
                </Button>
              </>
            )}
          </div>
        </div>
      </div>


      <Dialog open={!!searchOpen} onOpenChange={(o) => { if (!o) { setSearchOpen(null); setSearchQuery(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Search music folders</DialogTitle>
            <DialogDescription>Pick a track to manually match.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Search by artist or title…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="max-h-80 overflow-auto rounded-md border">
            {!mergedLibrary ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No library loaded</p>
            ) : searchResults.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No matches</p>
            ) : (
              <Table>
                <TableBody>
                  {searchResults.map((i) => {
                    const t = mergedLibrary.tracks[i];
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <p className="font-medium">{t.artist} — {t.title}</p>
                          <p className="break-all text-xs text-muted-foreground">{resolveExportPath(t.filePath) ?? t.filePath}</p>
                        </TableCell>
                        <TableCell className="w-32">
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPreviewTarget({ artist: t.artist, song: t.title, filePath: t.filePath })}
                              title="Preview"
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => applySearchPick(i)}>
                              <Check className="mr-1 h-4 w-4" /> Pick
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <WaveformPlayer key={`preview-${workflowInstanceId}`} target={previewTarget} onClose={() => setPreviewTarget(null)} resolve={resolveLocalFile} />
    </div>
  );
}
type BadgeSong = Song & {
  fromUpload?: boolean;
  aiSuggestion?: boolean;
  aiReason?: string;
  placementReason?: string;
  waveRole?: "lift" | "breather";
  stretched?: boolean;
  naturalSection?: "Warm Up" | "Transition" | "Peak";
  reused?: boolean;
  energy?: number;
  danceability?: number;
  popularity?: number;
  valence?: number;
  bpm?: number;
  camelot?: string;
  genre?: string;
  year?: number;
  mood?: string;
  explicit?: boolean;
  metaSource?: "Online" | "VirtualDJ" | "AI" | "Library" | "Upload" | "Estimated";
};


function MetricsDetail({ song }: { song: BadgeSong }) {
  const hasAny =
    typeof song.energy === "number" ||
    typeof song.danceability === "number" ||
    typeof song.popularity === "number" ||
    typeof song.valence === "number" ||
    typeof song.bpm === "number" ||
    !!song.camelot ||
    !!song.genre ||
    typeof song.year === "number";
  if (!hasAny) return <span className="text-xs text-muted-foreground">No metrics available</span>;
  const fmt = (n?: number) => (typeof n === "number" ? n.toFixed(1).replace(/\.0$/, "") : "—");
  const intensity =
    typeof song.energy === "number" && typeof song.danceability === "number"
      ? ((song.energy + song.danceability) / 2).toFixed(1)
      : null;
  const items = [
    { label: "Energy", value: fmt(song.energy) },
    { label: "Danceability", value: fmt(song.danceability) },
    { label: "Popularity", value: fmt(song.popularity) },
    { label: "Valence", value: fmt(song.valence) },
    intensity ? { label: "Intensity (avg)", value: intensity } : null,
    typeof song.bpm === "number" ? { label: "BPM", value: Math.round(song.bpm).toString() } : null,
    song.camelot ? { label: "Key", value: song.camelot } : null,
    song.genre ? { label: "Genre", value: song.genre } : null,
    typeof song.year === "number" ? { label: "Year", value: String(song.year) } : null,
    song.mood ? { label: "Mood", value: song.mood } : null,
    song.metaSource
      ? {
          label: "Source",
          value:
            song.metaSource === "Online"
              ? "ReccoBeats + MusicBrainz"
              : song.metaSource === "VirtualDJ"
                ? "VirtualDJ (offline fallback)"
                : song.metaSource,
        }
      : null,
    song.aiReason ? { label: "AI reasoning", value: song.aiReason } : null,
    song.placementReason ? { label: "Why here", value: song.placementReason } : null,
  ].filter(Boolean) as { label: string; value: string }[];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">{item.label}:</span>
          <span className="font-medium tabular-nums">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function SourceBadge({ song }: { song: BadgeSong }) {
  if (song.aiSuggestion) {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px] bg-violet-100 text-violet-800 border-violet-200 hover:bg-violet-100">
        <Sparkles className="h-3 w-3" /> AI
      </Badge>
    );
  }
  if (song.fromUpload) {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px] bg-sky-100 text-sky-800 border-sky-200 hover:bg-sky-100">
        <Upload className="h-3 w-3" /> Upload
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-[10px] bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-100">
      <Database className="h-3 w-3" /> Library
    </Badge>
  );
}

function FallbackBadges({ song }: { song: BadgeSong }) {
  const olderFriendly = typeof song.year === "number" && song.year < 1990;
  const isExplicit = song.explicit === true || detectExplicitFromTitle(song.song);
  return (
    <>
      {olderFriendly && (
        <Badge
          variant="secondary"
          className="gap-1 text-[10px] bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-100"
          title={`Pre-1990 (${song.year}) — biased toward Warm Up / Transition for older guests`}
        >
          Older-friendly
        </Badge>
      )}
      {isExplicit && (
        <Badge
          variant="secondary"
           className="gap-1 border-destructive/30 bg-destructive/10 text-[10px] text-destructive"
          title="Explicit / aggressive lyrics — biased toward Transition / Peak"
        >
          Explicit
        </Badge>
      )}
      {song.stretched && (
        <Badge
          variant="secondary"
           className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning"
          title={song.naturalSection ? `Natural fit: ${song.naturalSection} — stretched to fill the ramp` : "Stretched to fill the ramp"}
        >
          Stretched{song.naturalSection ? ` ← ${song.naturalSection}` : ""}
        </Badge>
      )}
      {song.reused && (
        <Badge
          variant="secondary"
           className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning"
          title="Reused across sections to plug a shortfall"
        >
          Reused
        </Badge>
      )}
    </>
  );
}


function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "destructive" }) {
  const toneCls =
     tone === "success" ? "text-success" :
     tone === "warning" ? "text-warning" :
    tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-md border bg-background p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${toneCls}`}>{value}</p>
    </div>
  );
}

function statusBadge(status: MatchStatus) {
  const map: Record<MatchStatus, string> = {
     "Matched": "bg-success/10 text-success border-success/30",
     "Manually Matched": "bg-success/10 text-success border-success/30",
     "Possible Match": "bg-warning/10 text-warning border-warning/30",
     "Multiple Matches": "bg-warning/10 text-warning border-warning/30",
     "Missing From Library": "bg-destructive/10 text-destructive border-destructive/30",
  };
  return <Badge variant="outline" className={map[status]}>{status}</Badge>;
}

interface SectionViewProps {
  section: SectionKey;
  songs: Song[];
  matches: Record<string, SongMatch>;
  library: VdjLibrary | null;
  songKey: (section: SectionKey, idx: number, s: Song) => string;
  onExportCsv: () => void;
  onExportPdf: () => void;
  onExportXml: () => void;
  onExportM3u: () => void;
  onExportXmlToVdj: () => void;
  onExportM3uToVdj: () => void;
  canWriteToVdj: boolean;
  vdjFolderName: string | null;
  onConfirm: (key: string) => void;
  onChoose: (key: string, trackIndex: number) => void;
  onMarkUnresolved: (key: string) => void;
  onToggleExclude: (key: string) => void;
  onToggleExtra: (key: string, trackIndex: number) => void;
  onOpenSearch?: (section: SectionKey, idx: number, s: Song) => void;
  onPickLocalFile?: (key: string, file: File) => void;
  onPreview?: (target: PreviewTarget) => void;
  matchLimit: number; matcherOn: boolean; software: string;
  reviewMode: "first" | "most" | "all" | "none";
  onReviewModeChange: (mode: "first" | "most" | "all" | "none") => void;
}

function SectionView(props: SectionViewProps) {
  const { section, songs, matches, library, songKey, onExportCsv, onExportPdf, onExportXml, onExportM3u, onExportXmlToVdj, onExportM3uToVdj, canWriteToVdj, vdjFolderName, onConfirm, onChoose, onMarkUnresolved, onToggleExclude, onToggleExtra, onPreview, onPickLocalFile, matchLimit, matcherOn, software, reviewMode, onReviewModeChange } = props;
  const sectionLabel = section === "warmUp" ? "Warm Up" : section === "transition" ? "Transition" : "Peak";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter,setFilter] = useState("all");
  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const vdjTitle = vdjFolderName
    ? `Write directly to ${vdjFolderName}`
    : canWriteToVdj
      ? "Choose a folder, then write directly to it"
      : "Direct folder export requires a Chromium-based browser";
  const statuses = songs.map((s, i) => matches[songKey(section, i, s)]?.status);
  const matchedCount = statuses.filter((st) => st === "Matched" || st === "Manually Matched").length;
  const reviewCount = statuses.filter((st) => st === "Possible Match" || st === "Multiple Matches").length;
  return (
    <div className="space-y-5">
       <div className="flex flex-wrap justify-start gap-2 border-b border-border pb-4">
        <Button size="sm" variant="outline" onClick={onExportPdf}><Download className="mr-1 size-4"/> PDF</Button>
        <Button size="sm" variant="outline" onClick={onExportCsv}>
          <Download className="mr-1 h-4 w-4" /> Download {sectionLabel} CSV
        </Button>
        <Button size="sm" variant="outline" onClick={onExportXml} disabled={!library || software !== "VirtualDJ"}>
          <Download className="mr-1 h-4 w-4" /> Download {sectionLabel} song list (.txt)
        </Button>
        <Button size="sm" variant="outline" onClick={onExportM3u} disabled={!library}>
          <Download className="mr-1 h-4 w-4" /> Download M3U {sectionLabel} Playlist
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onExportXmlToVdj}
          disabled={!library || !canWriteToVdj || software !== "VirtualDJ"}
          title={vdjTitle}
        >
          <FolderOpen className="mr-1 h-4 w-4" /> {sectionLabel} .txt → VirtualDJ
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onExportM3uToVdj}
          disabled={!library || !canWriteToVdj || software !== "VirtualDJ"}
          title={vdjTitle}
        >
          <FolderOpen className="mr-1 h-4 w-4" /> {sectionLabel} M3U → VirtualDJ
        </Button>
      </div>
       <div className="panel-quiet flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Track matcher options</span>
        {library && ([["first","Select first"],["most","Select most played"],["all","Select all"],["none","Unselect all"]] as const).map(([mode,label])=>(
          <Button key={mode} size="sm" className="h-7 px-2 text-xs" variant={reviewMode===mode?"secondary":"outline"} onClick={()=>onReviewModeChange(mode)}>{label}</Button>
        ))}
        <span className="text-xs tabular-nums text-muted-foreground">
          <strong className="text-foreground">{matchedCount}</strong> / {songs.length} matched
          {reviewCount > 0 && <> · <span className="text-warning">{reviewCount} review</span></>}
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          {[["all","All"],["matched","Matched"],["unmatched","Unmatched"],["review","Review"]].map(([value,label])=>(
            <Button key={value} size="sm" className={`h-7 rounded-full px-3 text-xs ${filter===value?"":"text-muted-foreground"}`} variant={filter===value?"default":"ghost"} onClick={()=>setFilter(value)}>{label}</Button>
          ))}
        </div>
        {reviewMode === "most" && <p className="w-full text-xs text-warning">Play counts unavailable for folder-only sources; first result is used.</p>}
      </div>

       <div className="space-y-3">
        {songs.length === 0 ? (
          <p className="panel px-4 py-8 text-center text-sm text-muted-foreground">No songs in this section</p>
        ) : songs.map((s, i) => {
          const key = songKey(section, i, s);
          const m = matches[key];
          const track: VdjTrack | undefined = library && m?.trackIndex != null ? library.tracks[m.trackIndex] : undefined;
          const isMatched = m?.status === "Matched" || m?.status === "Manually Matched";
          if (filter === "matched" && !isMatched || filter === "unmatched" && m?.trackIndex != null || filter === "review" && (isMatched || !m)) return null;
          const meta = s as BadgeSong;
          const needsAttention = !isMatched;
          const selectedCount = (m?.trackIndex != null ? 1 : 0) + (m?.extraTrackIndices?.length ?? 0);
          return (
            <div key={key} className={`panel overflow-hidden ${m?.excludedFromVdj ? "opacity-60" : ""}`}>
              {/* Track header */}
              <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-stretch gap-3 p-3 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto]">
                <div className="flex w-8 flex-col items-center justify-center gap-1">
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                  {needsAttention && <AlertTriangle className="size-3.5 text-warning" />}
                </div>
                <button
                  type="button"
                  onClick={() => onPreview?.({ artist: s.artist, song: s.song, filePath: track?.filePath, matchConfidence: track && m ? m.confidence : undefined })}
                  title="Preview song"
                  className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <Music className="size-6" />
                </button>
                <div className="hairline-y min-w-0">
                  <div className="px-3 py-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Title</p>
                    <p className="break-words font-display text-base leading-tight">{s.song}</p>
                  </div>
                  <div className="px-3 py-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Artist</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words text-sm leading-tight">{s.artist}</p>
                      {s.artist?.trim() && (
                        <a
                          href={`https://www.music-map.com/${encodeURIComponent(s.artist.trim().toLowerCase().replace(/\s+/g, "+"))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`See artists similar to ${s.artist} on Music-Map`}
                          className="text-muted-foreground transition-colors hover:text-primary"
                        >
                          <MapIcon className="size-3.5" />
                        </a>
                      )}
                      <SourceBadge song={meta} />
                      <FallbackBadges song={meta} />
                    </div>
                  </div>
                </div>
                <div className="col-span-3 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
                  <Hud label="Energy" value={meta.energy != null ? Math.round(meta.energy) : "—"} />
                  <Hud label="Dance" value={meta.danceability != null ? Math.round(meta.danceability) : "—"} />
                  <Hud label="Mood" value={meta.valence != null ? Math.round(meta.valence) : "—"} />
                  <Hud label="Key" value={track?.key || meta.camelot || "—"} />
                  <Hud label="BPM" value={track?.bpm || (meta.bpm != null ? Math.round(meta.bpm) : "—")} />
                </div>
              </div>

              {/* Action bar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                {library && (m ? statusBadge(m.status) : statusBadge("Missing From Library"))}
                {m && track && <span className="text-[11px] text-muted-foreground">{Math.round(m.confidence * 100)}% confidence</span>}
                {selectedCount > 1 && <span className="bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{selectedCount} files selected</span>}
                <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
                {library && m?.status === "Possible Match" && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => onConfirm(key)}>
                    <Check className="mr-1 h-3 w-3" /> Confirm
                  </Button>
                )}
                {library && (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onMarkUnresolved(key)} title="Mark unresolved">
                      <X className="mr-1 h-3 w-3" /> Unresolved
                    </Button>
                    <Button
                      size="sm"
                      variant={m?.excludedFromVdj ? "default" : "ghost"}
                      className="h-7 px-2 text-xs"
                      onClick={() => onToggleExclude(key)}
                      title="Exclude from VirtualDJ export"
                    >
                      VDJ
                    </Button>
                  </>
                )}
                <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => toggleExpanded(key)}>
                  {expanded.has(key) ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
                  Details
                </Button>
              </div>

              {expanded.has(key) && (
                <div className="border-b border-border bg-muted/20 px-3 py-2">
                  <MetricsDetail song={meta} />
                </div>
              )}

              {library && (
                <div className="px-3 py-3">
                  <InlineMatchSearch
                    song={s}
                    library={library}
                    currentTrackIndex={m?.trackIndex}
                    extraTrackIndices={m?.extraTrackIndices ?? []}
                    onPick={(ti) => onChoose(key, ti)}
                    onToggleExtra={(ti) => onToggleExtra(key, ti)}
                    onPreview={onPreview}
                    onPickLocalFile={onPickLocalFile ? (file) => onPickLocalFile(key, file) : undefined}
                    matchLimit={matchLimit}
                    matcherOn={matcherOn}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Hud({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-muted/30 px-2.5 py-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-6 text-center text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}


function InlineMatchSearch({
  song,
  library,
  currentTrackIndex,
  extraTrackIndices,
  onPick,
  onToggleExtra,
  onPreview,
  onPickLocalFile, matchLimit, matcherOn,
}: {
  song: Song;
  library: VdjLibrary;
  currentTrackIndex?: number;
  extraTrackIndices: number[];
  onPick: (trackIndex: number) => void;
  onToggleExtra: (trackIndex: number) => void;
  onPreview?: (target: PreviewTarget) => void;
  onPickLocalFile?: (file: File) => void;
  matchLimit: number; matcherOn: boolean;
}) {
  const localFileRef = useRef<HTMLInputElement>(null);
  const defaultQuery = `${song.artist} ${song.song}`.trim();
  const [query, setQuery] = useState(defaultQuery);
  const [showAll, setShowAll] = useState(false);
  // If this component instance gets reused for a different song (list
  // regenerated/reordered), reset the query so the results below always
  // belong to the song shown in the row above.
  const [trackedSong, setTrackedSong] = useState(defaultQuery);
  if (trackedSong !== defaultQuery) {
    setTrackedSong(defaultQuery);
    setQuery(defaultQuery);
    setShowAll(false);
  }
  const debounced = useDebounce(query, 150);
  const limit = showAll ? 200 : matchLimit;
  const allResults = useMemo(() => {
    const q = debounced.trim();
    if (!q) return [];
    return searchLibraryScored(q, library, limit);
  }, [debounced, library, limit]);
  const results = allResults;
  const hasMore = !showAll && results.length >= matchLimit;
  const extraSet = new Set(extraTrackIndices);
  const totalSelected = (currentTrackIndex != null ? 1 : 0) + extraTrackIndices.length;
  const bestPlays = Math.max(0, ...results.map((r) => library.tracks[r.i]?.playCount ?? 0));

  return (
     <div className="space-y-2">
       <div className="flex flex-wrap items-center gap-2">
        <span className="border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          Files ({results.length})
        </span>
        {onPickLocalFile && (
          <>
            <input
              ref={localFileRef}
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac,.aif,.aiff,.wma,.opus,.alac"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickLocalFile(f);
                if (localFileRef.current) localFileRef.current.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => localFileRef.current?.click()}
              title="Pick an audio file from your computer"
            >
              <FolderOpen className="mr-1 h-3 w-3" />
              Add local file
            </Button>
          </>
        )}
        {totalSelected > 1 && (
          <span className="shrink-0 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
            {totalSelected} selected
          </span>
        )}
        {query !== defaultQuery && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setQuery(defaultQuery)}>
            Reset search
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search local files…"
          className="h-9 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
      {!matcherOn && <p className="text-xs text-muted-foreground">Automatic selection is off; you can still choose files here.</p>}
      {results.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No matches in library. Try editing the search above (artist, title, or part of the file name){onPickLocalFile ? ", or click Add local file to pick one from your computer" : ""}.
        </p>
      ) : (
        <>
           <ul className="hairline-y overflow-hidden rounded-xl border border-border">
            {results.map(({ i: ti, s: score }) => {
              const t = library.tracks[ti];
              const isCurrent = ti === currentTrackIndex;
              const isExtra = extraSet.has(ti);
              const selected = isCurrent || isExtra;
              const pct = Math.round(score * 100);
              const mostPlayed = bestPlays > 0 && (t.playCount ?? 0) === bestPlays;
              return (
                 <li
                   key={ti}
                   className={`grid grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-xs hover:bg-muted/50 ${selected ? "border-l-2 border-l-success bg-success/5" : "border-l-2 border-l-transparent"}`}
                 >
                   {onPreview ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 p-0 text-primary"
                      onClick={() => onPreview({ artist: t.artist, song: t.title, filePath: t.filePath })}
                      title="Preview / play this file"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </Button>
                   ) : <span />}
                   <Checkbox checked={selected} aria-label={`Select ${t.artist} — ${t.title}`} onCheckedChange={() => selected ? (isCurrent ? onPick(-1) : onToggleExtra(ti)) : (currentTrackIndex == null ? onPick(ti) : onToggleExtra(ti))} className="shrink-0"/>
                   <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${pct >= 82 ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{pct}%</span>
                   <div className="min-w-0">
                     <p className="break-words font-medium">{t.title} — {t.artist}</p>
                      <p className="break-all text-[11px] text-muted-foreground">{resolveExportPath(t.filePath) ?? t.filePath}</p>
                   </div>
                   <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                     {mostPlayed && <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success">Most played</span>}
                     {t.playCount != null && <span className="tabular-nums">Plays {t.playCount.toLocaleString()}</span>}
                     <span className="rounded-full bg-muted/40 px-1.5 py-0.5 font-semibold text-foreground">{t.key || "—"}</span>
                     <span className="tabular-nums">BPM <strong className="text-foreground">{t.bpm || "—"}</strong></span>
                   </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Showing {results.length}
              {showAll ? ` of up to ${limit}` : ""} result{results.length === 1 ? "" : "s"}
            </span>
            {(hasMore || showAll) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? `Show top ${matchLimit}` : "Search full library"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>

  );
}
