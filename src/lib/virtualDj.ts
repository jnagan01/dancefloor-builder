// VirtualDJ library parsing + matching utilities. All in-browser.
import type { Song } from "./danceFloor";
import { normalizeKey } from "./danceFloor";
import {
  makeSubject,
  scorePair,
  tieBreak,
  buildTokenIndex,
  candidatesFor,
  normalizeText,
  tokenize,
  similarity,
  STRONG_MATCH,
  POSSIBLE_MATCH,
  type MatchSubject,
  type TokenIndex,
} from "./matchCore";

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
  playCount?: number;
  lastPlayTime?: string;
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


// --- XML parsing ---

/** Case-insensitive attribute lookup (VirtualDJ casing varies across versions). */
function attr(el: Element | null | undefined, ...names: string[]): string | undefined {
  if (!el) return undefined;
  for (const n of names) {
    const direct = el.getAttribute(n);
    if (direct != null && direct !== "") return direct;
  }
  const wanted = names.map((n) => n.toLowerCase());
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (wanted.includes(a.name.toLowerCase()) && a.value) return a.value;
  }
  return undefined;
}

function childByName(el: Element, name: string): Element | undefined {
  const lower = name.toLowerCase();
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i];
    if (c.tagName.toLowerCase() === lower) return c;
  }
  return undefined;
}

function trackFromNode(node: Element): VdjTrack | null {
  const filePath = attr(node, "FilePath", "path", "Path", "FilePathName") || "";
  if (!filePath) return null;
  const fileSize = attr(node, "FileSize", "size");
  const tags = childByName(node, "Tags");
  const scan = childByName(node, "Scan");

  let artist = attr(tags, "Author", "Artist") || "";
  let title = attr(tags, "Title") || "";
  const genre = attr(tags, "Genre");
  const year = attr(tags, "Year");
  const bpm = attr(scan, "Bpm") || attr(tags, "Bpm");
  const key = attr(scan, "Key") || attr(tags, "Key");
  const remixTag = attr(tags, "Remix");
  const infos = childByName(node, "Infos");
  const rawPlays = attr(infos, "PlayCount", "Playcount", "playcount");
  const playCount = rawPlays && /^\d+$/.test(rawPlays.trim()) ? Number(rawPlays.trim()) : undefined;
  const lastPlayTime = attr(infos, "LastPlayTime", "Lastplaytime");

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
  if (!title) return null;

  const decade = year && /^\d{4}$/.test(year) ? `${year.slice(0, 3)}0s` : undefined;
  const { remix } = stripRemix(title);

  return {
    filePath,
    fileSize,
    artist,
    title,
    bpm,
    key,
    genre,
    year,
    decade,
    remix: remixTag || remix,
  };
}

export function parseVdjDatabaseXml(text: string): VdjTrack[] {
  // Strip BOM / leading whitespace; some VDJ exports include both.
  const cleaned = text.replace(/^\uFEFF/, "").trimStart();
  const doc = new DOMParser().parseFromString(cleaned, "application/xml");
  const err = doc.querySelector("parsererror");
  const tracks: VdjTrack[] = [];

  if (!err) {
    // Accept <Song>, <song>, <Track> nodes anywhere in the document.
    const all = doc.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
      const node = all[i];
      const tag = node.tagName.toLowerCase();
      if (tag !== "song" && tag !== "track") continue;
      const t = trackFromNode(node);
      if (t) tracks.push(t);
    }
    if (tracks.length) return tracks;
  }

  // Fallback: regex scan for FilePath attributes when the XML is malformed
  // (unescaped & in paths is common in older VirtualDJ databases).
  const re = /<\s*(?:Song|Track)\b[^>]*?\b(?:FilePath|path)\s*=\s*"([^"]+)"([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const filePath = m[1];
    const rest = m[2] || "";
    const size = /\bFileSize\s*=\s*"([^"]*)"/i.exec(rest)?.[1];
    const fname = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "";
    const dashIdx = fname.indexOf(" - ");
    const artist = dashIdx > 0 ? fname.slice(0, dashIdx).trim() : "";
    const title = dashIdx > 0 ? fname.slice(dashIdx + 3).trim() : fname;
    if (!title) continue;
    const { remix } = stripRemix(title);
    tracks.push({ filePath, fileSize: size, artist, title, remix });
  }

  if (!tracks.length && err) throw new Error("Invalid VirtualDJ database XML");
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
  // Shared-core subjects + token inverted index for candidate generation.
  subjects: MatchSubject[];
  tokens: TokenIndex;
}

function subjectTokens(s: MatchSubject): string[] {
  return [...s.title.tokens, ...s.artist.split(" ").filter((t) => t.length > 1)];
}

export function buildLibrary(tracks: VdjTrack[]): VdjLibrary {
  const byKey = new Map<string, number[]>();
  const byArtist = new Map<string, number[]>();
  const subjects: MatchSubject[] = [];
  tracks.forEach((t, i) => {
    const subject = makeSubject(t.artist, t.title);
    subjects.push(subject);
    const key = `${subject.artist}|${subject.title.base}`;
    const arr = byKey.get(key) || [];
    arr.push(i);
    byKey.set(key, arr);
    const ar = byArtist.get(subject.artist) || [];
    ar.push(i);
    byArtist.set(subject.artist, ar);
  });
  return { tracks, byKey, byArtist, subjects, tokens: buildTokenIndex(subjects.map(subjectTokens)) };
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

interface Ranked {
  index: number;
  score: number;
  versionMatch: boolean;
  size: number;
  path: string;
}

function rankLibrary(subject: MatchSubject, lib: VdjLibrary, limit = 8): Ranked[] {
  const cands = candidatesFor(lib.tokens, subjectTokens(subject));
  const out: Ranked[] = [];
  for (const i of cands) {
    const parts = scorePair(subject, lib.subjects[i]);
    if (parts.score < 0.4) continue;
    const t = lib.tracks[i];
    out.push({
      index: i,
      score: parts.score,
      versionMatch: parts.versionMatch,
      size: Number(t.fileSize) || 0,
      path: t.filePath,
    });
  }
  out.sort((a, b) => (Math.abs(a.score - b.score) > 0.001 ? b.score - a.score : tieBreak(a, b)));
  return out.slice(0, limit);
}

export function matchSong(song: Song, lib: VdjLibrary): SongMatch {
  if (!lib.tracks.length) {
    return { status: "Missing From Library", confidence: 0, alternatives: [] };
  }
  const subject = makeSubject(song.artist, song.song);
  const ranked = rankLibrary(subject, lib);
  if (!ranked.length || ranked[0].score < POSSIBLE_MATCH) {
    return { status: "Missing From Library", confidence: 0, alternatives: [] };
  }

  const best = ranked[0];
  const alternatives = ranked.slice(1, 6).map((r) => r.index);
  const runnerUp = ranked[1];
  // Ambiguous when the runner-up is essentially as good as the winner.
  const ambiguous = Boolean(runnerUp && best.score - runnerUp.score < 0.02);

  if (ambiguous && best.score >= POSSIBLE_MATCH) {
    return {
      status: "Multiple Matches",
      confidence: best.score,
      trackIndex: best.index,
      alternatives,
    };
  }
  if (best.score >= STRONG_MATCH) {
    return { status: "Matched", confidence: best.score, trackIndex: best.index, alternatives };
  }
  return {
    status: "Possible Match",
    confidence: best.score,
    trackIndex: best.index,
    alternatives,
  };
}

export function searchLibrary(query: string, lib: VdjLibrary, limit = 25): number[] {
  const q = normalizeText(query);
  if (!q) return [];
  const subject = makeSubject("", query);
  const tokens = tokenize(q);

  // Token-index candidates first; fall back to a bounded substring scan when
  // the query is a fragment that tokenizes to nothing useful.
  let cands = candidatesFor(lib.tokens, tokens, Math.max(limit * 20, 300));
  if (!cands.length) {
    cands = [];
    for (let i = 0; i < lib.subjects.length && cands.length < limit * 20; i++) {
      const s = lib.subjects[i];
      if (s.title.base.includes(q) || s.artist.includes(q)) cands.push(i);
    }
  }

  const scored: Array<{ i: number; s: number }> = [];
  for (const i of cands) {
    const s = lib.subjects[i];
    const hay = `${s.artist} ${s.title.base}`;
    if (hay.includes(q)) {
      scored.push({ i, s: 1 });
      continue;
    }
    const parts = scorePair(subject, s);
    const sim = Math.max(parts.score, similarity(s.artist, q));
    if (sim >= 0.55) scored.push({ i, s: sim });
  }
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
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

/**
 * Opens the folder picker. Returns null only when the user cancels.
 * Any other failure (blocked system folder, permission denied) throws an
 * Error with a friendly message so the UI can explain what happened.
 */
export async function pickDirectoryHandle(): Promise<DirHandle | null> {
  const w = window as unknown as { showDirectoryPicker?: (opts?: { mode?: string; id?: string }) => Promise<DirHandle> };
  if (!w.showDirectoryPicker) return null;
  try {
    return await w.showDirectoryPicker({ mode: "readwrite", id: "vdj-export" });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e?.name === "AbortError" && !/system|blocked|sensitive/i.test(e.message ?? "")) return null;
    if (e?.name === "SecurityError" || /system|blocked|sensitive/i.test(e?.message ?? "")) {
      throw new Error(
        "That folder is protected by macOS and can't be used. Pick a folder inside it instead — e.g. Documents › VirtualDJ › MyLists.",
      );
    }
    if (e?.name === "NotAllowedError") {
      throw new Error("Permission to write to that folder was denied. Try again and choose “Allow” / “Edit files”.");
    }
    throw new Error(`Couldn't open that folder${e?.message ? ` (${e.message})` : ""}.`);
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
