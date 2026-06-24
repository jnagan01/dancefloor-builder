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
} from "@/lib/danceFloor";

import {
  parseVdjDatabaseXml,
  buildLibrary,
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
import { Trash2, Upload, Plus, Download, Music, AlertTriangle, FolderOpen, Search, X, Check, Sparkles, Database, HardDrive, RefreshCw } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { DjAccountBar, type WorkflowSnapshot } from "@/components/HistoryPanel";
import { useServerFn } from "@tanstack/react-start";
import { recommendSongsForSection } from "@/lib/recommend.functions";
import { PreviewPlayer, type PreviewTarget } from "@/components/PreviewPlayer";
import { buildAudioIndex, resolveAudioFile, type AudioIndex } from "@/lib/audioMatch";
import { Play } from "lucide-react";

export const Route = createFileRoute("/")({
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
  const [searchOpen, setSearchOpen] = useState<{ section: SectionKey; idx: number; key: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);

  type AudioSource =
    | { id: string; kind: "folder"; name: string; files: File[] }
    | { id: string; kind: "vdj"; name: string; libraryIndex: number };
  const [audioSources, setAudioSources] = useState<AudioSource[]>([]);
  const [canDirWrite, setCanDirWrite] = useState(false);
  useEffect(() => { setCanDirWrite(supportsDirectoryWrite()); }, []);

  const audioIndex = useMemo<AudioIndex>(() => {
    const allFiles: File[] = [];
    for (const s of audioSources) {
      if (s.kind === "folder") allFiles.push(...s.files);
    }
    // Build a basename → File map from all folder files so VDJ-source tracks
    // can be matched to actual files for metadata enrichment.
    const byBase = new Map<string, File>();
    for (const f of allFiles) byBase.set(f.name.toLowerCase(), f);
    const extras: { file: File; artist?: string; title?: string }[] = [];
    for (const s of audioSources) {
      if (s.kind !== "vdj") continue;
      const lib = libraries[s.libraryIndex];
      if (!lib) continue;
      for (const t of lib.tracks) {
        const base = (t.filePath.split(/[\\/]/).pop() || "").toLowerCase();
        const file = base ? byBase.get(base) : undefined;
        if (file) extras.push({ file, artist: t.artist, title: t.title });
      }
    }
    return buildAudioIndex(allFiles, extras);
  }, [audioSources, libraries]);

  async function addAudioFolder() {
    const files = await pickDirectoryFiles();
    const audio = files.filter((f) => /\.(mp3|m4a|wav|flac|ogg|aac|aif{1,2}|wma|opus|alac)$/i.test(f.name));
    if (!audio.length) {
      toast.error("No audio files found in selected folder");
      return;
    }
    const rel = (audio[0] as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    const name = rel.split("/")[0] || `Folder ${audioSources.length + 1}`;
    setAudioSources((prev) => [
      ...prev,
      { id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: "folder", name, files },
    ]);
    toast.success(`Added folder "${name}" · ${audio.length} audio file${audio.length === 1 ? "" : "s"}`);
  }

  function addVdjSource(libIndex: number) {
    const lib = libraries[libIndex];
    if (!lib) return;
    const name = librarySources[libIndex] || `VirtualDJ library ${libIndex + 1}`;
    if (audioSources.some((s) => s.kind === "vdj" && s.libraryIndex === libIndex)) {
      toast.error("That VirtualDJ library is already a source");
      return;
    }
    setAudioSources((prev) => [
      ...prev,
      { id: `vdj-${libIndex}-${Date.now()}`, kind: "vdj", name, libraryIndex: libIndex },
    ]);
    toast.success(`Added VirtualDJ library as source`);
  }

  function removeAudioSource(id: string) {
    setAudioSources((prev) => prev.filter((s) => s.id !== id));
  }

  function rebuildAudioIndex() {
    // useMemo recomputes when audioSources changes; bump a no-op state to
    // force recompute when underlying File contents may have changed.
    setAudioSources((prev) => prev.map((s) => ({ ...s })));
    toast.success(`Rebuilt index: ${audioIndex.files.length.toLocaleString()} files · ${audioIndex.variantCount.toLocaleString()} indexed variants`);
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
    const prefs = {
      artists: artistsInput.split(",").map((s) => s.trim()).filter(Boolean),
      genres: genresInput.split(",").map((s) => s.trim()).filter(Boolean),
      decades,
      notes,
      doNotPlay: parseDoNotPlay(doNotPlayInput),
    };
    // Always build the base from uploads only; AI fills the gap when expand=true,
    // with the built-in library as a fallback if AI is unavailable.
    let r = generateLists({
      uploaded: uniqueSongs,
      hours: hoursNum,
      expand: false,
      prefs,
    });

    if (expand) {
      setIsGenerating(true);
      try {
        const sectionMap: Array<{ key: SectionKey; label: "Warm Up" | "Transition" | "Peak" }> = [
          { key: "warmUp", label: "Warm Up" },
          { key: "transition", label: "Transition" },
          { key: "peak", label: "Peak" },
        ];
        const existing: { artist: string; song: string }[] = [
          ...r.warmUp,
          ...r.transition,
          ...r.peak,
        ].map((s) => ({ artist: s.artist, song: s.song }));

        const failed: SectionKey[] = [];
        await Promise.all(
          sectionMap.map(async ({ key, label }) => {
            const need = r.perSectionTarget - r[key].length;
            if (need <= 0) return;
            try {
              const res = await recommendFn({
                data: { section: label, count: need, prefs, existing },
              });
              const seen = new Set(
                [...r[key], ...existing].map((s) => dedupeKey(s.artist, s.song)),
              );
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
                  aiSuggestion: true,
                  aiReason: sug.reason,
                } as (typeof r)[typeof key][number] & { aiSuggestion?: boolean; aiReason?: string });
              }
            } catch (err) {
              console.error("AI recommend failed", err);
              failed.push(key);
            }
          }),
        );

        if (failed.length) {
          // Fallback to built-in library padding for sections where AI failed.
          const fallback = generateLists({
            uploaded: uniqueSongs,
            hours: hoursNum,
            expand: true,
            prefs,
          });
          for (const key of failed) {
            const have = new Set(r[key].map((s) => dedupeKey(s.artist, s.song)));
            for (const s of fallback[key]) {
              if (r[key].length >= r.perSectionTarget) break;
              const k = dedupeKey(s.artist, s.song);
              if (have.has(k)) continue;
              have.add(k);
              r[key].push(s);
            }
          }
          toast.error("AI suggestions unavailable for some sections — used built-in library.");
        }
      } finally {
        setIsGenerating(false);
      }
    }

    // Re-bucket + sort the merged set so uploads and AI picks interleave into
    // a single ascending energy ramp from the first warm-up song to the last
    // peak song.
    r = reorderForEnergyProgression(r);

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
    setMatches({});
    toast.success("VirtualDJ library cleared");
  }

  async function chooseMyListsFolder() {
    if (!supportsDirectoryWrite()) {
      toast.error("Direct folder writing not supported in this browser");
      return;
    }
    const handle = await pickDirectoryHandle();
    if (handle) {
      setVdjDirHandle(handle);
      setVdjDirName((handle as DirHandleLike & { name?: string }).name ?? "VirtualDJ folder");
      toast.success("VirtualDJ folder linked");
    }
  }

  function clearMyListsFolder() {
    setVdjDirHandle(null);
    setVdjDirName(null);
    toast.success("VirtualDJ folder unlinked");
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

  // --- Export helpers ---

  function getSectionRefs(section: SectionKey): ExportSongRef[] {
    if (!result) return [];
    return result[section].map((s, i) => ({
      song: s,
      match: matches[songKey(section, i, s)],
    }));
  }

  function exportSectionCsv(section: SectionKey) {
    if (!result) return;
    const list = result[section];
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
    return getSectionRefs(section).filter(
      (r) => !r.match || r.match.trackIndex == null || r.match.excludedFromVdj,
    ).length;
  }

  async function exportSectionXml(section: SectionKey) {
    if (!mergedLibrary) {
      toast.error("Load a VirtualDJ database first");
      return;
    }
    const unmatched = unmatchedCount(section);
    if (unmatched > 0) {
      const ok = window.confirm(
        `${unmatched} songs are not matched to files in your VirtualDJ library. They will remain in your CSV reference lists but will not appear in the VirtualDJ XML playlist unless matched. Continue?`,
      );
      if (!ok) return;
    }
    const refs = getSectionRefs(section);
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    if (vdjDirHandle) {
      const m3u = buildM3u(refs, mergedLibrary);
      const fname = `${prefix}${SECTION_FILES[section]}.m3u`;
      try {
        await writeFileToDir(vdjDirHandle, fname, m3u);
        toast.success(`Saved ${fname} to ${vdjDirName ?? "VirtualDJ folder"}`);
        return;
      } catch {
        toast.error("Could not write to VirtualDJ folder, downloading instead");
      }
      downloadBlob(new Blob([m3u], { type: "audio/x-mpegurl" }), fname);
      return;
    }
    const xml = buildVirtualDjXml(refs, mergedLibrary);
    const fname = `${prefix}${SECTION_FILES[section]}.xml`;
    downloadBlob(new Blob([xml], { type: "application/xml" }), fname);

  }

  function exportSectionM3u(section: SectionKey) {
    if (!mergedLibrary) {
      toast.error("Load a VirtualDJ database first");
      return;
    }
    const refs = getSectionRefs(section);
    const m3u = buildM3u(refs, mergedLibrary);
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    downloadBlob(
      new Blob([m3u], { type: "audio/x-mpegurl" }),
      `${prefix}${SECTION_FILES[section]}.m3u`,
    );
  }

  async function exportAllZip() {
    if (!result) return;
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    const zip = new JSZip();
    (["warmUp", "transition", "peak"] as SectionKey[]).forEach((section) => {
      zip.file(`${prefix}${SECTION_FILES[section]}.csv`, songsToCsv(result[section]));
      if (mergedLibrary) {
        const refs = getSectionRefs(section);
        zip.file(`${prefix}${SECTION_FILES[section]}.xml`, buildVirtualDjXml(refs, mergedLibrary));
        zip.file(`${prefix}${SECTION_FILES[section]}.m3u`, buildM3u(refs, mergedLibrary));
      }
    });
    if (includeCombined) zip.file(`${prefix}combined-dance-floor-lists.csv`, combinedCsv(result));
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
              resetWorkflow={() => {
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
              }}
            />
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
                    Warm Up ~{sectionMinutes} min · Transition ~{sectionMinutes} min · Peak ~{sectionMinutes} min · Target <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs (<span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> per section, 1.5× buffer)
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
                    Target <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs · <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> per section (1.5× buffer)

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
                    Target <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs · <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> per section (1.5× buffer)
                  </p>
                )}
              </div>
              <Switch checked={expand} onCheckedChange={setExpand} />
            </div>
            {hoursNum > 0 && !expand && liveTargets.shortfall.total > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">Not enough uploaded songs to hit the 1.5× buffer.</p>
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

        {/* Step 5 - VirtualDJ Library */}
        <Card>
          <CardHeader>
            <CardTitle>Step 5 · VirtualDJ Library Matching (optional)</CardTitle>
            <CardDescription>
              Select your VirtualDJ database.xml or VirtualDJ folder. Files are read and indexed only in your browser — nothing is uploaded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={selectDatabaseXml}>
                <FolderOpen className="mr-1 h-4 w-4" /> Select VirtualDJ database.xml
              </Button>
              <Button variant="outline" size="sm" onClick={() => selectFolder("VirtualDJ Folder")}>
                <FolderOpen className="mr-1 h-4 w-4" /> Select VirtualDJ Folder
              </Button>
              <Button variant="outline" size="sm" onClick={() => selectFolder("External Drive VirtualDJ")}>
                <FolderOpen className="mr-1 h-4 w-4" /> Select External Drive VirtualDJ Folder
              </Button>
              <Button variant="outline" size="sm" onClick={() => selectFolder("Music Folder")}>
                <FolderOpen className="mr-1 h-4 w-4" /> Select Music Folder
              </Button>
              {libraries.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearLibraries}>
                  <X className="mr-1 h-4 w-4" /> Clear library
                </Button>
              )}
            </div>
            {mergedLibrary && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  Indexed {mergedLibrary.tracks.length} tracks from {libraries.length} source{libraries.length > 1 ? "s" : ""}
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {librarySources.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              {!vdjDirHandle ? (
                <Button variant="outline" size="sm" onClick={chooseMyListsFolder} disabled={!canDirWrite}>
                  <FolderOpen className="mr-1 h-4 w-4" />
                  Choose VirtualDJ export folder
                </Button>
              ) : (
                <>
                  <span className="text-sm">
                    Exporting to <span className="font-medium">{vdjDirName}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={chooseMyListsFolder} disabled={!canDirWrite}>
                    <FolderOpen className="mr-1 h-4 w-4" /> Change folder
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearMyListsFolder}>
                    <X className="mr-1 h-4 w-4" /> Clear
                  </Button>
                </>
              )}
              {!canDirWrite && (
                <span className="text-xs text-muted-foreground">
                  Direct saving unsupported in this browser — files will download instead.
                </span>
              )}
            </div>
            <div className="space-y-2 border-t pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Music sources</span>
                <Button variant="outline" size="sm" onClick={addAudioFolder}>
                  <Plus className="mr-1 h-4 w-4" /> Add folder
                </Button>
                {libraries.map((_, i) => {
                  const already = audioSources.some((s) => s.kind === "vdj" && s.libraryIndex === i);
                  if (already) return null;
                  return (
                    <Button key={`add-vdj-${i}`} variant="outline" size="sm" onClick={() => addVdjSource(i)}>
                      <Database className="mr-1 h-4 w-4" /> Use VirtualDJ library {libraries.length > 1 ? `#${i + 1}` : ""}
                    </Button>
                  );
                })}
                {audioSources.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={rebuildAudioIndex}>
                    <RefreshCw className="mr-1 h-4 w-4" /> Rebuild index
                  </Button>
                )}
              </div>
              {audioSources.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add one or more folders (and optionally a loaded VirtualDJ library) for in-app playback and better matching.
                  Without any source, ▶ falls back to a 30-second Apple Music preview.
                </p>
              ) : (
                <>
                  <ul className="space-y-1 text-sm">
                    {audioSources.map((s) => {
                      const count =
                        s.kind === "folder"
                          ? s.files.filter((f) => /\.(mp3|m4a|wav|flac|ogg|aac|aif{1,2}|wma|opus|alac)$/i.test(f.name)).length
                          : libraries[s.libraryIndex]?.tracks.length ?? 0;
                      return (
                        <li key={s.id} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1">
                          {s.kind === "folder" ? <FolderOpen className="h-4 w-4" /> : <Database className="h-4 w-4" />}
                          <span className="flex-1 truncate">{s.name}</span>
                          <span className="text-xs text-muted-foreground">{count.toLocaleString()} {s.kind === "folder" ? "files" : "tracks"}</span>
                          <Button variant="ghost" size="sm" onClick={() => removeAudioSource(s.id)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    {audioIndex.files.length.toLocaleString()} files · {audioIndex.variantCount.toLocaleString()} indexed variants across {audioSources.length} source{audioSources.length === 1 ? "" : "s"}
                  </p>
                </>
              )}
            </div>

          </CardContent>
        </Card>

        {/* Generate */}
        <div className="flex justify-center">
          <Button size="lg" onClick={generate} disabled={isGenerating}>
            {isGenerating ? "Generating with AI…" : "Generate Dance Floor Lists"}
          </Button>
        </div>

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
                      Target total <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.total}</span> songs · target per section <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSection}</span> (1.5× buffer over <span className={isPendingLive ? "opacity-40" : "opacity-100"}>{liveTargets.perSectionBase}</span> needed)
                    </p>
                    {!expand && liveTargets.shortfall.total > 0 && (
                      <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                        <div>
                          <p className="font-medium">Uploads fall short of the 1.5× buffer.</p>
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
                      onConfirm={confirmMatch}
                      onChoose={chooseAlternative}
                      onMarkUnresolved={markUnresolved}
                      onToggleExclude={toggleExclude}
                      onToggleExtra={toggleExtraPick}
                      onOpenSearch={openSearch}
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
      <PreviewPlayer target={previewTarget} onOpenChange={(o) => { if (!o) setPreviewTarget(null); }} resolveLocalFile={resolveLocalFile} />
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
};

function MetricsChip({ song }: { song: BadgeSong }) {
  const hasAny =
    typeof song.energy === "number" ||
    typeof song.danceability === "number" ||
    typeof song.popularity === "number" ||
    typeof song.valence === "number";
  if (!hasAny) return null;
  const fmt = (n?: number) => (typeof n === "number" ? n.toFixed(1).replace(/\.0$/, "") : "—");
  const intensity =
    typeof song.energy === "number" && typeof song.danceability === "number"
      ? ((song.energy + song.danceability) / 2).toFixed(1)
      : null;
  const lines = [
    `Energy: ${fmt(song.energy)}/10`,
    `Danceability: ${fmt(song.danceability)}/10`,
    `Popularity: ${fmt(song.popularity)}/10`,
    `Valence: ${fmt(song.valence)}/10`,
    intensity ? `Intensity (avg): ${intensity}/10` : null,
    song.aiReason ? `AI: ${song.aiReason}` : null,
  ].filter(Boolean) as string[];
  return (
    <span
      className="cursor-help rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-700"
      title={lines.join("\n")}
    >
      E{fmt(song.energy)} · D{fmt(song.danceability)}
    </span>
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
  onConfirm: (key: string) => void;
  onChoose: (key: string, trackIndex: number) => void;
  onMarkUnresolved: (key: string) => void;
  onToggleExclude: (key: string) => void;
  onToggleExtra: (key: string, trackIndex: number) => void;
  onOpenSearch?: (section: SectionKey, idx: number, s: Song) => void;
  onPreview?: (target: { artist: string; song: string; filePath?: string }) => void;
}

function SectionView(props: SectionViewProps) {
  const { section, songs, matches, library, songKey, onExportCsv, onExportXml, onExportM3u, onConfirm, onChoose, onMarkUnresolved, onToggleExclude, onToggleExtra, onPreview } = props;
  const sectionLabel = section === "warmUp" ? "Warm Up" : section === "transition" ? "Transition" : "Peak";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onExportCsv}>
          <Download className="mr-1 h-4 w-4" /> Export {sectionLabel} CSV
        </Button>
        <Button size="sm" variant="outline" onClick={onExportXml} disabled={!library}>
          <Download className="mr-1 h-4 w-4" /> Export VirtualDJ {sectionLabel} XML
        </Button>
        <Button size="sm" variant="outline" onClick={onExportM3u} disabled={!library}>
          <Download className="mr-1 h-4 w-4" /> Export M3U {sectionLabel} Playlist
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
                      <span className="break-words">{s.song}</span>
                      <MetricsChip song={s as BadgeSong} />
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
}: {
  song: Song;
  library: VdjLibrary;
  currentTrackIndex?: number;
  extraTrackIndices: number[];
  onPick: (trackIndex: number) => void;
  onToggleExtra: (trackIndex: number) => void;
}) {
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
        {totalSelected > 1 && (
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
            {totalSelected} selected
          </span>
        )}
      </div>
      {results.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No matches in library. Try editing the search above (artist, title, or part of the file name).
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
