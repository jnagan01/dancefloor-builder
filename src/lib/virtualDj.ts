// VirtualDJ library parsing + matching utilities. All in-browser.
import type { Song } from "./danceFloor";
import { normalizeKey } from "./danceFloor";

export interface VdjTrack {
  filePath: string;
  fileSize?: string;
  artist: string;
  title: string;
  bpm?: string;
  key?: string;
  genre?: string;
  year?: string;
  decade?: string;
  remix?: string;
}

export type MatchStatus =
  | "Matched"
  | "Possible Match"
  | "Multiple Matches"
  | "Missing From Library"
  | "Manually Matched";

export interface SongMatch {
  status: MatchStatus;
  confidence: number; // 0..1
  trackIndex?: number; // index into library array
  alternatives: number[]; // alternative indices
  extraTrackIndices?: number[]; // additional manually-picked tracks exported alongside trackIndex
  excludedFromVdj?: boolean;
}

// --- normalization helpers ---

function normForMatch(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\bfeaturing\b/g, "feat")
    .replace(/\bft\.?\b/g, "feat")
    .replace(/\bfeat\.?\b/g, "feat")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REMIX_RE = /\(([^)]*\b(remix|edit|mix|version|extended|radio|club|dub|acoustic|live|remaster(ed)?)\b[^)]*)\)/i;

function stripRemix(title: string): { base: string; remix?: string } {
  const m = title.match(REMIX_RE);
  if (m) {
    return { base: title.replace(m[0], "").trim(), remix: m[1].trim() };
  }
  return { base: title };
}

// Damerau-Levenshtein-ish distance, normalized.
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const dp: number[] = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[bl];
}

function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const d = editDistance(a, b);
  const m = Math.max(a.length, b.length);
  return 1 - d / m;
}

// --- XML parsing ---

export function parseVdjDatabaseXml(text: string): VdjTrack[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("Invalid VirtualDJ database XML");
  const tracks: VdjTrack[] = [];
  const songNodes = doc.getElementsByTagName("Song");
  for (let i = 0; i < songNodes.length; i++) {
    const node = songNodes[i];
    const filePath = node.getAttribute("FilePath") || node.getAttribute("path") || "";
    if (!filePath) continue;
    const fileSize = node.getAttribute("FileSize") || node.getAttribute("size") || undefined;
    const tags = node.getElementsByTagName("Tags")[0];
    const scan = node.getElementsByTagName("Scan")[0];
    const infos = node.getElementsByTagName("Infos")[0];

    let artist = tags?.getAttribute("Author") || tags?.getAttribute("Artist") || "";
    let title = tags?.getAttribute("Title") || "";
    const genre = tags?.getAttribute("Genre") || undefined;
    const year = tags?.getAttribute("Year") || undefined;
    const bpm = scan?.getAttribute("Bpm") || tags?.getAttribute("Bpm") || undefined;
    const key = scan?.getAttribute("Key") || tags?.getAttribute("Key") || undefined;
    const remixTag = tags?.getAttribute("Remix") || undefined;

    // Fallback: derive from filename
    if (!artist || !title) {
      const fname = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "";
      const dashIdx = fname.indexOf(" - ");
      if (dashIdx > 0) {
        artist = artist || fname.slice(0, dashIdx).trim();
        title = title || fname.slice(dashIdx + 3).trim();
      } else {
        title = title || fname;
      }
    }

    const decade = year && /^\d{4}$/.test(year) ? `${year.slice(0, 3)}0s` : undefined;
    const { remix } = stripRemix(title);

    tracks.push({
      filePath,
      fileSize: fileSize ?? undefined,
      artist,
      title,
      bpm: bpm ?? undefined,
      key: key ?? undefined,
      genre,
      year,
      decade,
      remix: remixTag || remix,
    });
    void infos;
  }
  return tracks;
}

// Build VdjTrack entries from a list of audio files (e.g. one selected folder).
// Filename is parsed as "Artist - Title.ext" when possible; otherwise the whole
// basename becomes the title. Works with browser File objects and any object
// exposing { name, size, webkitRelativePath? }.
const AUDIO_EXT_RE = /\.(mp3|m4a|wav|flac|ogg|aac|aif{1,2}|wma|opus|alac)$/i;
export interface FileLike {
  name: string;
  size?: number;
  webkitRelativePath?: string;
}
export function tracksFromAudioFiles(files: ReadonlyArray<FileLike>): VdjTrack[] {
  const out: VdjTrack[] = [];
  for (const f of files) {
    if (!AUDIO_EXT_RE.test(f.name)) continue;
    const rel = f.webkitRelativePath || f.name;
    const noExt = f.name.replace(/\.[^.]+$/, "");
    let artist = "";
    let title = noExt;
    const parts = noExt.split(/\s+[-–—]\s+/);
    if (parts.length >= 2 && parts[0].trim() && parts.slice(1).join(" - ").trim()) {
      artist = parts[0].trim();
      title = parts.slice(1).join(" - ").trim();
    }
    const { remix } = stripRemix(title);
    out.push({
      filePath: rel,
      fileSize: typeof f.size === "number" ? String(f.size) : undefined,
      artist,
      title,
      remix,
    });
  }
  return out;
}

// --- Indexing & matching ---

export interface VdjLibrary {
  tracks: VdjTrack[];
  // Map normalized artist+title -> indices
  byKey: Map<string, number[]>;
  // Map normalized artist -> indices (for fuzzy search)
  byArtist: Map<string, number[]>;
}

export function buildLibrary(tracks: VdjTrack[]): VdjLibrary {
  const byKey = new Map<string, number[]>();
  const byArtist = new Map<string, number[]>();
  tracks.forEach((t, i) => {
    const { base } = stripRemix(t.title);
    const key = `${normForMatch(t.artist)}|${normForMatch(base)}`;
    const arr = byKey.get(key) || [];
    arr.push(i);
    byKey.set(key, arr);
    const ak = normForMatch(t.artist);
    const ar = byArtist.get(ak) || [];
    ar.push(i);
    byArtist.set(ak, ar);
  });
  return { tracks, byKey, byArtist };
}

export function mergeLibraries(libs: VdjLibrary[]): VdjLibrary {
  const all: VdjTrack[] = [];
  const seenPaths = new Set<string>();
  for (const lib of libs) {
    for (const t of lib.tracks) {
      if (seenPaths.has(t.filePath)) continue;
      seenPaths.add(t.filePath);
      all.push(t);
    }
  }
  return buildLibrary(all);
}

export function matchSong(song: Song, lib: VdjLibrary): SongMatch {
  if (!lib.tracks.length) {
    return { status: "Missing From Library", confidence: 0, alternatives: [] };
  }
  const { base } = stripRemix(song.song);
  const aN = normForMatch(song.artist);
  const sN = normForMatch(base);
  const exactKey = `${aN}|${sN}`;
  const exact = lib.byKey.get(exactKey);
  if (exact && exact.length === 1) {
    return { status: "Matched", confidence: 1, trackIndex: exact[0], alternatives: [] };
  }
  if (exact && exact.length > 1) {
    return {
      status: "Multiple Matches",
      confidence: 0.95,
      trackIndex: exact[0],
      alternatives: exact.slice(1),
    };
  }

  // Fuzzy: try same artist
  const candidates = new Set<number>();
  const sameArtist = lib.byArtist.get(aN);
  if (sameArtist) sameArtist.forEach((i) => candidates.add(i));
  // Also scan artists with high sim
  if (candidates.size < 5) {
    for (const [ak, idxs] of lib.byArtist) {
      if (candidates.size > 20) break;
      if (similarity(ak, aN) >= 0.82) idxs.forEach((i) => candidates.add(i));
    }
  }

  let bestScore = 0;
  let best: number[] = [];
  for (const i of candidates) {
    const t = lib.tracks[i];
    const tBase = stripRemix(t.title).base;
    const titleSim = similarity(normForMatch(tBase), sN);
    const artistSim = similarity(normForMatch(t.artist), aN);
    const score = titleSim * 0.7 + artistSim * 0.3;
    if (score > bestScore + 0.001) {
      bestScore = score;
      best = [i];
    } else if (Math.abs(score - bestScore) < 0.02) {
      best.push(i);
    }
  }

  if (!best.length || bestScore < 0.55) {
    return { status: "Missing From Library", confidence: 0, alternatives: [] };
  }
  if (best.length > 1 && bestScore >= 0.9) {
    return {
      status: "Multiple Matches",
      confidence: bestScore,
      trackIndex: best[0],
      alternatives: best.slice(1),
    };
  }
  if (bestScore >= 0.92) {
    return { status: "Matched", confidence: bestScore, trackIndex: best[0], alternatives: best.slice(1, 5) };
  }
  return {
    status: "Possible Match",
    confidence: bestScore,
    trackIndex: best[0],
    alternatives: best.slice(1, 5),
  };
}

export function searchLibrary(query: string, lib: VdjLibrary, limit = 25): number[] {
  const q = normForMatch(query);
  if (!q) return [];
  const scored: Array<{ i: number; s: number }> = [];
  for (let i = 0; i < lib.tracks.length; i++) {
    const t = lib.tracks[i];
    const hay = `${normForMatch(t.artist)} ${normForMatch(t.title)}`;
    if (hay.includes(q)) {
      scored.push({ i, s: 1 });
      continue;
    }
    const sim = Math.max(
      similarity(normForMatch(t.title), q),
      similarity(normForMatch(t.artist), q),
    );
    if (sim >= 0.6) scored.push({ i, s: sim });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.i);
}

// --- Exports ---

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface ExportSongRef {
  song: Song;
  match?: SongMatch;
}

export function buildVirtualDjXml(items: ExportSongRef[], lib?: VdjLibrary): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<VirtualFolder noDuplicates="yes" singleDrive="no" ordered="yes">');
  let idx = 0;
  for (const item of items) {
    if (item.match?.excludedFromVdj) continue;
    if (item.match?.trackIndex == null || !lib) continue;
    const indices = [item.match.trackIndex, ...(item.match.extraTrackIndices ?? [])];
    for (const ti of indices) {
      const t = lib.tracks[ti];
      if (!t) continue;
      const attrs = [
        `path="${xmlEscape(t.filePath)}"`,
        `size="${xmlEscape(t.fileSize || "")}"`,
        `artist="${xmlEscape(t.artist)}"`,
        `title="${xmlEscape(t.title)}"`,
        `idx="${idx++}"`,
      ];
      lines.push(`  <song ${attrs.join(" ")} />`);
    }
  }
  lines.push("</VirtualFolder>");
  return lines.join("\n");
}

export function buildM3u(items: ExportSongRef[], lib?: VdjLibrary): string {
  const lines: string[] = ["#EXTM3U"];
  for (const item of items) {
    if (item.match?.excludedFromVdj) continue;
    if (item.match?.trackIndex == null || !lib) continue;
    const indices = [item.match.trackIndex, ...(item.match.extraTrackIndices ?? [])];
    for (const ti of indices) {
      const t = lib.tracks[ti];
      if (!t) continue;
      lines.push(`#EXTINF:-1,${t.artist} - ${t.title}`);
      lines.push(t.filePath);
    }
  }
  return lines.join("\n");
}

// --- File System Access helpers ---

export async function pickXmlFiles(): Promise<File[]> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xml";
  input.multiple = true;
  return new Promise((resolve) => {
    input.onchange = () => {
      resolve(input.files ? Array.from(input.files) : []);
    };
    input.click();
  });
}

export async function pickDirectoryFiles(): Promise<File[]> {
  const input = document.createElement("input") as HTMLInputElement & { webkitdirectory: boolean };
  input.type = "file";
  input.webkitdirectory = true;
  input.multiple = true;
  return new Promise((resolve) => {
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      // Filter to xml files only for VirtualDJ folders
      resolve(files);
    };
    input.click();
  });
}

export interface DirHandle {
  // minimal type for File System Access API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getFileHandle(name: string, options?: { create?: boolean }): Promise<any>;
}

export function supportsDirectoryWrite(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

export async function pickDirectoryHandle(): Promise<DirHandle | null> {
  const w = window as unknown as { showDirectoryPicker?: (opts?: { mode?: string }) => Promise<DirHandle> };
  if (!w.showDirectoryPicker) return null;
  try {
    return await w.showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return null;
  }
}

export async function writeFileToDir(dir: DirHandle, name: string, contents: string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

// re-export to satisfy linter
export const _normUtil = { normForMatch, normalizeKey };
