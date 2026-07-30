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
  return (s || "")
    .toLowerCase()
    // Strip parenthetical/bracketed qualifiers: (Radio Edit), [Remastered 2011], {Live}
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    // Drop "feat./ft./featuring/with X" tails
    .replace(/\s+(feat\.?|ft\.?|featuring|with|w\/)\s+.*$/gi, " ")
    // Drop trailing " - Remaster/Remastered/Radio Edit/Extended/Version/Mix/Live/Mono/Stereo/Deluxe/Single/Album Version/Anniversary/Explicit/Clean/Instrumental/Acoustic/Demo/Reissue/Original/<year>"
    .replace(
      /\s*[-–—:]\s*(the\s+)?(\d{2,4}\s+)?(re[- ]?master(ed)?|radio edit|edit|extended( (mix|version|edit))?|version|mix|live|mono|stereo|deluxe|single|album version|anniversary( edition)?|bonus track|explicit|clean|instrumental|acoustic|demo|reissue|original( mix| version)?)(\s+\d{2,4})?\s*$/gi,
      " ",
    )
    // Drop trailing collaborator lists on artist (& X, and X, x X, vs X)
    .replace(/\s+(&|and|x|vs\.?)\s+.*$/gi, " ")
    // Strip diacritics
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // Remove punctuation/symbols
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
  /** Tempo in BPM (from VirtualDJ DB or AI estimate). */
  bpm?: number;
  /** Musical key in Camelot notation (e.g. "8A"). */
  camelot?: string;
  /** Genre string when known. */
  genre?: string;
  /** 4-digit year when known. */
  year?: number;
  /** Short mood label (e.g. "euphoric"). */
  mood?: string;
  /** True when the track has explicit / profane / aggressive lyrics.
   * Biases placement toward Transition/Peak (away from Warm Up). */
  explicit?: boolean;
  /** Where the audio-feature metadata came from. */
  metaSource?: "Online" | "VirtualDJ" | "AI" | "Library" | "Upload" | "Estimated";
  /** Set when the song's natural intensity band differs from the section it
   * was placed in — i.e. it was stretched to keep the ramp continuous. */
  stretched?: boolean;
  /** Natural intensity-based section, used to explain the stretch. */
  naturalSection?: Section;
  /** Set when the same artist+song appears more than once across the result
   * (reused to fill a shortfall). */
  reused?: boolean;
  /** Role inside the peak "wave": a lift track or a recovery breather. */
  waveRole?: "lift" | "breather";
  /** Human-readable explanation of why the song landed in this slot. */
  placementReason?: string;
}

/**
 * Era bias (in intensity units, applied only to bucket assignment — never to
 * the raw intensity we sort/display). Pre-1990 tracks get pulled toward the
 * Warm Up section so older guests hear engaging music in the first hour.
 */
export function eraBias(year?: number): number {
  if (typeof year !== "number" || !Number.isFinite(year)) return 0;
  if (year < 1980) return -2.0; // 60s / 70s
  if (year < 1990) return -1.5; // 80s
  return 0;
}

/**
 * Explicit bias — pushes profane / aggressive tracks toward Transition/Peak.
 * A strong bias but not an absolute block, so if nothing else fits Warm Up
 * a mild explicit track can still land there.
 */
export function explicitBias(explicit?: boolean): number {
  return explicit ? 2.0 : 0;
}

/**
 * Keyword-based fallback for tagging explicit tracks when the AI hasn't
 * flagged them (uploaded lists, library rows). Matches common release
 * markers like "[Explicit]", "(Dirty)", "(Uncensored)".
 */
export function detectExplicitFromTitle(title: string): boolean {
  if (!title) return false;
  return /[\[(]\s*(explicit|dirty|uncensored|nsfw)\s*[\])]/i.test(title);
}

/** Map BPM onto the 1–10 intensity scale (80 BPM ≈ 1, 140 BPM ≈ 10). */
export function tempoScore(bpm?: number): number | undefined {
  if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm <= 0) return undefined;
  // Half-time correction so double-time tags (e.g. 174) don't read as max energy.
  const b = bpm > 165 ? bpm / 2 : bpm;
  return Math.max(1, Math.min(10, ((b - 80) / 60) * 9 + 1));
}

/**
 * Weighted placement score (1–10) used to decide WHERE a track sits in the
 * night. Energy and danceability still dominate, but valence and tempo matter:
 * a 128-BPM melancholy track and a 128-BPM euphoric track do not belong in the
 * same slot. Popularity nudges anthems later so the biggest sing-alongs land
 * closer to peak.
 *
 * Weights sum to 1 so the result shares the same 1–10 scale (and the same
 * section bands) as `intensityOf`. Tracks with only energy+danceability score
 * essentially the same as before, preserving legacy behavior.
 */
export function placementScore(s: {
  energy?: number;
  danceability?: number;
  valence?: number;
  popularity?: number;
  bpm?: number;
}): number {
  const base = intensityOf(s);
  const e = typeof s.energy === "number" ? s.energy : 7;
  const d = typeof s.danceability === "number" ? s.danceability : 6;
  const v = typeof s.valence === "number" ? s.valence : base;
  const t = tempoScore(s.bpm) ?? base;
  const pop = typeof s.popularity === "number" ? s.popularity : 5;
  const blended = e * 0.45 + d * 0.35 + v * 0.12 + t * 0.08;
  return blended + (pop - 5) * 0.06;
}

/**
 * Intensity used for bucketing into Warm Up / Transition / Peak. Combines the
 * weighted placement score with era and explicit-content biases. The raw
 * `intensityOf` value is still what we sort and display; only the section
 * assignment uses this effective value.
 */
export function effectiveIntensityFor(s: {
  energy?: number;
  danceability?: number;
  valence?: number;
  popularity?: number;
  bpm?: number;
  year?: number;
  explicit?: boolean;
}): number {
  return placementScore(s) + eraBias(s.year) + explicitBias(s.explicit);
}

/**
 * Target intensity curve for the whole night: a gentle rise out of warm-up, a
 * mid plateau, then a strong finish. Position is 0-based within the full
 * concatenated set. Returns a 1–10 target the sequencer places songs against.
 */
export function targetCurve(position: number, total: number): number {
  if (total <= 1) return 4.5;
  const p = Math.max(0, Math.min(1, position / (total - 1)));
  const eased = Math.pow(p, 0.85);
  return 4.5 + eased * 5.0; // 4.5 → 9.5
}

/**
 * Peak hours need to breathe: 4 bangers, one crowd sing-along breather, back
 * up. Rearranges an already-ordered peak list so every 5th slot dips to a
 * lower-intensity crowd-pleaser instead of running 30 straight max-energy
 * tracks. Overall trend stays ascending; the dips are bounded and local.
 */
export function applyPeakWave(songs: ResultSong[]): ResultSong[] {
  if (songs.length < 6) return songs.slice();
  const ordered = [...songs];
  // Breathers = the lower-intensity third, preferring the most recognizable.
  const byIntensity = [...ordered].sort((a, b) => intensityOf(a) - intensityOf(b));
  const breatherCount = Math.max(1, Math.floor(ordered.length / 5));
  const pool = byIntensity.slice(0, Math.max(breatherCount, Math.floor(ordered.length / 3)));
  const breathers = [...pool]
    .sort((a, b) => (b.popularity ?? 5) - (a.popularity ?? 5))
    .slice(0, breatherCount)
    .sort((a, b) => intensityOf(a) - intensityOf(b));
  const breatherKeys = new Set(breathers.map((s) => dedupeKey(s.artist, s.song)));
  const bangers = ordered.filter((s) => !breatherKeys.has(dedupeKey(s.artist, s.song)));

  const out: ResultSong[] = [];
  let bi = 0;
  let breatherIdx = 0;
  while (bi < bangers.length) {
    out.push({ ...bangers[bi], waveRole: "lift" });
    bi += 1;
    if (bi % 4 === 0 && breatherIdx < breathers.length && bi < bangers.length) {
      out.push({ ...breathers[breatherIdx], waveRole: "breather" });
      breatherIdx += 1;
    }
  }
  while (breatherIdx < breathers.length) {
    out.push({ ...breathers[breatherIdx], waveRole: "breather" });
    breatherIdx += 1;
  }
  return out;
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
export const SECTION_BUFFER = 2;

type SectionKey = "warmUp" | "transition" | "peak";

const KEY_TO_SECTION: Record<SectionKey, Section> = {
  warmUp: "Warm Up",
  transition: "Transition",
  peak: "Peak",
};

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

function libraryPreferenceScore(lib: LibrarySong, prefs: Preferences): number {
  let score = 0;
  if (prefs.artists.some((a) => a && lib.artist.toLowerCase().includes(a.toLowerCase()))) score += 5;
  if (prefs.genres.some((g) => g && lib.genre.toLowerCase().includes(g.toLowerCase()))) score += 3;
  if (prefs.decades.includes(lib.decade)) score += 2;
  const notesLower = prefs.notes.toLowerCase();
  if (notesLower && (notesLower.includes(lib.genre.toLowerCase()) || notesLower.includes(lib.artist.toLowerCase()))) score += 1;
  return score;
}

function librarySongToResult(lib: LibrarySong, assignedSection: Section, reused = false): ResultSong {
  const naturalSection = sectionForIntensity(intensityOf(lib));
  return {
    artist: lib.artist,
    song: lib.song,
    fromUpload: false,
    energy: lib.energy,
    danceability: lib.danceability,
    genre: lib.genre,
    metaSource: "Library",
    stretched: naturalSection !== assignedSection,
    naturalSection,
    reused,
  };
}

function sectionShortfall(result: GenerationResult): GenerationResult["finalShortfall"] {
  const target = result.perSectionTarget;
  const finalShortfall = {
    warmUp: Math.max(0, target - result.warmUp.length),
    transition: Math.max(0, target - result.transition.length),
    peak: Math.max(0, target - result.peak.length),
    total: 0,
  };
  finalShortfall.total = finalShortfall.warmUp + finalShortfall.transition + finalShortfall.peak;
  return finalShortfall;
}

/**
 * Hard safety net for AI under-fill: after AI has had a chance to add songs,
 * fill every still-short section from the built-in library before export.
 *
 * The function first uses unique library songs, preferring songs whose natural
 * intensity matches the short section. If a long event needs more songs than
 * the built-in library contains, it cycles unblocked library songs and marks
 * those repeats as reused so the exported counts still meet the buffered target.
 */
export function topUpSectionsFromLibrary(result: GenerationResult, prefs: Preferences): GenerationResult {
  const next: GenerationResult = {
    ...result,
    warmUp: result.warmUp.map((s) => ({ ...s })),
    transition: result.transition.map((s) => ({ ...s })),
    peak: result.peak.map((s) => ({ ...s })),
  };
  const allSeen = new Set(
    ([...next.warmUp, ...next.transition, ...next.peak]).map((s) => dedupeKey(s.artist, s.song)),
  );
  const unblockedLibrary = SONG_LIBRARY.filter((l) => !isBlocked(l.artist, l.song, prefs.doNotPlay));

  for (const key of ["warmUp", "transition", "peak"] as SectionKey[]) {
    const assignedSection = KEY_TO_SECTION[key];
    const list = next[key];
    const ranked = unblockedLibrary
      .map((lib, index) => {
        const naturalSection = sectionForIntensity(intensityOf(lib));
        const sectionFit = naturalSection === assignedSection ? 1000 : 0;
        const intensityDistance = Math.abs(intensityOf(lib) - (assignedSection === "Warm Up" ? 5.5 : assignedSection === "Transition" ? 7.25 : 9));
        return {
          lib,
          index,
          rank: sectionFit + libraryPreferenceScore(lib, prefs) * 10 - intensityDistance,
        };
      })
      .sort((a, b) => b.rank - a.rank || a.index - b.index);
    if (!ranked.length) continue;

    let reuseIndex = 0;
    while (list.length < next.perSectionTarget) {
      const uniqueCandidate = ranked.find(({ lib }) => !allSeen.has(dedupeKey(lib.artist, lib.song)));
      if (uniqueCandidate) {
        const keyForSong = dedupeKey(uniqueCandidate.lib.artist, uniqueCandidate.lib.song);
        allSeen.add(keyForSong);
        list.push(librarySongToResult(uniqueCandidate.lib, assignedSection));
        continue;
      }

      const reusedCandidate = ranked[reuseIndex % ranked.length].lib;
      reuseIndex += 1;
      list.push(librarySongToResult(reusedCandidate, assignedSection, true));
    }
    next[key] = sortByIntensity(list);
  }

  next.finalShortfall = sectionShortfall(next);
  return next;
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

    // Score library candidates by intensity and pick the section they belong
    // in based on the same band rule used for uploads.
    const candidates = SONG_LIBRARY
      .filter((l) => !seen.has(dedupeKey(l.artist, l.song)))
      .filter((l) => !isBlocked(l.artist, l.song, prefs.doNotPlay))
      .map((l) => ({ lib: l, score: libraryPreferenceScore(l, prefs), section: sectionForIntensity(intensityOf(l)) }))
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
 * Apply balanced variety rules to an ordered list of songs.
 *
 * Soft constraints (penalties, not hard removals — short libraries still fill):
 * - Cap any one artist at `artistCap` total (default 2).
 * - Avoid back-to-back same artist.
 * - Avoid near-duplicate titles (normalized title match).
 * - Prefer small BPM jumps (≤8%) and adjacent Camelot keys.
 *
 * Returns a new list, same length. Songs flagged by the artist cap get a
 * higher index assignment so the ramp still ends with the highest-energy
 * track. We use a greedy insertion pass: for each "next" slot we pick the
 * remaining song that best satisfies the constraints against the previous
 * accepted song, breaking ties by intensity ascending.
 */
export function applyVarietyReranker(
  songs: ResultSong[],
  opts: { artistCap?: number } = {},
): ResultSong[] {
  const artistCap = opts.artistCap ?? 2;
  if (songs.length <= 1) return songs.slice();

  // Step 1: enforce the artist cap by demoting overflow tracks toward the
  // end of the list so they only land when truly needed.
  const counts = new Map<string, number>();
  const allowed: ResultSong[] = [];
  const overflow: ResultSong[] = [];
  for (const s of [...songs].sort((a, b) => intensityOf(a) - intensityOf(b))) {
    const ak = normalizeKey(s.artist);
    const c = counts.get(ak) ?? 0;
    if (c < artistCap) {
      counts.set(ak, c + 1);
      allowed.push(s);
    } else {
      overflow.push(s);
    }
  }

  // Step 2: drop near-identical duplicates (same normalized artist + title).
  // Previously duplicates were pushed to overflow and re-appended at the end,
  // which caused the same song to appear twice inside the same section.
  const seenTitle = new Set<string>();
  const unique: ResultSong[] = [];
  for (const s of allowed) {
    const k = `${normalizeKey(s.artist)}|${normalizeKey(s.song)}`;
    if (seenTitle.has(k)) continue;
    seenTitle.add(k);
    unique.push(s);
  }


  // Step 3: greedy sequencing — pick the next song that minimizes transition
  // cost against the previous accepted song while staying close to the
  // intensity ramp position.
  const remaining = unique.slice();
  const result: ResultSong[] = [];
  // Seed with the lowest-intensity track.
  remaining.sort((a, b) => intensityOf(a) - intensityOf(b));
  let prev = remaining.shift();
  if (prev) result.push(prev);

  while (remaining.length) {
    let bestIdx = 0;
    let bestCost = Infinity;
    const targetIntensity =
      result.length === 0 ? 0 : intensityOf(result[result.length - 1]);
    // Rolling windows: last 4 for genre, last 6 for decade.
    const recentGenres = result.slice(-4).map((s) => genreKey(s));
    const recentDecades = result.slice(-6).map((s) => decadeKey(s));
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const cost = transitionCost(prev!, cand, targetIntensity, recentGenres, recentDecades);
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }
    prev = remaining.splice(bestIdx, 1)[0];
    result.push(prev);
  }

  // Append overflow at the end in ascending intensity to preserve the ramp.
  overflow.sort((a, b) => intensityOf(a) - intensityOf(b));
  result.push(...overflow);
  return result;
}

/** Coarse genre bucket used by the rolling-window variety rules. */
function genreKey(s: ResultSong): string {
  const g = (s.genre ?? "").toLowerCase();
  if (!g) return "";
  if (/hip hop|rap|trap/.test(g)) return "hiphop";
  if (/edm|house|dance|techno|electro/.test(g)) return "edm";
  if (/r&b|rnb|soul|motown|funk/.test(g)) return "soul";
  if (/country/.test(g)) return "country";
  if (/rock|metal|punk/.test(g)) return "rock";
  if (/latin|reggaeton|salsa|afro/.test(g)) return "latin";
  if (/disco/.test(g)) return "disco";
  if (/pop/.test(g)) return "pop";
  return g.slice(0, 12);
}

/** Decade bucket ("1980s") from the year, when known. */
function decadeKey(s: ResultSong): string {
  if (typeof s.year !== "number" || !Number.isFinite(s.year)) return "";
  return `${Math.floor(s.year / 10) * 10}s`;
}

/**
 * Cost of transitioning from `prev` to `cand`. Lower = smoother.
 * Combines: same-artist penalty, BPM jump, Camelot wheel distance, rolling
 * genre/decade variety windows, and deviation from the ramp's current
 * intensity (so the order stays monotonic).
 */
function transitionCost(
  prev: ResultSong,
  cand: ResultSong,
  baseIntensity: number,
  recentGenres: string[] = [],
  recentDecades: string[] = [],
): number {
  let cost = 0;
  // Back-to-back same artist: heavy penalty.
  if (normalizeKey(prev.artist) === normalizeKey(cand.artist)) cost += 100;
  // BPM jump (require both to count).
  if (prev.bpm && cand.bpm) {
    const diff = Math.abs(prev.bpm - cand.bpm) / Math.max(prev.bpm, cand.bpm);
    if (diff > 0.08) cost += 20 * (diff / 0.08);
  }
  // Camelot key distance (require both).
  if (prev.camelot && cand.camelot) {
    // Lightweight inline wheel distance to avoid a circular import.
    const am = prev.camelot.match(/^(\d{1,2})([AB])$/);
    const bm = cand.camelot.match(/^(\d{1,2})([AB])$/);
    if (am && bm) {
      const an = parseInt(am[1], 10);
      const bn = parseInt(bm[1], 10);
      const ring = Math.min(Math.abs(an - bn), 12 - Math.abs(an - bn));
      const sameRow = am[2] === bm[2];
      const wheelDist = sameRow ? ring : an === bn ? 1 : ring + 1;
      if (wheelDist > 1) cost += 5 * (wheelDist - 1);
    }
  }
  // Rolling variety windows: at most 2 of a genre per 4, 3 of a decade per 6.
  const gk = genreKey(cand);
  if (gk) {
    const n = recentGenres.filter((g) => g === gk).length;
    if (n >= 2) cost += 30 * (n - 1);
  }
  const dk = decadeKey(cand);
  if (dk) {
    const n = recentDecades.filter((d) => d === dk).length;
    if (n >= 3) cost += 15 * (n - 2);
  }
  // Stay near the ramp — penalize going backward in intensity.
  const candI = intensityOf(cand);
  if (candI < baseIntensity) cost += (baseIntensity - candI) * 8;
  else cost += (candI - baseIntensity) * 1; // small forward push
  return cost;
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
  // Cross-section dedupe: if the same artist+song landed in more than one
  // list (e.g. from the shortfall fallback or an AI retry race), keep only
  // the first occurrence before we re-bucket by intensity.
  const seenAcross = new Set<string>();
  const deduped: ResultSong[] = [];
  for (const s of all) {
    const k = dedupeKey(s.artist, s.song);
    if (!k || seenAcross.has(k)) continue;
    seenAcross.add(k);
    deduped.push(s);
  }
  // Bucket by *effective* intensity so pre-1990 songs bias into Warm Up and
  // explicit songs bias into Transition/Peak, while we still sort/display the
  // raw intensity ramp. Songs without year/explicit metadata get effective ==
  // raw, preserving legacy behavior.
  const sorted = [...deduped].sort((a, b) => {
    const ai = effectiveIntensityFor(a);
    const bi = effectiveIntensityFor(b);
    if (ai !== bi) return ai - bi;
    return intensityOf(a) - intensityOf(b);
  });
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

  const warmUpRaw = sorted.slice(0, warmEnd);
  let transitionRaw = sorted.slice(warmEnd, peakStart);
  const peakRaw = sorted.slice(peakStart);

  // Cap transition at perSectionTarget. Without this, when AI/library
  // over-supply mid-intensity songs the middle slice grows unbounded while
  // warm/peak stay capped at `target`, leaving transition much longer than
  // the other two sections.
  //
  // IMPORTANT: uploaded songs are never dropped. Trimming removes only
  // AI/library filler (fromUpload !== true), taken symmetrically from both
  // ends so what remains stays centered on the true transition band. If the
  // uploads alone exceed the target, the section is allowed to run long
  // rather than losing the user's own tracks.
  if (transitionRaw.length > target) {
    const excess = transitionRaw.length - target;
    const fillerIdx = transitionRaw
      .map((s, i) => (s.fromUpload ? -1 : i))
      .filter((i) => i >= 0);
    const dropFront = Math.floor(excess / 2);
    const dropBack = excess - dropFront;
    const toDrop = new Set<number>([
      ...fillerIdx.slice(0, Math.min(dropFront, fillerIdx.length)),
      ...fillerIdx.slice(Math.max(0, fillerIdx.length - dropBack)),
    ]);
    transitionRaw = transitionRaw.filter((_, i) => !toDrop.has(i));
  }


  // Tag songs whose natural intensity band does not match the section they
  // ended up in — these were "stretched" to keep the ramp continuous.
  const tag = (list: ResultSong[], assigned: Section): ResultSong[] =>
    list.map((s) => {
      const natural = sectionForIntensity(intensityOf(s));
      return natural === assigned
        ? { ...s, stretched: false, naturalSection: natural }
        : { ...s, stretched: true, naturalSection: natural };
    });

  // Apply variety re-ranker per section (artist cap + smooth BPM/key transitions).
  const warmUp = applyVarietyReranker(tag(warmUpRaw, "Warm Up"));
  const transition = applyVarietyReranker(tag(transitionRaw, "Transition"));
  const peak = applyVarietyReranker(tag(peakRaw, "Peak"));

  // Flag duplicates (same artist+song appearing in more than one slot) as
  // reused — the ramp borrowed a song to plug a shortfall.
  const counts = new Map<string, number>();
  [...warmUp, ...transition, ...peak].forEach((s) => {
    const k = dedupeKey(s.artist, s.song);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const markReused = (list: ResultSong[]): ResultSong[] =>
    list.map((s) => ((counts.get(dedupeKey(s.artist, s.song)) ?? 0) > 1 ? { ...s, reused: true } : s));

  const finalShortfall = {
    warmUp: Math.max(0, target - warmUp.length),
    transition: Math.max(0, target - transition.length),
    peak: Math.max(0, target - peak.length),
    total: 0,
  };
  finalShortfall.total = finalShortfall.warmUp + finalShortfall.transition + finalShortfall.peak;

  return {
    ...result,
    warmUp: markReused(warmUp),
    transition: markReused(transition),
    peak: markReused(peak),
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
