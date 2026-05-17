import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
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
  type Song,
  type GenerationResult,
} from "@/lib/danceFloor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Upload, Plus, Download, Music, AlertTriangle } from "lucide-react";
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

function Index() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [hours, setHours] = useState<string>("3");
  const [artistsInput, setArtistsInput] = useState("");
  const [genresInput, setGenresInput] = useState("");
  const [decades, setDecades] = useState<string[]>(["2000s", "2010s", "2020s"]);
  const [notes, setNotes] = useState("");
  const [expand, setExpand] = useState(false);
  const [includeCombined, setIncludeCombined] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      } catch (e) {
        toast.error(`Could not parse ${f.name}`);
      }
    }
    setSongs(next);
    toast.success(`Imported ${added} songs from ${valid.length} file${valid.length > 1 ? "s" : ""}`);
  }

  const hoursNum = parseFloat(hours) || 0;
  const sectionMinutes = formatMinutes(hoursNum);

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
      },
    });
    setResult(r);
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

  function exportSection(name: string, list: Song[]) {
    if (!list.length) {
      toast.error("No songs in this section");
      return;
    }
    downloadBlob(new Blob([songsToCsv(list)], { type: "text/csv" }), `${name}.csv`);
  }

  async function exportZip() {
    if (!result) return;
    const zip = new JSZip();
    zip.file("warm-up.csv", songsToCsv(result.warmUp));
    zip.file("transition.csv", songsToCsv(result.transition));
    zip.file("peak.csv", songsToCsv(result.peak));
    if (includeCombined) zip.file("combined-dance-floor-lists.csv", combinedCsv(result));
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "dance-floor-lists.zip");
  }

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
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={removeDuplicates}
                >
                  <AlertTriangle className="mr-1 h-4 w-4" />
                  Remove {duplicateKeys.size} duplicate{duplicateKeys.size > 1 ? "s" : ""}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSongs([...songs, { artist: "", song: "" }])}
              >
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
                  Rows marked with a warning icon share the same artist and song (ignoring case and punctuation).
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
                        <TableRow key={i} className={isDup ? "bg-destructive/5" : ""}>
                          <TableCell>
                            <Input
                              value={s.artist}
                              onChange={(e) => {
                                const next = [...songs];
                                next[i] = { ...next[i], artist: e.target.value };
                                setSongs(next);
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={s.song}
                              onChange={(e) => {
                                const next = [...songs];
                                next[i] = { ...next[i], song: e.target.value };
                                setSongs(next);
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
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
                  <p className="mt-2 text-xs text-muted-foreground">
                    Warm Up ~{sectionMinutes} min · Transition ~{sectionMinutes} min · Peak ~{sectionMinutes} min
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
              </div>
            </div>
            <div>
              <Label htmlFor="artists">Favorite artists (comma separated)</Label>
              <Input
                id="artists"
                placeholder="Pitbull, Flo Rida, Rihanna, Lady Gaga, David Guetta"
                value={artistsInput}
                onChange={(e) => setArtistsInput(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="genres">Favorite genres (comma separated)</Label>
              <Input
                id="genres"
                placeholder="Pop, EDM, Pop Punk, Alternative Rock, Rock"
                value={genresInput}
                onChange={(e) => setGenresInput(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="notes">Additional notes</Label>
              <Textarea
                id="notes"
                placeholder="Focus mostly on songs from 2000 and newer. Keep the first hour all-ages friendly."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1.5"
                rows={3}
              />
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
              </div>
              <Switch checked={expand} onCheckedChange={setExpand} />
            </div>
          </CardContent>
        </Card>

        {/* Step 5 */}
        <div className="flex justify-center">
          <Button size="lg" onClick={generate}>
            Generate Dance Floor Lists
          </Button>
        </div>

        {/* Step 6 */}
        {result && (
          <Card id="results">
            <CardHeader>
              <CardTitle>Step 6 · Review and export</CardTitle>
              <CardDescription>
                Each CSV exports with exactly two columns: Artist, Song.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Button onClick={exportZip}>
                  <Download className="mr-1 h-4 w-4" />
                  Download all as ZIP
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={includeCombined}
                    onCheckedChange={(v) => setIncludeCombined(!!v)}
                  />
                  Include combined reference CSV
                </label>
              </div>
              <Tabs defaultValue="warm">
                <TabsList>
                  <TabsTrigger value="warm">Warm Up ({result.warmUp.length})</TabsTrigger>
                  <TabsTrigger value="trans">Transition ({result.transition.length})</TabsTrigger>
                  <TabsTrigger value="peak">Peak ({result.peak.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="warm">
                  <SectionView
                    songs={result.warmUp}
                    onExport={() => exportSection("warm-up", result.warmUp)}
                  />
                </TabsContent>
                <TabsContent value="trans">
                  <SectionView
                    songs={result.transition}
                    onExport={() => exportSection("transition", result.transition)}
                  />
                </TabsContent>
                <TabsContent value="peak">
                  <SectionView
                    songs={result.peak}
                    onExport={() => exportSection("peak", result.peak)}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        <footer className="py-6 text-center text-xs text-muted-foreground">
          Files are processed in your browser. Nothing is uploaded or stored.
        </footer>
      </main>
    </div>
  );
}

function SectionView({ songs, onExport }: { songs: Song[]; onExport: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onExport}>
          <Download className="mr-1 h-4 w-4" />
          Export CSV
        </Button>
      </div>
      <div className="max-h-96 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Artist</TableHead>
              <TableHead>Song</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {songs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                  No songs in this section
                </TableCell>
              </TableRow>
            ) : (
              songs.map((s, i) => (
                <TableRow key={i}>
                  <TableCell>{s.artist}</TableCell>
                  <TableCell>{s.song}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
