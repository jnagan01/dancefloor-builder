import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import JSZip from "jszip";
import {
  parseFile,
  dedupeSongs,
  dedupeKey,
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
  type Song,
  type GenerationResult,
  type Preferences,
} from "@/lib/danceFloor";

import {
  parseVdjDatabaseXml,
  buildLibrary,
  tracksFromAudioFiles,
  mergeLibraries,
  matchSong,
  searchLibrary,
  buildVirtualDjXml,
  buildM3u,
  pickXmlFiles,
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
import { Trash2, Upload, Plus, Download, Music, AlertTriangle, FolderOpen, Search, X, Check, Sparkles, Database, HardDrive, ChevronDown, ChevronUp } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { DjAccountBar, type WorkflowSnapshot } from "@/components/HistoryPanel";
import { useServerFn } from "@tanstack/react-start";
import { recommendSongsForSection } from "@/lib/recommend.functions";
import { enrichSongs, type EnrichedSong } from "@/lib/enrich.functions";
import { PreviewPlayer, type PreviewTarget } from "@/components/PreviewPlayer";
import { buildAudioIndex, resolveAudioFile, type AudioIndex } from "@/lib/audioMatch";
import { Play } from "lucide-react";
import { saveDirHandle, loadDirHandle, clearDirHandle, verifyReadWrite, saveDirHandleMeta, loadDirHandleMeta, clearDirHandleMeta } from "@/lib/dirHandleStore";
import { supabase } from "@/integrations/supabase/client";
import { buildRecommendExisting, nextWorkflowInstanceId } from "@/lib/workflowIsolation";
import { toCamelot, parseBpm } from "@/lib/musicTheory";
import type { ResultSong } from "@/lib/danceFloor";

const VDJ_DIR_KEY = "vdjExportFolder";

export const Route = createFileRoute("/_authenticated/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Wedding Dance Floor List Builder" },
      {
        name: "description",
        content:
          "Upload client playlists, choose the vibe, and export DJ-ready CSVs for Warm Up, Transition, and Peak.",
      },
    ],
  }),
});

const DECADES = ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];

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
  const enrichFn = useServerFn(enrichSongs);
  const [dragOver, setDragOver] = useState(false);
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
  const [libraries, setLibraries] = useState<VdjLibrary[]>([]);
  const [librarySources, setLibrarySources] = useState<string[]>([]);
  const [matches, setMatches] = useState<Record<string, SongMatch>>({});
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

  // Resets every piece of state that belongs to a single workflow. Device-level
  // setup (connected music folders, VirtualDJ export folder) is intentionally
  // left alone — those represent the DJ's machine, not workflow content.
  function clearWorkflowState() {
    setSongs([]);
    setHours("3");
    setArtistsInput("");
    setGenresInput("");
    setDecades(["2000s", "2010s", "2020s"]);
    setNotes("");
    setDoNotPlayInput("");
    setExpand(false);
    setIncludeCombined(false);
    setEventName("");
    setResult(null);
    setMatches({});
    setSearchOpen(null);
    setSearchQuery("");
    setPreviewTarget(null);
    setIsGenerating(false);
    setWorkflowInstanceId((n) => nextWorkflowInstanceId(n));
  }

  type AudioSource = { id: string; kind: "folder"; name: string; files: File[]; libraryIndex: number };
  const [audioSources, setAudioSources] = useState<AudioSource[]>([]);
  const [canDirWrite, setCanDirWrite] = useState(false);
  const [musicSetupOpen, setMusicSetupOpen] = useState(false);
  const [musicSetupCompleted, setMusicSetupCompleted] = useState<boolean | null>(null);
  useEffect(() => { setCanDirWrite(supportsDirectoryWrite()); }, []);

  // Load the user's "music setup completed" flag from their profile once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("profiles")
        .select("music_setup_completed")
        .eq("id", user.id)
        .maybeSingle();
      if (!cancelled) setMusicSetupCompleted(!!data?.music_setup_completed);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist "setup completed" once the user has at least one library and an export folder configured on any device.
  useEffect(() => {
    if (musicSetupCompleted === false && libraries.length > 0 && vdjDirHandle) {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from("profiles").update({ music_setup_completed: true }).eq("id", user.id);
        setMusicSetupCompleted(true);
      })();
    }
  }, [libraries.length, vdjDirHandle, musicSetupCompleted]);

  const audioIndex = useMemo<AudioIndex>(() => {
    const allFiles: File[] = [];
    for (const s of audioSources) allFiles.push(...s.files);
    return buildAudioIndex(allFiles, []);
  }, [audioSources]);

  async function addAudioFolder() {
    const files = await pickDirectoryFiles();
    const audio = files.filter((f) => /\.(mp3|m4a|wav|flac|ogg|aac|aif{1,2}|wma|opus|alac)$/i.test(f.name));
    if (!audio.length) {
      toast.error("No audio files found in selected folder");
      return;
    }
    const rel = (audio[0] as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    const name = rel.split("/")[0] || `Folder ${audioSources.length + 1}`;
    const tracks = tracksFromAudioFiles(audio);
    const folderLib = buildLibrary(tracks);
    const sourceLabel = `Folder: ${name} (${tracks.length} files)`;
    const newLibIndex = libraries.length;
    const updatedLibs = [...libraries, folderLib];
    setLibraries(updatedLibs);
    setLibrarySources([...librarySources, sourceLabel]);
    setAudioSources((prev) => [
      ...prev,
      { id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: "folder", name, files: audio, libraryIndex: newLibIndex },
    ]);
    // Re-match if results exist
    if (result) {
      const merged = mergeLibraries(updatedLibs);
      const m: Record<string, SongMatch> = {};
      (["warmUp", "transition", "peak"] as SectionKey[]).forEach((section) => {
        result[section].forEach((s, i) => {
          m[songKey(section, i, s)] = matchSong(s, merged);
        });
      });
      setMatches(m);
    }
    toast.success(`Added folder "${name}" · ${audio.length} audio file${audio.length === 1 ? "" : "s"}`);
  }

  function removeAudioSource(id: string) {
    const target = audioSources.find((s) => s.id === id);
    if (!target) return;
    // Drop the synthesized library too and remap remaining indices.
    const removedIdx = target.libraryIndex;
    const newLibs = libraries.filter((_, i) => i !== removedIdx);
    const newSrcLabels = librarySources.filter((_, i) => i !== removedIdx);
    setLibraries(newLibs);
    setLibrarySources(newSrcLabels);
    setAudioSources((prev) =>
      prev
        .filter((s) => s.id !== id)
        .map((s) =>
          s.libraryIndex > removedIdx ? { ...s, libraryIndex: s.libraryIndex - 1 } : s,
        ),
    );
    // Re-match against the reduced library set
    if (result) {
      const merged = newLibs.length ? mergeLibraries(newLibs) : null;
      const m: Record<string, SongMatch> = {};
      if (merged) {
        (["warmUp", "transition", "peak"] as SectionKey[]).forEach((section) => {
          result[section].forEach((s, i) => {
            m[songKey(section, i, s)] = matchSong(s, merged);
          });
        });
      }
      setMatches(m);
    }
  }

  const resolveLocalFile = useMemo(
    () => (q: { artist?: string; title?: string; filePath?: string }) => resolveAudioFile(audioIndex, q),
    [audioIndex]
  );



  const mergedLibrary = useMemo<VdjLibrary | null>(() => {
    if (!libraries.length) return null;
    return mergeLibraries(libraries);
  }, [libraries]);

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
    const valid = arr.filter((f) => /\.(csv|txt)$/i.test(f.name));
    if (!valid.length) {
      toast.error("Please upload .csv or .txt files");
      return;
    }
    let added = 0;
    let next = [...songs];
    for (const f of valid) {
      try {
        const parsed = await parseFile(f);
        added += parsed.length;
        next = [...next, ...parsed];
      } catch {
        toast.error(`Could not parse ${f.name}`);
      }
    }
    setSongs(next);
    toast.success(`Imported ${added} songs from ${valid.length} file${valid.length > 1 ? "s" : ""}`);
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




  async function generate() {
    if (!songs.length) {
      toast.error("Upload at least one song first");
      return;
    }
    if (hoursNum <= 0) {
      toast.error("Enter a valid dance floor length");
      return;
    }
    const uniqueSongs = dedupeSongs(songs);
    const prefs = buildCurrentPrefs();
    // Always build the base from uploads only; AI fills the gap when expand=true,
    // with the built-in library as a fallback if AI is unavailable.
    let r = generateLists({
      uploaded: uniqueSongs,
      hours: hoursNum,
      expand: false,
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
      setIsGenerating(true);
      try {
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
        await Promise.all(
          sectionMap.map(async ({ key, label }) => {
            // Retry loop: AI may return fewer items than requested (dedupes,
            // MAX_TOKENS truncation, over-cautious schema output). Keep asking
            // for the remaining shortfall until we either fill the section or
            // hit the attempt cap. Without this a single short response leaves
            // the playlist under the 2× buffer target.
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
                const res = await recommendFn({
                  data: { section: label, count: requestCount, prefs, existing: existingNow },
                });
                if (!res.suggestions.length) {
                  // No progress this attempt — stop looping to avoid burning
                  // credits on a section the model can't fill.
                  break;
                }
                gotAny = true;
                const seen = new Set(
                  [...r[key], ...existingNow].map((s) => dedupeKey(s.artist, s.song)),
                );
                let addedThisAttempt = 0;
                for (const sug of res.suggestions) {
                  if (r[key].length >= r.perSectionTarget) break;
                  const k = dedupeKey(sug.artist, sug.song);
                  if (seen.has(k)) continue;
                  seen.add(k);
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
            prefs,
          });
          // Track keys across ALL sections so a library song can't be added
          // to two different lists during the fallback pass.
          const globalHave = new Set<string>(
            [...r.warmUp, ...r.transition, ...r.peak].map((s) => dedupeKey(s.artist, s.song)),
          );
          for (const { key } of stillShort) {
            for (const s of fallback[key]) {
              if (r[key].length >= r.perSectionTarget) break;
              const k = dedupeKey(s.artist, s.song);
              if (globalHave.has(k)) continue;
              globalHave.add(k);
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

      } finally {
        setIsGenerating(false);
      }
    }

    // Re-bucket + sort the merged set so uploads and AI picks interleave into
    // a single ascending energy ramp from the first warm-up song to the last
    // peak song.
    r = reorderForEnergyProgression(r);
    if (expand && r.finalShortfall && r.finalShortfall.total > 0) {
      r = topUpSectionsFromLibrary(r, prefs);
    }

    setResult(r);
    setMatches({});
    if (mergedLibrary) {
      // fresh matching
      const m: Record<string, SongMatch> = {};
      (["warmUp", "transition", "peak"] as SectionKey[]).forEach((section) => {
        r[section].forEach((s, i) => {
          m[songKey(section, i, s)] = matchSong(s, mergedLibrary);
        });
      });
      setMatches(m);
    }
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
  }

  function removeDuplicates() {
    const before = songs.length;
    const next = dedupeSongs(songs);
    const removed = before - next.length;
    setSongs(next);
    toast.success(`Removed ${removed} duplicate song${removed === 1 ? "" : "s"}`);
  }

  // --- VirtualDJ library loading ---

  async function loadXmlFiles(files: File[], sourceLabel: string) {
    if (!files.length) return;
    const xmlFiles = files.filter((f) => /database\.xml$|\.xml$/i.test(f.name));
    if (!xmlFiles.length) {
      toast.error("No database.xml files found in selection");
      return;
    }
    let totalTracks = 0;
    const newLibs: VdjLibrary[] = [];
    const newSources: string[] = [];
    for (const f of xmlFiles) {
      try {
        const text = await f.text();
        const tracks = parseVdjDatabaseXml(text);
        if (tracks.length) {
          newLibs.push(buildLibrary(tracks));
          newSources.push(`${sourceLabel}: ${f.webkitRelativePath || f.name} (${tracks.length} tracks)`);
          totalTracks += tracks.length;
        }
      } catch {
        toast.error(`Could not parse ${f.name}`);
      }
    }
    if (!newLibs.length) {
      toast.error("No tracks parsed from VirtualDJ database");
      return;
    }
    const updated = [...libraries, ...newLibs];
    setLibraries(updated);
    setLibrarySources([...librarySources, ...newSources]);
    toast.success(`Indexed ${totalTracks} VirtualDJ tracks`);
    // Re-match if results exist
    if (result) {
      const merged = mergeLibraries(updated);
      const m: Record<string, SongMatch> = {};
      (["warmUp", "transition", "peak"] as SectionKey[]).forEach((section) => {
        result[section].forEach((s, i) => {
          m[songKey(section, i, s)] = matchSong(s, merged);
        });
      });
      setMatches(m);
    }
  }

  async function selectDatabaseXml() {
    const files = await pickXmlFiles();
    await loadXmlFiles(files, "database.xml");
  }

  async function selectFolder(label: string) {
    const files = await pickDirectoryFiles();
    const xmls = files.filter((f) => /database\.xml$/i.test(f.name));
    if (!xmls.length) {
      toast.error(`No database.xml found in ${label}`);
      return;
    }
    await loadXmlFiles(xmls, label);
  }

  function clearLibraries() {
    setLibraries([]);
    setLibrarySources([]);
    setAudioSources([]);
    setMatches({});
    toast.success("Libraries cleared");
  }


  // Restore a previously chosen export folder from IndexedDB on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const handle = await loadDirHandle(VDJ_DIR_KEY);
      const meta = await loadDirHandleMeta(VDJ_DIR_KEY);
      if (cancelled || !handle) return;
      if (meta) setVdjDirSavedAt(meta.savedAt);
      const ok = await verifyReadWrite(handle);
      if (cancelled) return;
      if (ok) {
        setVdjDirHandle(handle as unknown as DirHandleLike);
        setVdjDirName(handle.name ?? "VirtualDJ folder");
      } else {
        // Permission lapsed; keep the saved handle so the user can re-grant
        // via a single click without re-picking the folder.
        setVdjDirHandle(handle as unknown as DirHandleLike);
        setVdjDirName(handle.name ?? "VirtualDJ folder");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function chooseMyListsFolder() {
    if (!supportsDirectoryWrite()) {
      toast.error("Direct folder writing not supported in this browser");
      return;
    }
    const handle = await pickDirectoryHandle();
    if (handle) {
      setVdjDirHandle(handle);
      const name = (handle as DirHandleLike & { name?: string }).name ?? "VirtualDJ folder";
      setVdjDirName(name);
      const now = Date.now();
      setVdjDirSavedAt(now);
      await saveDirHandle(VDJ_DIR_KEY, handle as unknown as Parameters<typeof saveDirHandle>[1]);
      await saveDirHandleMeta(VDJ_DIR_KEY, { savedAt: now });
      toast.success(`VirtualDJ folder saved · ${name}`);
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
    if (vdjDirHandle) {
      const ok = await verifyReadWrite(vdjDirHandle as unknown as Parameters<typeof verifyReadWrite>[0]);
      if (ok) return vdjDirHandle;
    }
    if (!supportsDirectoryWrite()) return null;
    const handle = await pickDirectoryHandle();
    if (!handle) return null;
    setVdjDirHandle(handle);
    const name = (handle as DirHandleLike & { name?: string }).name ?? "VirtualDJ folder";
    setVdjDirName(name);
    const now = Date.now();
    setVdjDirSavedAt(now);
    await saveDirHandle(VDJ_DIR_KEY, handle as unknown as Parameters<typeof saveDirHandle>[1]);
    await saveDirHandleMeta(VDJ_DIR_KEY, { savedAt: now });
    toast.success(`VirtualDJ folder saved · ${name}`);
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
    const MANUAL_NAME = "Manually picked files";
    const existing = audioSources.find((s) => s.name === MANUAL_NAME);
    let newLibs: VdjLibrary[];
    let newSources: AudioSource[];
    let newSrcLabels: string[];
    if (existing) {
      // Skip if already present
      if (existing.files.some((f) => f.name === file.name && f.size === file.size)) {
        // still re-pick it
      }
      const manualFiles = existing.files.some((f) => f.name === file.name && f.size === file.size)
        ? existing.files
        : [...existing.files, file];
      const tracks = tracksFromAudioFiles(manualFiles);
      const manualLib = buildLibrary(tracks);
      const manualIdx = existing.libraryIndex;
      newLibs = libraries.map((l, i) => (i === manualIdx ? manualLib : l));
      newSrcLabels = librarySources.map((s, i) =>
        i === manualIdx ? `${MANUAL_NAME} (${tracks.length} files)` : s,
      );
      newSources = audioSources.map((s) =>
        s.id === existing.id ? { ...s, files: manualFiles } : s,
      );
    } else {
      const manualFiles = [file];
      const tracks = tracksFromAudioFiles(manualFiles);
      const manualLib = buildLibrary(tracks);
      const manualIdx = libraries.length;
      newLibs = [...libraries, manualLib];
      newSrcLabels = [...librarySources, `${MANUAL_NAME} (${tracks.length} files)`];
      newSources = [
        ...audioSources,
        {
          id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          kind: "folder",
          name: MANUAL_NAME,
          files: manualFiles,
          libraryIndex: manualIdx,
        },
      ];
    }
    setLibraries(newLibs);
    setLibrarySources(newSrcLabels);
    setAudioSources(newSources);
    const merged = mergeLibraries(newLibs);
    const newIdx = merged.tracks.findIndex((t) => t.filePath === file.name);
    if (newIdx === -1) {
      toast.error("Could not add file to library");
      return;
    }
    updateMatch(key, {
      status: "Manually Matched",
      confidence: 1,
      trackIndex: newIdx,
      alternatives: [],
      extraTrackIndices: [],
    });
    toast.success(`Matched → ${file.name}`);
  }

  // --- Export helpers ---

  function getSectionRefs(section: SectionKey): ExportSongRef[] {
    if (!result) return [];
    return getSectionRefsForResult(result, section);
  }

  function getSectionRefsForResult(source: GenerationResult, section: SectionKey): ExportSongRef[] {
    return source[section].map((s, i) => ({
      song: s,
      match: matches[songKey(section, i, s)],
    }));
  }

  function ensureBufferedResultForExport(): GenerationResult | null {
    if (!result) return null;
    if (!expand || !result.finalShortfall || result.finalShortfall.total === 0) return result;
    const topped = topUpSectionsFromLibrary(result, buildCurrentPrefs());
    setResult(topped);
    if (mergedLibrary) {
      const m: Record<string, SongMatch> = {};
      (["warmUp", "transition", "peak"] as SectionKey[]).forEach((section) => {
        topped[section].forEach((s, i) => {
          m[songKey(section, i, s)] = matchSong(s, mergedLibrary);
        });
      });
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
      `${unmatched} songs are not matched to files in your VirtualDJ library. They will remain in your CSV reference lists but will not appear in the VirtualDJ XML/M3U playlist unless matched. Continue?`,
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
    const xml = buildVirtualDjXml(refs, mergedLibrary);
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    downloadBlob(
      new Blob([xml], { type: "application/xml" }),
      `${prefix}${SECTION_FILES[section]}.xml`,
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
    const xml = buildVirtualDjXml(refs, mergedLibrary);
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    const fname = `${prefix}${SECTION_FILES[section]}.xml`;
    try {
      await writeFileToDir(dir, fname, xml);
      toast.success(`Saved ${fname} to ${vdjDirName ?? "VirtualDJ folder"}`);
    } catch {
      toast.error("Could not write to VirtualDJ folder, downloading instead");
      downloadBlob(new Blob([xml], { type: "application/xml" }), fname);
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
    let failed = 0;
    for (const section of sections) {
      const list = exportResult[section];
      if (!list.length) continue;
      const files: Array<{ name: string; data: string }> = [
        { name: `${prefix}${SECTION_FILES[section]}.csv`, data: songsToCsv(list) },
      ];
      if (mergedLibrary) {
        const refs = getSectionRefsForResult(exportResult, section);
        files.push({ name: `${prefix}${SECTION_FILES[section]}.xml`, data: buildVirtualDjXml(refs, mergedLibrary) });
        files.push({ name: `${prefix}${SECTION_FILES[section]}.m3u`, data: buildM3u(refs, mergedLibrary) });
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
        zip.file(`${prefix}${SECTION_FILES[section]}.xml`, buildVirtualDjXml(refs, mergedLibrary));
        zip.file(`${prefix}${SECTION_FILES[section]}.m3u`, buildM3u(refs, mergedLibrary));
      }
    });
    if (includeCombined) zip.file(`${prefix}combined-dance-floor-lists.csv`, combinedCsv(exportResult));
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${prefix}dance-floor-lists.zip`);
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
        const m = matches[songKey(sec, i, s)];
        if (!m) {
          missing += 1;
          return;
        }
        if (m.excludedFromVdj) excluded += 1;
        switch (m.status) {
          case "Matched":
          case "Manually Matched":
            matched += 1;
            break;
          case "Possible Match":
            possible += 1;
            break;
          case "Multiple Matches":
            multiple += 1;
            break;
          case "Missing From Library":
            missing += 1;
            break;
        }
      });
    });
    return { total, matched, possible, multiple, missing, excluded, csvIncluded: total, sourceCounts };
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
  }, [debouncedSongs, debouncedHours, debouncedExpand]);


  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-right" />

      <header className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex items-start gap-3 justify-between flex-wrap">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Music className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                  Wedding Dance Floor List Builder
                </h1>
                <p className="text-sm text-muted-foreground md:text-base">
                  Upload client playlists, choose the vibe, and export DJ-ready CSV files.
                </p>
              </div>
            </div>
            <DjAccountBar
              hasGeneratedLists={!!result}
              getSnapshot={(): WorkflowSnapshot => ({
                inputs: {
                  songs,
                  hours,
                  artistsInput,
                  genresInput,
                  decades,
                  notes,
                  doNotPlayInput,
                  expand,
                  eventName,
                },
                lists: result ? { warmUp: result.warmUp, transition: result.transition, peak: result.peak } : { warmUp: [], transition: [], peak: [] },
              })}
              applySnapshot={(s) => {
                // Start from a fully clean workflow so matches, open search
                // panels, preview player state, etc. from the previous
                // workflow cannot bleed into the loaded one.
                clearWorkflowState();
                setSongs(s.inputs.songs ?? []);
                setHours(s.inputs.hours ?? "3");
                setArtistsInput(s.inputs.artistsInput ?? "");
                setGenresInput(s.inputs.genresInput ?? "");
                setDecades(s.inputs.decades ?? []);
                setNotes(s.inputs.notes ?? "");
                setDoNotPlayInput(s.inputs.doNotPlayInput ?? "");
                setExpand(!!s.inputs.expand);
                setEventName(s.inputs.eventName ?? "");
                if (s.lists && (s.lists.warmUp.length || s.lists.transition.length || s.lists.peak.length)) {
                  const per = Math.max(s.lists.warmUp.length, s.lists.transition.length, s.lists.peak.length);
                  setResult({
                    warmUp: s.lists.warmUp,
                    transition: s.lists.transition,
                    peak: s.lists.peak,
                    targetTotal: per * 3,
                    perSectionTarget: per,
                    perSectionBase: per,
                    shortfall: { warmUp: 0, transition: 0, peak: 0, total: 0 },
                    duplicatesRemoved: 0,
                    blockedCount: 0,
                  });
                } else {
                  setResult(null);
                }
              }}
              resetWorkflow={clearWorkflowState}
            />
            <Button variant="outline" size="sm" onClick={() => setMusicSetupOpen(true)}>
              <FolderOpen className="mr-1 h-4 w-4" /> Music setup
              {libraries.length > 0 && vdjDirHandle && (
                <Check className="ml-1 h-3 w-3 text-emerald-500" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        {/* Step 1 */}
        <Card>
          <CardHeader>
            <CardTitle>Step 1 · Upload song lists</CardTitle>
            <CardDescription>Drop one or more CSV or TXT files. Processed in your browser.</CardDescription>
          </CardHeader>
          <CardContent>
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
              <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Drop CSV or TXT files here, or click to browse</p>
              <p className="mt-1 text-sm text-muted-foreground">Multiple files supported</p>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Step 2 */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>Step 2 · Review imported songs</CardTitle>
              <CardDescription>
                {songs.length} song{songs.length === 1 ? "" : "s"} imported · edit, add, or remove rows
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
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
            </div>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* Step 3 */}
        <Card>
          <CardHeader>
            <CardTitle>Step 3 · Dance floor details</CardTitle>
            <CardDescription>Set the vibe and length of the open dance floor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
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
                    Warm Up ~{sectionMinutes} min · Transition ~{sectionMinutes} min · Peak ~{sectionMinutes} min · Target <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs (<span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> per section, 2× buffer)
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
                    Target <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs · <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> per section (2× buffer)

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
                          <TableRow key={`${entry.artist}-${entry.song || ""}-${i}`} className={isDup ? "bg-amber-50/70 dark:bg-amber-950/20" : undefined}>
                            <TableCell className="py-2">
                              <span className={isDup ? "font-medium text-amber-700 dark:text-amber-300" : undefined}>
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

          </CardContent>
        </Card>

        {/* Step 4 */}
        <Card>
          <CardHeader>
            <CardTitle>Step 4 · Song expansion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">Add additional songs based on artist, genre, and decade preferences</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  When turned off, the app will only use songs from the uploaded files.
                </p>
                {hoursNum > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground transition-opacity duration-150">
                    Target <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs · <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> per section (2× buffer)
                  </p>
                )}
              </div>
              <Switch checked={expand} onCheckedChange={setExpand} />
            </div>
            {hoursNum > 0 && !expand && liveTargets.shortfall.total > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">Not enough uploaded songs to hit the 2× buffer.</p>
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

          </CardContent>
        </Card>

        {/* Music setup status (moved out of the linear flow — configured once per device from your profile menu) */}
        {(() => {
          const hasLibrary = libraries.length > 0;
          const hasExport = !!vdjDirHandle;
          const fullyReady = hasLibrary && hasExport;
          if (fullyReady) return null;
          const isNewUser = musicSetupCompleted === false;
          return (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
              <div className="flex-1 min-w-[200px]">
                {isNewUser ? (
                  <>
                    <p className="font-medium">First time here? Connect your music folders.</p>
                    <p className="text-xs">One-time setup on this device — add your music folder and pick your VirtualDJ export folder.</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Music folders aren't connected on this device.</p>
                    <p className="text-xs">
                      {hasLibrary ? "Export folder missing." : "Music library missing."} Reconnect to enable direct exports and playback matching.
                    </p>
                  </>
                )}
              </div>
              <Button size="sm" onClick={() => setMusicSetupOpen(true)}>
                <FolderOpen className="mr-1 h-4 w-4" /> {isNewUser ? "Set up music folders" : "Reconnect"}
              </Button>
            </div>
          );
        })()}

        {/* Generate */}
        <div className="flex justify-center">
          <Button size="lg" onClick={generate} disabled={isGenerating}>
            {isGenerating ? "Generating with AI…" : "Generate Dance Floor Lists"}
          </Button>
        </div>

        {/* Music setup dialog (formerly Step 5) */}
        <Dialog open={musicSetupOpen} onOpenChange={setMusicSetupOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Music setup</DialogTitle>
              <DialogDescription>
                Connect your music folders and VirtualDJ export folder. This is stored in your browser on this device only — the app will remember it next time you visit.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="default" size="sm" onClick={addAudioFolder}>
                  <Plus className="mr-1 h-4 w-4" /> Add music folder
                </Button>
                <Button variant="outline" size="sm" onClick={selectDatabaseXml}>
                  <FolderOpen className="mr-1 h-4 w-4" /> Add VirtualDJ database.xml (optional)
                </Button>
                <Button variant="outline" size="sm" onClick={() => selectFolder("VirtualDJ Folder")}>
                  <FolderOpen className="mr-1 h-4 w-4" /> Scan VirtualDJ folder
                </Button>
                {libraries.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearLibraries}>
                    <X className="mr-1 h-4 w-4" /> Clear libraries
                  </Button>
                )}
              </div>
              {mergedLibrary ? (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <p className="font-medium">
                    Indexed {mergedLibrary.tracks.length} tracks from {libraries.length} source{libraries.length > 1 ? "s" : ""}
                  </p>
                  <ul className="mt-1 space-y-1 pl-0 text-xs text-muted-foreground">
                    {librarySources.map((s, i) => {
                      const folderSource = audioSources.find((a) => a.libraryIndex === i);
                      return (
                        <li key={i} className="flex items-center gap-2">
                          <span className="flex-1 truncate">• {s}</span>
                          {folderSource && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2"
                              onClick={() => removeAudioSource(folderSource.id)}
                              title="Remove folder"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {audioIndex.files.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {audioIndex.files.length.toLocaleString()} audio file{audioIndex.files.length === 1 ? "" : "s"} indexed for in-app playback
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Add a music folder (also used as the playback source) or a VirtualDJ <code>database.xml</code> to match the generated set and enable exports.
                </p>
              )}
              <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    VirtualDJ export folder
                  </span>
                  {vdjDirHandle ? (
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="font-medium truncate">{vdjDirName}</span>
                      {vdjDirSavedAt ? (
                        <span className="text-xs text-muted-foreground">· Saved {formatSavedAt(vdjDirSavedAt)}</span>
                      ) : null}
                      <Badge variant="secondary" className="text-xs">remembered on this device</Badge>
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Not set — exports will download as files until you pick a folder.
                    </span>
                  )}
                </div>
                {!vdjDirHandle ? (
                  <Button variant="default" size="sm" onClick={chooseMyListsFolder} disabled={!canDirWrite}>
                    <FolderOpen className="mr-1 h-4 w-4" />
                    Choose export folder
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={chooseMyListsFolder} disabled={!canDirWrite}>
                      <FolderOpen className="mr-1 h-4 w-4" /> Change
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearMyListsFolder}>
                      <X className="mr-1 h-4 w-4" /> Forget
                    </Button>
                  </>
                )}
                {!canDirWrite && (
                  <span className="w-full text-xs text-muted-foreground">
                    Direct saving unsupported in this browser — files will download instead.
                  </span>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>


        {/* Results */}
        {result && (
          <Card id="results">
            <CardHeader>
              <CardTitle>Step 6 · Review and export</CardTitle>
              <CardDescription>
                Each CSV exports with exactly two columns: Artist, Song.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {summary && (
                <>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <h3 className="mb-2 font-medium">Match summary</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 md:grid-cols-6">
                      <Stat label="Total" value={summary.total} />
                      <Stat label="Matched" value={summary.matched} tone="success" />
                      <Stat label="Possible" value={summary.possible} tone="warning" />
                      <Stat label="Multiple" value={summary.multiple} tone="warning" />
                      <Stat label="Missing" value={summary.missing} tone="destructive" />
                      <Stat label="Excluded from VDJ" value={summary.excluded} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {summary.csvIncluded} songs included in CSV reference exports.
                    </p>
                    {(result.duplicatesRemoved > 0 || result.blockedCount > 0) && (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {result.duplicatesRemoved > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-amber-900 dark:text-amber-200">
                            <AlertTriangle className="h-3 w-3 text-amber-600" />
                            {result.duplicatesRemoved} duplicate{result.duplicatesRemoved === 1 ? "" : "s"} removed from uploads
                          </span>
                        )}
                        {result.blockedCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-red-900 dark:text-red-200">
                            <X className="h-3 w-3 text-red-600" />
                            {result.blockedCount} blocked by Do Not Play list
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="font-medium">Song source summary</h3>
                      {isPendingLive && (
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary animate-pulse">
                          recalculating…
                        </span>
                      )}
                    </div>
                    <p className="mb-3 text-xs text-muted-foreground transition-opacity duration-150">
                      Target total <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs · target per section <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> (2× buffer over <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSectionBase}</span> needed)
                    </p>
                    {!expand && liveTargets.shortfall.total > 0 && (
                      <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                        <div>
                          <p className="font-medium">Uploads fall short of the 2× buffer.</p>
                          <p className="mt-1">
                            Short by <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.shortfall.warmUp}</span> in Warm Up,
                            {" "}<span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.shortfall.transition}</span> in Transition,
                            {" "}<span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.shortfall.peak}</span> in Peak.
                            Enable “Add additional songs” in Step 4 to fill the gap.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                      {(["warmUp", "transition", "peak"] as SectionKey[]).map((sec) => {
                        const label = sec === "warmUp" ? "Warm Up" : sec === "transition" ? "Transition" : "Peak";
                        const c = summary.sourceCounts[sec];
                        return (
                          <div key={sec} className="rounded-md border bg-background p-3">
                            <p className="mb-1 font-medium">{label}</p>
                            <div className="flex items-center justify-between text-xs">
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Upload className="h-3 w-3" /> From uploads
                              </span>
                              <span className="font-semibold">{c.uploads}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Sparkles className="h-3 w-3" /> AI suggestion
                              </span>
                              <span className="font-semibold">{c.ai}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Database className="h-3 w-3" /> Built-in library
                              </span>
                              <span className="font-semibold">{c.library}</span>
                            </div>
                            <div className="mt-1 border-t pt-1 flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Total</span>
                              <span className="font-semibold">{c.uploads + c.ai + c.library}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Target</span>
                              <span className="font-semibold">{liveTargets.perSection}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={exportAllZip}>
                  <Download className="mr-1 h-4 w-4" /> Export All Files as ZIP
                </Button>
                <Button
                  variant="secondary"
                  onClick={exportAllToVdj}
                  disabled={!canDirWrite}
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
                <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="w-full">
                    <div className="font-medium">Not enough songs to fully fill every section</div>
                    <div className="mt-1.5 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                      <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-center">
                        <div className="font-semibold">Warm Up</div>
                        <div>{result.warmUp.length} / {result.perSectionTarget}</div>
                        <div className="text-amber-700 dark:text-amber-300">-{result.finalShortfall.warmUp} short</div>
                      </div>
                      <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-center">
                        <div className="font-semibold">Transition</div>
                        <div>{result.transition.length} / {result.perSectionTarget}</div>
                        <div className="text-amber-700 dark:text-amber-300">-{result.finalShortfall.transition} short</div>
                      </div>
                      <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-center">
                        <div className="font-semibold">Peak</div>
                        <div>{result.peak.length} / {result.perSectionTarget}</div>
                        <div className="text-amber-700 dark:text-amber-300">-{result.finalShortfall.peak} short</div>
                      </div>
                    </div>

                    <div className="mt-1.5 text-xs">
                      Target {result.perSectionTarget} songs per section. The lowest-energy songs are still first and the highest-energy last — add more uploads, turn on AI/library expansion, or shorten the dance-floor length to close the gap.
                    </div>
                  </div>
                </div>
              ) : null}

              <Tabs defaultValue="warmUp">
                <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
                  <TabsTrigger value="warmUp" className="h-auto whitespace-normal text-left leading-tight">
                    Warm Up ({result.warmUp.length}{result.finalShortfall && result.finalShortfall.warmUp > 0 ? ` / ${result.perSectionTarget}, -${result.finalShortfall.warmUp}` : ""})
                  </TabsTrigger>
                  <TabsTrigger value="transition" className="h-auto whitespace-normal text-left leading-tight">
                    Transition ({result.transition.length}{result.finalShortfall && result.finalShortfall.transition > 0 ? ` / ${result.perSectionTarget}, -${result.finalShortfall.transition}` : ""})
                  </TabsTrigger>
                  <TabsTrigger value="peak" className="h-auto whitespace-normal text-left leading-tight">
                    Peak ({result.peak.length}{result.finalShortfall && result.finalShortfall.peak > 0 ? ` / ${result.perSectionTarget}, -${result.finalShortfall.peak}` : ""})
                  </TabsTrigger>
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
                     onOpenSearch={openSearch}
                     onPickLocalFile={pickLocalFileForMatch}
                      onPreview={(t) => setPreviewTarget(t)}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
        )}

        <footer className="py-6 text-center text-xs text-muted-foreground">
          Files are processed in your browser. Nothing is uploaded or stored.
        </footer>
      </main>

      <Dialog open={!!searchOpen} onOpenChange={(o) => { if (!o) { setSearchOpen(null); setSearchQuery(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Search VirtualDJ library</DialogTitle>
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
                          <p className="truncate text-xs text-muted-foreground">{t.filePath}</p>
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
      <PreviewPlayer key={`preview-${workflowInstanceId}`} target={previewTarget} onOpenChange={(o) => { if (!o) setPreviewTarget(null); }} resolveLocalFile={resolveLocalFile} />
    </div>
  );
}
type BadgeSong = Song & {
  fromUpload?: boolean;
  aiSuggestion?: boolean;
  aiReason?: string;
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
  metaSource?: "VirtualDJ" | "AI" | "Library" | "Upload";
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
    song.metaSource ? { label: "Source", value: song.metaSource } : null,
    song.aiReason ? { label: "AI reasoning", value: song.aiReason } : null,
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
  return (
    <>
      {song.stretched && (
        <Badge
          variant="secondary"
          className="gap-1 text-[10px] bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100"
          title={song.naturalSection ? `Natural fit: ${song.naturalSection} — stretched to fill the ramp` : "Stretched to fill the ramp"}
        >
          Stretched{song.naturalSection ? ` ← ${song.naturalSection}` : ""}
        </Badge>
      )}
      {song.reused && (
        <Badge
          variant="secondary"
          className="gap-1 text-[10px] bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100"
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
    tone === "success" ? "text-emerald-600" :
    tone === "warning" ? "text-amber-600" :
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
    "Matched": "bg-emerald-100 text-emerald-800 border-emerald-200",
    "Manually Matched": "bg-emerald-100 text-emerald-800 border-emerald-200",
    "Possible Match": "bg-amber-100 text-amber-900 border-amber-200",
    "Multiple Matches": "bg-amber-100 text-amber-900 border-amber-200",
    "Missing From Library": "bg-red-100 text-red-800 border-red-200",
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
  onPreview?: (target: { artist: string; song: string; filePath?: string }) => void;
}

function SectionView(props: SectionViewProps) {
  const { section, songs, matches, library, songKey, onExportCsv, onExportXml, onExportM3u, onExportXmlToVdj, onExportM3uToVdj, canWriteToVdj, vdjFolderName, onConfirm, onChoose, onMarkUnresolved, onToggleExclude, onToggleExtra, onPreview, onPickLocalFile } = props;
  const sectionLabel = section === "warmUp" ? "Warm Up" : section === "transition" ? "Transition" : "Peak";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onExportCsv}>
          <Download className="mr-1 h-4 w-4" /> Download {sectionLabel} CSV
        </Button>
        <Button size="sm" variant="outline" onClick={onExportXml} disabled={!library}>
          <Download className="mr-1 h-4 w-4" /> Download VirtualDJ {sectionLabel} XML
        </Button>
        <Button size="sm" variant="outline" onClick={onExportM3u} disabled={!library}>
          <Download className="mr-1 h-4 w-4" /> Download M3U {sectionLabel} Playlist
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onExportXmlToVdj}
          disabled={!library || !canWriteToVdj}
          title={vdjTitle}
        >
          <FolderOpen className="mr-1 h-4 w-4" /> {sectionLabel} XML → VirtualDJ
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onExportM3uToVdj}
          disabled={!library || !canWriteToVdj}
          title={vdjTitle}
        >
          <FolderOpen className="mr-1 h-4 w-4" /> {sectionLabel} M3U → VirtualDJ
        </Button>
      </div>
      <div className="max-h-[32rem] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artist</TableHead>
              <TableHead>Song</TableHead>
              {library && (
                <>
                  <TableHead>Match</TableHead>
                  <TableHead>Conf.</TableHead>
                  <TableHead>VDJ BPM</TableHead>
                  <TableHead>VDJ Key</TableHead>
                  <TableHead>File Path / Alternatives</TableHead>
                  <TableHead className="w-44">Actions</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {songs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={library ? 8 : 2} className="text-center text-sm text-muted-foreground">
                  No songs in this section
                </TableCell>
              </TableRow>
            ) : songs.map((s, i) => {
              const key = songKey(section, i, s);
              const m = matches[key];
              const track: VdjTrack | undefined = library && m?.trackIndex != null ? library.tracks[m.trackIndex] : undefined;
              return (
                <Fragment key={i}>
                <TableRow className={m?.excludedFromVdj ? "opacity-60" : ""}>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        onClick={() => onPreview?.({ artist: s.artist, song: s.song, filePath: track?.filePath })}
                        title="Preview song"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                      <span className="break-words">{s.artist}</span>
                      <SourceBadge song={s as BadgeSong} />
                      <FallbackBadges song={s as BadgeSong} />
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        onClick={() => toggleExpanded(key)}
                        title={expanded.has(key) ? "Collapse metrics" : "Expand metrics"}
                      >
                        {expanded.has(key) ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                      <span className="break-words">{s.song}</span>
                    </div>
                  </TableCell>

                  {library && (
                    <>
                      <TableCell>{m ? statusBadge(m.status) : statusBadge("Missing From Library")}</TableCell>
                      <TableCell className="text-xs">{m ? `${Math.round(m.confidence * 100)}%` : "—"}</TableCell>
                      <TableCell className="text-xs">{track?.bpm || "—"}</TableCell>
                      <TableCell className="text-xs">{track?.key || "—"}</TableCell>
                      <TableCell className="max-w-xs">
                        {track ? (
                          <p className="truncate text-xs" title={track.filePath}>{track.filePath}</p>
                        ) : (
                          <span className="text-xs text-muted-foreground">No file</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {m?.status === "Possible Match" && (
                            <Button size="sm" variant="outline" onClick={() => onConfirm(key)}>
                              <Check className="h-3 w-3" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => onMarkUnresolved(key)} title="Mark unresolved">
                            <X className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant={m?.excludedFromVdj ? "default" : "ghost"}
                            onClick={() => onToggleExclude(key)}
                            title="Exclude from VirtualDJ export"
                          >
                            VDJ
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
                {expanded.has(key) && (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={library ? 8 : 2} className="py-2">
                      <MetricsDetail song={s as BadgeSong} />
                    </TableCell>
                  </TableRow>
                )}
                {library && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={8} className="py-2">
                      <InlineMatchSearch
                        song={s}
                        library={library}
                        currentTrackIndex={m?.trackIndex}
                        extraTrackIndices={m?.extraTrackIndices ?? []}
                        onPick={(ti) => onChoose(key, ti)}
                        onToggleExtra={(ti) => onToggleExtra(key, ti)}
                        onPreview={onPreview}
                        onPickLocalFile={onPickLocalFile ? (file) => onPickLocalFile(key, file) : undefined}
                      />
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
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
  onPickLocalFile,
}: {
  song: Song;
  library: VdjLibrary;
  currentTrackIndex?: number;
  extraTrackIndices: number[];
  onPick: (trackIndex: number) => void;
  onToggleExtra: (trackIndex: number) => void;
  onPreview?: (target: { artist: string; song: string; filePath?: string }) => void;
  onPickLocalFile?: (file: File) => void;
}) {
  const localFileRef = useRef<HTMLInputElement>(null);
  const defaultQuery = `${song.artist} ${song.song}`.trim();
  const [query, setQuery] = useState(defaultQuery);
  const [showAll, setShowAll] = useState(false);
  const debounced = useDebounce(query, 150);
  const limit = showAll ? 200 : 10;
  const allResults = useMemo(() => {
    const q = debounced.trim();
    if (!q) return [];
    return searchLibrary(q, library, limit);
  }, [debounced, library, limit]);
  const results = allResults;
  const hasMore = !showAll && results.length >= 10;
  const extraSet = new Set(extraTrackIndices);
  const totalSelected = (currentTrackIndex != null ? 1 : 0) + extraTrackIndices.length;

  return (
    <div className="space-y-2 pl-2">
      <div className="flex items-center gap-2">
        <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search library by artist or title…"
          className="h-7 text-xs"
        />
        {query !== defaultQuery && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setQuery(defaultQuery)}>
            Reset
          </Button>
        )}
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
              Browse local file
            </Button>
          </>
        )}
        {totalSelected > 1 && (
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
            {totalSelected} selected
          </span>
        )}
      </div>
      {results.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No matches in library. Try editing the search above (artist, title, or part of the file name){onPickLocalFile ? ", or click Browse local file to pick one from your computer" : ""}.
        </p>
      ) : (
        <>
          <ul className={`space-y-0.5 ${showAll ? "max-h-72 overflow-auto rounded border" : ""}`}>
            {results.map((ti) => {
              const t = library.tracks[ti];
              const isCurrent = ti === currentTrackIndex;
              const isExtra = extraSet.has(ti);
              return (
                <li key={ti} className="flex items-start gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted">
                  <Button
                    size="sm"
                    variant={isCurrent ? "default" : "outline"}
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={() => onPick(ti)}
                    disabled={isCurrent}
                    title="Set as primary match"
                  >
                    {isCurrent ? <Check className="h-3 w-3" /> : "Pick"}
                  </Button>
                  <Button
                    size="sm"
                    variant={isExtra ? "secondary" : "ghost"}
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={() => onToggleExtra(ti)}
                    disabled={isCurrent}
                    title={isExtra ? "Remove additional pick" : "Also include this track in the export"}
                  >
                    {isExtra ? "✓ Also" : "+ Also"}
                  </Button>
                  {onPreview && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 p-0"
                      onClick={() => onPreview({ artist: t.artist, song: t.title, filePath: t.filePath })}
                      title="Preview / play this file"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{t.artist} — {t.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground" title={t.filePath}>{t.filePath}</p>
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
                {showAll ? "Show top 10" : "Search full library"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
