// Robust local audio file matcher.
// Builds multiple normalized indexes over a set of files and resolves a track
// (artist + title + optional original filePath) to the best matching File.
//
// Performance notes:
// - normalizeForMatch is memoized via a module-level cache (bounded).
// - buildAudioIndex pre-computes every normalized variant per file once, so
//   resolveAudioFile only ever does O(1) Map lookups (plus an optional
//   substring scan over a flat array, not Map.entries iteration).
// - resolveAudioFile results are cached per-index via a WeakMap keyed by the
//   AudioIndex instance, so repeat lookups for the same track are O(1).

export interface AudioIndex {
  files: File[];
  variantCount: number;
  // Several lookups, tried in order of strictness.
  byBasename: Map<string, File>;             // exact basename (lowercased, with ext)
  byBasenameNoExt: Map<string, File>;        // basename without extension, raw lower
  byNormBasename: Map<string, File[]>;       // heavily normalized basename, no ext
  byArtistTitle: Map<string, File[]>;        // norm(artist) + " " + norm(title)
  byTitleOnly: Map<string, File[]>;          // norm(title)
  // Flat list of (normalizedBasename, file) for fast substring scans.
  normBasenameList: Array<{ key: string; file: File }>;
}

const AUDIO_EXT_RE = /\.(mp3|m4a|wav|flac|ogg|aac|aif{1,2}|wma|opus|alac)$/i;

// --- Memoized normalization ---------------------------------------------------

const NORM_CACHE_LIMIT = 5000;
const normCache = new Map<string, string>();

/**
 * Aggressive normalization for matching purposes only. Memoized.
 */
export function normalizeForMatch(input: string): string {
  if (!input) return "";
  const cached = normCache.get(input);
  if (cached !== undefined) return cached;

  let s = input.toLowerCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/&/g, " and ");
  s = s.replace(/\b(feat\.?|ft\.?|featuring|with)\s+[^\-\[\]()_]+/g, " ");
  s = s.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, " ");
  s = s.replace(/\b(remaster(ed)?|radio edit|extended mix|club mix|original mix|single version|album version|explicit|clean|live|bonus track|hd|hq|official(\s+(audio|video|music\s+video))?|lyrics?|with lyrics)\b/g, " ");
  s = s.replace(/[_\-–—]+/g, " ");
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\d{1,3}\s+/, "").replace(/^\d{1,3}\s*\d{0,3}\s+/, "");

  if (normCache.size >= NORM_CACHE_LIMIT) {
    // Drop oldest entry (Map preserves insertion order).
    const firstKey = normCache.keys().next().value;
    if (firstKey !== undefined) normCache.delete(firstKey);
  }
  normCache.set(input, s);
  return s;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function stripExt(name: string): string {
  return name.replace(AUDIO_EXT_RE, "");
}

function pushMulti<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function splitFileName(noExt: string): { a: string; b: string } | null {
  const parts = noExt.split(/\s+[-–—_]\s+|\s+-\s+/);
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return { a: parts[0].trim(), b: parts[1].trim() };
  }
  return null;
}

export function buildAudioIndex(rawFiles: File[]): AudioIndex {
  const files = rawFiles.filter((f) => AUDIO_EXT_RE.test(f.name));
  const idx: AudioIndex = {
    files,
    byBasename: new Map(),
    byBasenameNoExt: new Map(),
    byNormBasename: new Map(),
    byArtistTitle: new Map(),
    byTitleOnly: new Map(),
    normBasenameList: [],
  };
  for (const f of files) {
    const base = f.name;
    const baseLower = base.toLowerCase();
    idx.byBasename.set(baseLower, f);

    const noExt = stripExt(base);
    const noExtLower = noExt.toLowerCase();
    idx.byBasenameNoExt.set(noExtLower, f);

    const norm = normalizeForMatch(noExt);
    if (norm) {
      pushMulti(idx.byNormBasename, norm, f);
      idx.normBasenameList.push({ key: norm, file: f });
    }

    const parts = splitFileName(noExt);
    if (parts) {
      const na = normalizeForMatch(parts.a);
      const nb = normalizeForMatch(parts.b);
      if (na && nb) {
        pushMulti(idx.byArtistTitle, `${na} ${nb}`, f);
        pushMulti(idx.byArtistTitle, `${nb} ${na}`, f);
        pushMulti(idx.byTitleOnly, nb, f);
        pushMulti(idx.byTitleOnly, na, f);
      }
    } else if (norm) {
      pushMulti(idx.byTitleOnly, norm, f);
    }
  }
  return idx;
}

export interface ResolveQuery {
  artist?: string;
  title?: string;
  filePath?: string;
}

// Per-index resolution cache. Cleared automatically when the index is GC'd.
const resolveCache = new WeakMap<AudioIndex, Map<string, File | null>>();

function cacheKey(q: ResolveQuery): string {
  return `${q.filePath || ""}\u0001${q.artist || ""}\u0001${q.title || ""}`;
}

function resolveUncached(idx: AudioIndex, q: ResolveQuery): File | undefined {
  if (!idx.files.length) return undefined;

  // 1) Exact basename from the original VirtualDJ filePath
  if (q.filePath) {
    const base = baseName(q.filePath).toLowerCase();
    const exact = idx.byBasename.get(base);
    if (exact) return exact;

    const noExt = stripExt(base);
    const noExtHit = idx.byBasenameNoExt.get(noExt);
    if (noExtHit) return noExtHit;

    const norm = normalizeForMatch(noExt);
    const normHits = norm ? idx.byNormBasename.get(norm) : undefined;
    if (normHits && normHits.length) return normHits[0];
  }

  // 2) Artist + Title combination
  const a = normalizeForMatch(q.artist || "");
  const t = normalizeForMatch(q.title || "");

  if (a && t) {
    const k1 = `${a} ${t}`;
    const k2 = `${t} ${a}`;
    const hit =
      idx.byArtistTitle.get(k1) ||
      idx.byArtistTitle.get(k2) ||
      idx.byNormBasename.get(k1) ||
      idx.byNormBasename.get(k2);
    if (hit && hit.length) return hit[0];

    // Substring scan over the flat pre-computed list.
    for (let i = 0; i < idx.normBasenameList.length; i++) {
      const { key, file } = idx.normBasenameList[i];
      if (key.indexOf(a) !== -1 && key.indexOf(t) !== -1) return file;
    }
  }

  // 3) Title-only fallback
  if (t) {
    const hit = idx.byTitleOnly.get(t);
    if (hit && hit.length === 1) return hit[0];
    if (hit && hit.length > 1 && a) {
      for (let i = 0; i < hit.length; i++) {
        const f = hit[i];
        if (normalizeForMatch(stripExt(f.name)).includes(a)) return f;
      }
    }
  }

  return undefined;
}

/**
 * Try increasingly loose match strategies. Cached per AudioIndex.
 */
export function resolveAudioFile(idx: AudioIndex, q: ResolveQuery): File | undefined {
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
