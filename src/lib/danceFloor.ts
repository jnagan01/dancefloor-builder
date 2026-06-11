import Papa from "papaparse";
import { SONG_LIBRARY, type LibrarySong, type Section } from "./songLibrary";

export type { Section };

export interface Song {
  artist: string;
  song: string;
}

export interface ScoredSong extends Song {
  energy?: number;
  genre?: string;
  decade?: string;
  fromUpload: boolean;
}

export const SECTIONS: Section[] = ["Warm Up", "Transition", "Peak"];

const ARTIST_KEYS = ["artist", "artists", "performer", "performers"];
const SONG_KEYS = ["song", "track", "track name", "title", "name", "song name", "song title"];

export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeKey(artist: string, song: string): string {
  return `${normalizeKey(artist)}|${normalizeKey(song)}`;
}

function pickKey(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const i = lower.indexOf(c);
    if (i >= 0) return headers[i];
  }
  return null;
}

export async function parseFile(file: File): Promise<Song[]> {
  const text = await file.text();
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "txt") return parseTxt(text);
  return parseCsv(text);
}

function parseCsv(text: string): Song[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  if (!result.data.length) return [];
  const headers = result.meta.fields ?? [];
  const aKey = pickKey(headers, ARTIST_KEYS);
  const sKey = pickKey(headers, SONG_KEYS);
  if (aKey && sKey) {
    return result.data
      .map((r) => ({ artist: (r[aKey] || "").trim(), song: (r[sKey] || "").trim() }))
      .filter((r) => r.artist && r.song);
  }
  // Fallback: parse without headers, two columns
  const rows = Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
  return rows
    .map((r) => guessArtistSong((r[0] || "") + " - " + (r[1] || "")))
    .filter((r): r is Song => !!r);
}

function parseTxt(text: string): Song[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(guessArtistSong)
    .filter((r): r is Song => !!r);
}

function guessArtistSong(line: string): Song | null {
  const seps = [" - ", " – ", " — ", " : ", ", ", "\t", "|"];
  for (const sep of seps) {
    if (line.includes(sep)) {
      const [a, b] = line.split(sep).map((s) => s.trim());
      if (a && b) {
        // Heuristic: if "song by artist"
        const byMatch = line.match(/^(.+?)\s+by\s+(.+)$/i);
        if (byMatch) return { artist: byMatch[2].trim(), song: byMatch[1].trim() };
        return { artist: a, song: b };
      }
    }
  }
  return null;
}

export function dedupeSongs<T extends Song>(songs: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of songs) {
    const k = dedupeKey(s.artist, s.song);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export interface Preferences {
  artists: string[];
  genres: string[];
  decades: string[];
  notes: string;
  doNotPlay?: DoNotPlayEntry[];
}

export interface DoNotPlayEntry {
  artist: string;
  song?: string;
}

export function parseDoNotPlay(text: string): DoNotPlayEntry[] {
  const seps = [" - ", " – ", " — ", " : ", "\t", "|"];
  const out: DoNotPlayEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let entry: DoNotPlayEntry | null = null;
    for (const sep of seps) {
      const i = line.indexOf(sep);
      if (i > 0) {
        const a = line.slice(0, i).trim();
        const s = line.slice(i + sep.length).trim();
        if (a) entry = { artist: a, song: s || undefined };
        break;
      }
    }
    if (!entry) entry = { artist: line };
    out.push(entry);
  }
  return out;
}

export function isBlocked(artist: string, song: string, blocklist?: DoNotPlayEntry[]): boolean {
  if (!blocklist || !blocklist.length) return false;
  const a = normalizeKey(artist);
  const s = normalizeKey(song);
  return blocklist.some((b) => {
    const ba = normalizeKey(b.artist);
    if (!ba || ba !== a) return false;
    if (!b.song) return true;
    return normalizeKey(b.song) === s;
  });
}

function detectDecadeFromTitle(_artist: string, _song: string): string | undefined {
  return undefined;
}

function lookupLibrary(artist: string, song: string): LibrarySong | undefined {
  const aKey = normalizeKey(artist);
  const sKey = normalizeKey(song);
  return SONG_LIBRARY.find(
    (l) => normalizeKey(l.artist) === aKey && normalizeKey(l.song) === sKey,
  );
}

function estimateEnergy(artist: string, song: string, prefs: Preferences): { energy: number; section: Section; genre?: string; decade?: string } {
  const lib = lookupLibrary(artist, song);
  if (lib) return { energy: lib.energy, section: lib.section, genre: lib.genre, decade: lib.decade };

  const artistLower = artist.toLowerCase();
  const songLower = song.toLowerCase();

  // Heuristics
  let energy = 7;
  // High-energy artist hints
  const highArtists = ["pitbull", "flo rida", "lmfao", "calvin harris", "david guetta", "avicii", "kesha", "lady gaga", "the weeknd"];
  const lowArtists = ["frank sinatra", "michael bublé", "ed sheeran", "norah jones", "adele", "john legend"];
  if (highArtists.some((a) => artistLower.includes(a))) energy = 9;
  else if (lowArtists.some((a) => artistLower.includes(a))) energy = 5;

  // Title hints
  if (/\b(party|dance|club|tonight|fire|hot|wild|bang|jump|move)\b/.test(songLower)) energy = Math.max(energy, 8);
  if (/\b(slow|love|forever|always|home|lullaby)\b/.test(songLower)) energy = Math.min(energy, 6);

  // Preferred artists boost
  if (prefs.artists.some((a) => a && artistLower.includes(a.toLowerCase()))) energy = Math.max(energy, 8);

  const decade = detectDecadeFromTitle(artist, song);
  let section: Section;
  if (energy <= 6) section = "Warm Up";
  else if (energy <= 8) section = "Transition";
  else section = "Peak";

  return { energy, section, decade };
}

export interface GenerationInput {
  uploaded: Song[];
  prefs: Preferences;
  hours: number;
  expand: boolean;
}

export interface GenerationResult {
  warmUp: Array<Song & { fromUpload?: boolean }>;
  transition: Array<Song & { fromUpload?: boolean }>;
  peak: Array<Song & { fromUpload?: boolean }>;
}

const SONGS_PER_HOUR = 15; // ~4 min/song

export function generateLists(input: GenerationInput): GenerationResult {
  const { uploaded, prefs, hours, expand } = input;
  const cleanUploaded = dedupeSongs(uploaded.filter((s) => s.artist && s.song));

  // Score uploaded songs
  const scored: Array<ScoredSong & { section: Section; energy: number }> = cleanUploaded.map((s) => {
    const est = estimateEnergy(s.artist, s.song, prefs);
    return { ...s, fromUpload: true, energy: est.energy, genre: est.genre, decade: est.decade, section: est.section };
  });

  // Distribute uploaded songs evenly across the three sections by energy ranking.
  // Sort by energy ascending, split into thirds.
  const sortedByEnergy = [...scored].sort((a, b) => a.energy - b.energy);
  const total = sortedByEnergy.length;
  const third = Math.ceil(total / 3);
  const warmUp: Array<ScoredSong & { section: Section }> = [];
  const transition: Array<ScoredSong & { section: Section }> = [];
  const peak: Array<ScoredSong & { section: Section }> = [];
  sortedByEnergy.forEach((s, i) => {
    if (i < third) warmUp.push({ ...s, section: "Warm Up" });
    else if (i < third * 2) transition.push({ ...s, section: "Transition" });
    else peak.push({ ...s, section: "Peak" });
  });

  if (expand) {
    const totalSongsNeeded = Math.ceil(hours * SONGS_PER_HOUR);
    const perSectionNeeded = Math.ceil(totalSongsNeeded / 3);

    const seen = new Set(cleanUploaded.map((s) => dedupeKey(s.artist, s.song)));

    const matchScore = (lib: LibrarySong): number => {
      let score = 0;
      if (prefs.artists.some((a) => a && lib.artist.toLowerCase().includes(a.toLowerCase()))) score += 5;
      if (prefs.genres.some((g) => g && lib.genre.toLowerCase().includes(g.toLowerCase()))) score += 3;
      if (prefs.decades.includes(lib.decade)) score += 2;
      const notesLower = prefs.notes.toLowerCase();
      if (notesLower && (notesLower.includes(lib.genre.toLowerCase()) || notesLower.includes(lib.artist.toLowerCase()))) score += 1;
      return score;
    };

    const candidates = SONG_LIBRARY
      .filter((l) => !seen.has(dedupeKey(l.artist, l.song)))
      .filter((l) => !isBlocked(l.artist, l.song, prefs.doNotPlay))
      .map((l) => ({ lib: l, score: matchScore(l) }))
      .sort((a, b) => b.score - a.score);

    const addTo = (bucket: typeof warmUp, section: Section, need: number) => {
      // Expansion always tops the section up by `need` library suggestions
      // (capped by available candidates) — independent of how many uploads
      // were already bucketed into this section.
      let added = 0;
      for (const { lib } of candidates) {
        if (added >= need) break;
        if (lib.section !== section) continue;
        const k = dedupeKey(lib.artist, lib.song);
        if (seen.has(k)) continue;
        seen.add(k);
        bucket.push({
          artist: lib.artist,
          song: lib.song,
          fromUpload: false,
          energy: lib.energy,
          genre: lib.genre,
          decade: lib.decade,
          section,
        });
        added++;
      }
    };

    addTo(warmUp, "Warm Up", perSectionNeeded);
    addTo(transition, "Transition", perSectionNeeded);
    addTo(peak, "Peak", perSectionNeeded);
  }

  return {
    warmUp: warmUp.map((s) => ({ artist: s.artist, song: s.song })),
    transition: transition.map((s) => ({ artist: s.artist, song: s.song })),
    peak: peak.map((s) => ({ artist: s.artist, song: s.song })),
  };
}

export function songsToCsv(songs: Song[]): string {
  return Papa.unparse(
    songs.map((s) => ({ Artist: s.artist, Song: s.song })),
    { columns: ["Artist", "Song"] },
  );
}

export function combinedCsv(result: GenerationResult): string {
  const rows: Array<{ Section: string; Artist: string; Song: string }> = [];
  result.warmUp.forEach((s) => rows.push({ Section: "Warm Up", Artist: s.artist, Song: s.song }));
  result.transition.forEach((s) => rows.push({ Section: "Transition", Artist: s.artist, Song: s.song }));
  result.peak.forEach((s) => rows.push({ Section: "Peak", Artist: s.artist, Song: s.song }));
  return Papa.unparse(rows, { columns: ["Section", "Artist", "Song"] });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function formatMinutes(hours: number): number {
  return Math.round((hours * 60) / 3);
}
