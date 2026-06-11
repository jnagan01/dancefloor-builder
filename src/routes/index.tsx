import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import JSZip from "jszip";
import {
  parseFile,
  dedupeSongs,
  dedupeKey,
  generateLists,
  songsToCsv,
  combinedCsv,
  downloadBlob,
  formatMinutes,
  parseDoNotPlay,
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
import { Trash2, Upload, Plus, Download, Music, AlertTriangle, FolderOpen, Search, X, Check } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";

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
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // VirtualDJ state
  const [libraries, setLibraries] = useState<VdjLibrary[]>([]);
  const [librarySources, setLibrarySources] = useState<string[]>([]);
  const [matches, setMatches] = useState<Record<string, SongMatch>>({});
  const [vdjDirHandle, setVdjDirHandle] = useState<DirHandleLike | null>(null);
  const [searchOpen, setSearchOpen] = useState<{ section: SectionKey; idx: number; key: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [canDirWrite, setCanDirWrite] = useState(false);
  useEffect(() => { setCanDirWrite(supportsDirectoryWrite()); }, []);

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

  function songKey(section: SectionKey, idx: number, s: Song): string {
    return `${section}:${idx}:${dedupeKey(s.artist, s.song)}`;
  }




  function generate() {
    if (!songs.length) {
      toast.error("Upload at least one song first");
      return;
    }
    if (hoursNum <= 0) {
      toast.error("Enter a valid dance floor length");
      return;
    }
    const uniqueSongs = dedupeSongs(songs);
    const r = generateLists({
      uploaded: uniqueSongs,
      hours: hoursNum,
      expand,
      prefs: {
        artists: artistsInput.split(",").map((s) => s.trim()).filter(Boolean),
        genres: genresInput.split(",").map((s) => s.trim()).filter(Boolean),
        decades,
        notes,
        doNotPlay: parseDoNotPlay(doNotPlayInput),
      },
    });
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
    toast.success("Lists generated");
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
      toast.success("VirtualDJ My Lists folder linked");
    }
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
    updateMatch(key, { status: "Manually Matched", confidence: 1, trackIndex, alternatives: others });
  }

  function markUnresolved(key: string) {
    updateMatch(key, { status: "Missing From Library", confidence: 0, trackIndex: undefined, alternatives: [] });
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
    updateMatch(searchOpen.key, {
      status: "Manually Matched",
      confidence: 1,
      trackIndex,
      alternatives: [],
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
    const xml = buildVirtualDjXml(refs, mergedLibrary);
    const prefix = eventName ? `${toKebabCase(eventName)}-` : "";
    const fname = `${prefix}${SECTION_FILES[section]}.xml`;
    if (vdjDirHandle) {
      try {
        await writeFileToDir(vdjDirHandle, fname, xml);
        toast.success(`Saved ${fname} to VirtualDJ My Lists`);
        return;
      } catch {
        toast.error("Could not write to My Lists folder, downloading instead");
      }
    }
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
    const sourceCounts: Record<SectionKey, { uploads: number; library: number }> = {
      warmUp: { uploads: 0, library: 0 },
      transition: { uploads: 0, library: 0 },
      peak: { uploads: 0, library: 0 },
    };
    sections.forEach((sec) => {
      result[sec].forEach((s, i) => {
        total += 1;
        if (s.fromUpload) sourceCounts[sec].uploads += 1;
        else sourceCounts[sec].library += 1;
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
              <Label htmlFor="donotplay">Do Not Play list</Label>
              <Textarea
                id="donotplay"
                value={doNotPlayInput}
                onChange={(e) => setDoNotPlayInput(e.target.value)}
                className="mt-1.5 font-mono text-sm"
                rows={4}
                placeholder={"One per line\nArtist - Song  (blocks that track)\nArtist          (blocks all songs by that artist)"}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Used only when expanding from the built-in library. Songs from your uploaded files are never filtered.
                {parseDoNotPlay(doNotPlayInput).length > 0 && (
                  <span className="ml-1 font-medium text-foreground">
                    {parseDoNotPlay(doNotPlayInput).length} blocked
                  </span>
                )}
              </p>
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
              <Button variant="outline" size="sm" onClick={chooseMyListsFolder} disabled={!canDirWrite}>
                <FolderOpen className="mr-1 h-4 w-4" />
                {vdjDirHandle ? "VirtualDJ My Lists linked" : "Save directly to VirtualDJ My Lists folder"}
              </Button>
              {!canDirWrite && (
                <span className="text-xs text-muted-foreground">
                  Direct saving unsupported in this browser — files will download instead.
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Generate */}
        <div className="flex justify-center">
          <Button size="lg" onClick={generate}>Generate Dance Floor Lists</Button>
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
                              <span className="text-muted-foreground">From uploads</span>
                              <span className="font-semibold">{c.uploads}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Added from library</span>
                              <span className="font-semibold">{c.library}</span>
                            </div>
                            <div className="mt-1 border-t pt-1 flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Total</span>
                              <span className="font-semibold">{c.uploads + c.library}</span>
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

              <Tabs defaultValue="warmUp">
                <TabsList>
                  <TabsTrigger value="warmUp">Warm Up ({result.warmUp.length})</TabsTrigger>
                  <TabsTrigger value="transition">Transition ({result.transition.length})</TabsTrigger>
                  <TabsTrigger value="peak">Peak ({result.peak.length})</TabsTrigger>
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
                      onOpenSearch={openSearch}
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
                        <TableCell className="w-20">
                          <Button size="sm" variant="outline" onClick={() => applySearchPick(i)}>
                            <Check className="mr-1 h-4 w-4" /> Pick
                          </Button>
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
    </div>
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
  onOpenSearch: (section: SectionKey, idx: number, s: Song) => void;
}

function SectionView(props: SectionViewProps) {
  const { section, songs, matches, library, songKey, onExportCsv, onExportXml, onExportM3u, onConfirm, onChoose, onMarkUnresolved, onToggleExclude, onOpenSearch } = props;
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
                <TableRow key={i} className={m?.excludedFromVdj ? "opacity-60" : ""}>
                  <TableCell>{s.artist}</TableCell>
                  <TableCell>{s.song}</TableCell>
                  {library && (
                    <>
                      <TableCell>{m ? statusBadge(m.status) : statusBadge("Missing From Library")}</TableCell>
                      <TableCell className="text-xs">{m ? `${Math.round(m.confidence * 100)}%` : "—"}</TableCell>
                      <TableCell className="text-xs">{track?.bpm || "—"}</TableCell>
                      <TableCell className="text-xs">{track?.key || "—"}</TableCell>
                      <TableCell className="max-w-xs">
                        {track ? (
                          <div className="space-y-1">
                            <p className="truncate text-xs" title={track.filePath}>{track.filePath}</p>
                            {m && m.alternatives.length > 0 && (
                              <select
                                className="w-full rounded border bg-background px-2 py-1 text-xs"
                                value={m.trackIndex ?? ""}
                                onChange={(e) => onChoose(key, Number(e.target.value))}
                              >
                                {[m.trackIndex!, ...m.alternatives].map((ti) => {
                                  const t = library.tracks[ti];
                                  return <option key={ti} value={ti}>{t.artist} — {t.title}</option>;
                                })}
                              </select>
                            )}
                          </div>
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
                          <Button size="sm" variant="outline" onClick={() => onOpenSearch(section, i, s)} title="Search library">
                            <Search className="h-3 w-3" />
                          </Button>
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
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
