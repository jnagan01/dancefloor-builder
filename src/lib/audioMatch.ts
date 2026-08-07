// Robust local audio file matcher.
//
// Builds a token index over every name variant of each file (filename, plus any
// tag-based artist/title supplied by the caller) and resolves a track to the
// best-scoring file using the shared matching core, rather than returning the
// first bucket hit.
//
// Performance notes:
// - Normalization is memoized in matchCore (bounded cache).
// - Variants are pre-computed once at index build time.
// - Candidate generation is a token-index lookup, so scoring only touches a
//   small slice of the library.
// - resolveAudioFile results are cached per-index via a WeakMap.

import {
  makeSubject,
  scorePair,
  tieBreak,
  buildTokenIndex,
  candidatesFor,
  normalizeText,
  parseTitle,
  FILE_MATCH_FLOOR,
  type MatchSubject,
  type TokenIndex,
} from "./matchCore";

export interface AudioIndex {
  files: File[];
  variantCount: number;
  /** exact basename (lowercased, with extension) */
  byBasename: Map<string, File>;
  /** basename without extension, lowercased */
  byBasenameNoExt: Map<string, File>;
  /** one entry per (file, name variant) */
  entries: Array<{ file: File; subject: MatchSubject; path: string; size: number; weight: number }>;
  tokens: TokenIndex;
}

const AUDIO_EXT_RE = /\.(mp3|m4a|wav|flac|ogg|aac|aif{1,2}|wma|opus|alac)$/i;

/** Kept for backwards compatibility with existing callers/tests. */
export function normalizeForMatch(input: string): string {
  return normalizeText(input);
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function stripExt(name: string): string {
  return name.replace(AUDIO_EXT_RE, "");
}

function splitFileName(noExt: string): { a: string; b: string } | null {
  const parts = noExt.split(/\s+[-–—_]\s+|\s+-\s+/);
  if (parts.length >= 2 && parts[0].trim() && parts.slice(1).join(" - ").trim()) {
    return { a: parts[0].trim(), b: parts.slice(1).join(" - ").trim() };
  }
  return null;
}

export interface ExtraEntry {
  file: File;
  artist?: string;
  title?: string;
}

function filePath(f: File): string {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}

export function buildAudioIndex(rawFiles: File[], extraEntries: ExtraEntry[] = []): AudioIndex {
  const files = rawFiles.filter((f) => AUDIO_EXT_RE.test(f.name));
  const byBasename = new Map<string, File>();
  const byBasenameNoExt = new Map<string, File>();
  const entries: AudioIndex["entries"] = [];

  // weight < 1 marks a speculative variant (e.g. the reversed "Title - Artist"
  // reading of a filename) so it cannot outrank a straightforward match.
  const push = (file: File, artist: string, title: string, weight = 1) => {
    const subject = makeSubject(artist, title);
    if (!subject.title.base && !subject.artist) return;
    entries.push({ file, subject, path: filePath(file), size: file.size || 0, weight });
  };

  for (const f of files) {
    const baseLower = f.name.toLowerCase();
    if (!byBasename.has(baseLower)) byBasename.set(baseLower, f);

    const noExt = stripExt(f.name);
    const noExtLower = noExt.toLowerCase();
    if (!byBasenameNoExt.has(noExtLower)) byBasenameNoExt.set(noExtLower, f);

    const parts = splitFileName(noExt);
    if (parts) {
      // "Artist - Title" and the reversed convention "Title - Artist".
      push(f, parts.a, parts.b);
      push(f, parts.b, parts.a, 0.85);
    } else {
      // Unknown artist: title-only variant.
      push(f, "", noExt);
    }
  }

  // Tag-based variants (e.g. from a VirtualDJ library) for files we already have.
  for (const e of extraEntries) {
    if (!AUDIO_EXT_RE.test(e.file.name)) continue;
    if (!e.artist && !e.title) continue;
    push(e.file, e.artist || "", e.title || stripExt(e.file.name));
  }

  const tokens = buildTokenIndex(
    entries.map((e) => [...e.subject.title.tokens, ...e.subject.artist.split(" ").filter((t) => t.length > 1)]),
  );

  return {
    files,
    variantCount: entries.length,
    byBasename,
    byBasenameNoExt,
    entries,
    tokens,
  };
}

export interface ResolveQuery {
  artist?: string;
  title?: string;
  filePath?: string;
}

export interface AudioResolution {
  file: File;
  score: number;
  /** true when the requested version tag (remix/live/...) matches the file's */
  versionMatch: boolean;
  /** true when the file was found by exact path/filename rather than scoring */
  exact: boolean;
}

const resolveCache = new WeakMap<AudioIndex, Map<string, AudioResolution | null>>();

function cacheKey(q: ResolveQuery): string {
  return `${q.filePath || ""}\u0001${q.artist || ""}\u0001${q.title || ""}`;
}

function rank(idx: AudioIndex, q: ResolveQuery): AudioResolution | undefined {
  const subject = makeSubject(q.artist || "", q.title || "");
  const queryTokens = [
    ...subject.title.tokens,
    ...subject.artist.split(" ").filter((t) => t.length > 1),
  ];
  const cands = candidatesFor(idx.tokens, queryTokens);
  if (!cands.length) return undefined;

  let best:
    | { score: number; versionMatch: boolean; size: number; path: string; file: File }
    | undefined;

  for (const i of cands) {
    const e = idx.entries[i];
    const parts = scorePair(subject, e.subject);
    const cand = {
      score: parts.score * e.weight,
      versionMatch: parts.versionMatch,
      size: e.size,
      path: e.path,
      file: e.file,
    };
    if (!best) {
      best = cand;
      continue;
    }
    if (cand.score > best.score + 0.001) best = cand;
    else if (Math.abs(cand.score - best.score) <= 0.001 && tieBreak(cand, best) < 0) best = cand;
  }

  if (!best || best.score < FILE_MATCH_FLOOR) return undefined;
  return { file: best.file, score: best.score, versionMatch: best.versionMatch, exact: false };
}

function resolveUncached(idx: AudioIndex, q: ResolveQuery): AudioResolution | undefined {
  if (!idx.entries.length && !idx.files.length) return undefined;

  // 1) Exact filename from the original library path.
  if (q.filePath) {
    const base = baseName(q.filePath).toLowerCase();
    const exact = idx.byBasename.get(base);
    if (exact) return { file: exact, score: 1, versionMatch: true, exact: true };
    const noExtHit = idx.byBasenameNoExt.get(stripExt(base));
    if (noExtHit) return { file: noExtHit, score: 1, versionMatch: true, exact: true };
  }

  // 2) Scored match over the token-index candidates.
  const scored = rank(idx, q);
  if (scored) return scored;

  // 3) Last resort: the original path's own name, matched loosely.
  if (q.filePath) {
    const noExt = stripExt(baseName(q.filePath));
    const parsed = parseTitle(noExt);
    if (parsed.base) {
      const alt = rank(idx, { title: noExt });
      if (alt) return alt;
    }
  }

  return undefined;
}

/** Best local file for a track, with confidence. Cached per AudioIndex. */
export function resolveAudioMatch(idx: AudioIndex, q: ResolveQuery): AudioResolution | undefined {
  let cache = resolveCache.get(idx);
  if (!cache) {
    cache = new Map();
    resolveCache.set(idx, cache);
  }
  const key = cacheKey(q);
  const cached = cache.get(key);
  if (cached !== undefined) return cached || undefined;

  const result = resolveUncached(idx, q);
  cache.set(key, result ?? null);
  return result;
}

/** Backwards-compatible helper returning just the file. */
export function resolveAudioFile(idx: AudioIndex, q: ResolveQuery): File | undefined {
  return resolveAudioMatch(idx, q)?.file;
}
