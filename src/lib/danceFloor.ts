import Papa from "papaparse";
import { SONG_LIBRARY, type LibrarySong, type Section } from "./songLibrary";

export type { Section };

export interface Song {
  artist: string;
  song: string;
}

export type AudienceFit = "older" | "younger" | "adult" | "all";

export interface ScoredSong extends Song {
  energy?: number;
  danceability?: number;
  genre?: string;
  decade?: string;
  audienceFit?: AudienceFit;
  fromUpload: boolean;
}

export const SECTIONS: Section[] = ["Warm Up", "Transition", "Peak"];

const OLDER_GENRES = new Set(["disco", "soul", "funk", "oldies", "country", "motown"]);
const ADULT_GENRES = new Set(["edm", "hip hop", "rap", "house", "trap"]);
const OLDER_DECADES = new Set(["1950s", "1960s", "1970s", "1980s"]);
const YOUNGER_DECADES = new Set(["2010s", "2020s"]);

export function inferAudienceFit(decade?: string, genre?: string): AudienceFit {
  const g = (genre || "").toLowerCase();
  const d = (decade || "").toLowerCase();
  if (ADULT_GENRES.has(g)) return "adult";
  if (OLDER_GENRES.has(g) || OLDER_DECADES.has(d)) return "older";
  if (YOUNGER_DECADES.has(d) && (g === "pop" || g === "alternative rock")) return "younger";
  return "all";
}

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

export function doNotPlayEntriesToText(entries: DoNotPlayEntry[]): string {
  return entries
    .map((e) => (e.song ? `${e.artist} - ${e.song}` : e.artist))
    .join("\n");
}

export async function parseDoNotPlayFile(file: File): Promise<DoNotPlayEntry[]> {
  const text = await file.text();
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "txt") return parseDoNotPlay(text);
  // CSV path
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const headers = parsed.meta.fields ?? [];
  const aKey = pickKey(headers, ARTIST_KEYS);
  const sKey = pickKey(headers, SONG_KEYS);
  if (aKey) {
    const out: DoNotPlayEntry[] = [];
    for (const row of parsed.data) {
      const artist = (row[aKey] || "").trim();
      if (!artist) continue;
      const song = sKey ? (row[sKey] || "").trim() : "";
      out.push(song ? { artist, song } : { artist });
    }
    if (out.length) return out;
  }
  // Fallback: treat as plain text (one entry per line, possibly Artist,Song two-column)
  const rows = Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
  const out: DoNotPlayEntry[] = [];
  for (const r of rows) {
    const a = (r[0] || "").trim();
    if (!a) continue;
    const s = (r[1] || "").trim();
    out.push(s ? { artist: a, song: s } : { artist: a });
  }
  return out;
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

interface EnergyEstimate {
  energy: number;
  danceability: number;
  section: Section;
  genre?: string;
  decade?: string;
  audienceFit: AudienceFit;
}

function estimateEnergy(artist: string, song: string, prefs: Preferences): EnergyEstimate {
  const lib = lookupLibrary(artist, song);
  if (lib) {
    return {
      energy: lib.energy,
      danceability: lib.danceability,
      section: lib.section,
      genre: lib.genre,
      decade: lib.decade,
      audienceFit: inferAudienceFit(lib.decade, lib.genre),
    };
  }

  const artistLower = artist.toLowerCase();
  const songLower = song.toLowerCase();

  // Heuristics
  let energy = 7;
  let danceability = 6;
  // High-energy artist hints
  const highArtists = ["pitbull", "flo rida", "lmfao", "calvin harris", "david guetta", "avicii", "kesha", "lady gaga", "the weeknd"];
  const lowArtists = ["frank sinatra", "michael bublé", "ed sheeran", "norah jones", "adele", "john legend"];
  if (highArtists.some((a) => artistLower.includes(a))) { energy = 9; danceability = 9; }
  else if (lowArtists.some((a) => artistLower.includes(a))) { energy = 5; danceability = 5; }

  // Title hints
  if (/\b(party|dance|club|tonight|fire|hot|wild|bang|jump|move)\b/.test(songLower)) {
    energy = Math.max(energy, 8);
    danceability = Math.max(danceability, 8);
  }
  if (/\b(slow|love|forever|always|home|lullaby)\b/.test(songLower)) {
    energy = Math.min(energy, 6);
    danceability = Math.min(danceability, 6);
  }

  // Preferred artists boost
  if (prefs.artists.some((a) => a && artistLower.includes(a.toLowerCase()))) energy = Math.max(energy, 8);

  const decade = detectDecadeFromTitle(artist, song);
  let section: Section;
  if (energy <= 6) section = "Warm Up";
  else if (energy <= 8) section = "Transition";
  else section = "Peak";

  return { energy, danceability, section, decade, audienceFit: "all" };
}

interface SectionScores {
  "Warm Up": number;
  Transition: number;
  Peak: number;
}

export function sectionScores(
  energy: number,
  danceability: number,
  audienceFit: AudienceFit,
): SectionScores {
  return {
    "Warm Up":
      (10 - energy) +
      danceability * 0.5 +
      (audienceFit === "older" ? 5 : 0) +
      (audienceFit === "younger" ? 4 : 0) -
      (audienceFit === "adult" ? 3 : 0),
    Transition:
      (8 - Math.abs(energy - 7)) +
      danceability * 0.5 +
      (audienceFit === "all" ? 2 : 0),
    Peak:
      energy +
      danceability * 0.5 +
      (audienceFit === "adult" ? 4 : 0) -
      (audienceFit === "older" ? 3 : 0) -
      (audienceFit === "younger" ? 2 : 0),
  };
}

function bestSection(scores: SectionScores): Section {
  let best: Section = "Warm Up";
  let bestVal = scores["Warm Up"];
  if (scores.Transition > bestVal) { best = "Transition"; bestVal = scores.Transition; }
  if (scores.Peak > bestVal) { best = "Peak"; }
  return best;
}

export interface GenerationInput {
  uploaded: Song[];
  prefs: Preferences;
  hours: number;
  expand: boolean;
}

export interface ResultSong extends Song {
  fromUpload?: boolean;
  energy?: number;
  danceability?: number;
  popularity?: number;
  valence?: number;
}

export interface GenerationResult {
  warmUp: ResultSong[];
  transition: ResultSong[];
  peak: ResultSong[];
  targetTotal: number;
  perSectionTarget: number;
  perSectionBase: number;
  shortfall: { warmUp: number; transition: number; peak: number; total: number };
  /**
   * Shortfall measured AFTER expansion / AI / rebalance — i.e. how many
   * songs each section is still missing once we've also fallen back to
   * borrowing from neighbours to keep the energy ramp continuous.
   * Populated by `reorderForEnergyProgression`.
   */
  finalShortfall?: { warmUp: number; transition: number; peak: number; total: number };
  duplicatesRemoved: number;
  blockedCount: number;
}


const SONGS_PER_HOUR = 15; // ~4 min/song
export const SECTION_BUFFER = 1.5;

/**
 * Combined intensity score (1–10). Mean of energy & danceability — the two
 * signals the user explicitly wants driving section placement and ordering.
 */
export function intensityOf(s: { energy?: number; danceability?: number }): number {
  const e = typeof s.energy === "number" ? s.energy : 7;
  const d = typeof s.danceability === "number" ? s.danceability : 6;
  return (e + d) / 2;
}

/**
 * Bucket by absolute intensity band so warm-up = low energy/danceability,
 * peak = high. Stable for any list size (works for 1 song or 100).
 */
export function sectionForIntensity(intensity: number): Section {
  if (intensity <= 6.5) return "Warm Up";
  if (intensity >= 8) return "Peak";
  return "Transition";
}

/**
 * Sort ascending by intensity (low → high) so each section, and the
 * concatenated warm-up→transition→peak set, forms a continuous energy ramp.
 * Popularity is a tiebreaker — less-known first so the biggest crowd-pleasers
 * land later in their section.
 */
export function sortByIntensity<T extends { energy?: number; danceability?: number; popularity?: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ai = intensityOf(a);
    const bi = intensityOf(b);
    if (ai !== bi) return ai - bi;
    const ap = typeof a.popularity === "number" ? a.popularity : 5;
    const bp = typeof b.popularity === "number" ? b.popularity : 5;
    return ap - bp;
  });
}

export function generateLists(input: GenerationInput): GenerationResult {
  const { uploaded, prefs, hours, expand } = input;
  const validUploaded = uploaded.filter((s) => s.artist && s.song);
  const dedupedUploaded = dedupeSongs(validUploaded);
  const cleanUploaded = dedupedUploaded.filter((s) => !isBlocked(s.artist, s.song, prefs.doNotPlay));

  const duplicatesRemoved = validUploaded.length - dedupedUploaded.length;
  const blockedCount = dedupedUploaded.length - cleanUploaded.length;

  // Score every upload, then bucket by intensity band (energy + danceability).
  type Scored = ResultSong & { section: Section };
  const scored: Scored[] = cleanUploaded.map((s) => {
    const est = estimateEnergy(s.artist, s.song, prefs);
    const intensity = intensityOf(est);
    return {
      artist: s.artist,
      song: s.song,
      fromUpload: true,
      energy: est.energy,
      danceability: est.danceability,
      section: sectionForIntensity(intensity),
    };
  });

  const warmUp: Scored[] = [];
  const transition: Scored[] = [];
  const peak: Scored[] = [];
  const bucketOf = (sec: Section) => (sec === "Warm Up" ? warmUp : sec === "Transition" ? transition : peak);
  scored.forEach((s) => bucketOf(s.section).push(s));

  const totalSongsNeeded = Math.ceil(hours * SONGS_PER_HOUR);
  const perSectionBase = Math.ceil(totalSongsNeeded / 3);
  const perSectionTarget = Math.ceil(perSectionBase * SECTION_BUFFER);

  // Shortfall is computed from uploads only (before expansion fills the gap),
  // so the UI can warn when expansion is OFF.
  const shortfall = {
    warmUp: Math.max(0, perSectionTarget - warmUp.length),
    transition: Math.max(0, perSectionTarget - transition.length),
    peak: Math.max(0, perSectionTarget - peak.length),
    total: 0,
  };
  shortfall.total = shortfall.warmUp + shortfall.transition + shortfall.peak;

  if (expand) {
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

    // Score library candidates by intensity and pick the section they belong
    // in based on the same band rule used for uploads.
    const candidates = SONG_LIBRARY
      .filter((l) => !seen.has(dedupeKey(l.artist, l.song)))
      .filter((l) => !isBlocked(l.artist, l.song, prefs.doNotPlay))
      .map((l) => ({ lib: l, score: matchScore(l), section: sectionForIntensity(intensityOf(l)) }))
      .sort((a, b) => b.score - a.score);

    const padTo = (bucket: Scored[], section: Section, target: number) => {
      for (const { lib, section: libSec } of candidates) {
        if (bucket.length >= target) break;
        if (libSec !== section) continue;
        const k = dedupeKey(lib.artist, lib.song);
        if (seen.has(k)) continue;
        seen.add(k);
        bucket.push({
          artist: lib.artist,
          song: lib.song,
          fromUpload: false,
          energy: lib.energy,
          danceability: lib.danceability,
          section,
        });
      }
    };

    padTo(warmUp, "Warm Up", perSectionTarget);
    padTo(transition, "Transition", perSectionTarget);
    padTo(peak, "Peak", perSectionTarget);
  }

  // Sort each section ascending by intensity for a smooth energy ramp.
  const toResult = (list: Scored[]): ResultSong[] =>
    sortByIntensity(list).map((s) => ({
      artist: s.artist,
      song: s.song,
      fromUpload: s.fromUpload,
      energy: s.energy,
      danceability: s.danceability,
    }));

  return {
    warmUp: toResult(warmUp),
    transition: toResult(transition),
    peak: toResult(peak),
    targetTotal: perSectionTarget * 3,
    perSectionTarget,
    perSectionBase,
    shortfall,
    duplicatesRemoved,
    blockedCount,
  };
}

/**
 * Re-bucket + re-sort an already-generated result using the scores attached
 * to each song. Used after AI suggestions are merged in so uploads and AI
 * picks are interleaved into a single ascending energy ramp.
 */
export function reorderForEnergyProgression(result: GenerationResult): GenerationResult {
  const target = result.perSectionTarget;
  const all: ResultSong[] = [
    ...result.warmUp.map((s) => ({ ...s })),
    ...result.transition.map((s) => ({ ...s })),
    ...result.peak.map((s) => ({ ...s })),
  ];
  const sorted = sortByIntensity(all);
  const n = sorted.length;

  // Ideal split: lowest `target` → Warm Up, next `target` → Transition,
  // last `target` → Peak. When supply is short we proportionally allocate
  // (~⅓ each) so each section still has the relatively-lowest or
  // relatively-highest songs, and we never silently empty a section.
  const warmCount = Math.min(target, Math.max(1, Math.ceil(n / 3)));
  const peakCount = Math.min(target, Math.max(1, Math.ceil(n / 3)));
  // Guard against overlap when n < warmCount + peakCount (very small sets).
  const warmEnd = Math.min(warmCount, n);
  const peakStart = Math.max(warmEnd, n - peakCount);

  const warmUp = sorted.slice(0, warmEnd);
  const transition = sorted.slice(warmEnd, peakStart);
  const peak = sorted.slice(peakStart);

  const finalShortfall = {
    warmUp: Math.max(0, target - warmUp.length),
    transition: Math.max(0, target - transition.length),
    peak: Math.max(0, target - peak.length),
    total: 0,
  };
  finalShortfall.total = finalShortfall.warmUp + finalShortfall.transition + finalShortfall.peak;

  return {
    ...result,
    warmUp,
    transition,
    peak,
    finalShortfall,
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
