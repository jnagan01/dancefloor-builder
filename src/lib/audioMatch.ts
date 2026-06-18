// Robust local audio file matcher.
// Builds multiple normalized indexes over a set of files and resolves a track
// (artist + title + optional original filePath) to the best matching File.

export interface AudioIndex {
  files: File[];
  // Several lookups, tried in order of strictness.
  byBasename: Map<string, File>;             // exact basename (lowercased, with ext)
  byBasenameNoExt: Map<string, File>;        // basename without extension, raw lower
  byNormBasename: Map<string, File[]>;       // heavily normalized basename, no ext
  byArtistTitle: Map<string, File[]>;        // norm(artist) + " " + norm(title)
  byTitleOnly: Map<string, File[]>;          // norm(title)
}

const AUDIO_EXT_RE = /\.(mp3|m4a|wav|flac|ogg|aac|aif{1,2}|wma|opus|alac)$/i;

/**
 * Aggressive normalization for matching purposes only:
 * - lowercases
 * - strips diacritics
 * - removes "feat./ft./featuring ..." segments
 * - removes content inside (), [], {}
 * - removes common edition suffixes (remastered, radio edit, etc.)
 * - removes all non-alphanumeric chars
 */
export function normalizeForMatch(input: string): string {
  if (!input) return "";
  let s = input.toLowerCase();
  // strip diacritics
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // & → and
  s = s.replace(/&/g, " and ");
  // remove featuring artist segments anywhere
  s = s.replace(/\b(feat\.?|ft\.?|featuring|with)\s+[^\-\[\]()_]+/g, " ");
  // strip content in brackets/parens (often "Remastered 2011", "Radio Edit", etc.)
  s = s.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, " ");
  // common noise words
  s = s.replace(/\b(remaster(ed)?|radio edit|extended mix|club mix|original mix|single version|album version|explicit|clean|live|bonus track|hd|hq|official(\s+(audio|video|music\s+video))?|lyrics?|with lyrics)\b/g, " ");
  // common separators → space
  s = s.replace(/[_\-–—]+/g, " ");
  // drop anything non-alphanumeric
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  // collapse spaces
  s = s.replace(/\s+/g, " ").trim();
  // remove leading track numbers like "07 " or "1-04 "
  s = s.replace(/^\d{1,3}\s+/, "").replace(/^\d{1,3}\s*\d{0,3}\s+/, "");
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

/**
 * Parse "Artist - Title" or "Title - Artist" patterns from a filename (without extension).
 * Returns both parts when a single separator is found.
 */
function splitFileName(noExt: string): { a: string; b: string } | null {
  // common separators: " - ", " – ", " — ", " _ ", "-"
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
  };
  for (const f of files) {
    const base = f.name;
    const baseLower = base.toLowerCase();
    idx.byBasename.set(baseLower, f);

    const noExt = stripExt(base);
    idx.byBasenameNoExt.set(noExt.toLowerCase(), f);

    const norm = normalizeForMatch(noExt);
    if (norm) pushMulti(idx.byNormBasename, norm, f);

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
    } else {
      const n = normalizeForMatch(noExt);
      if (n) pushMulti(idx.byTitleOnly, n, f);
    }
  }
  return idx;
}

export interface ResolveQuery {
  artist?: string;
  title?: string;
  filePath?: string;
}

/**
 * Try increasingly loose match strategies. Returns the first match, or undefined.
 */
export function resolveAudioFile(idx: AudioIndex, q: ResolveQuery): File | undefined {
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

    // Substring scan over normalized basenames as a last resort
    for (const [key, arr] of idx.byNormBasename) {
      if (key.includes(a) && key.includes(t)) return arr[0];
    }
  }

  // 3) Title-only fallback
  if (t) {
    const hit = idx.byTitleOnly.get(t);
    if (hit && hit.length === 1) return hit[0];
    // If multiple title-only hits, only return when artist also appears
    if (hit && hit.length > 1 && a) {
      const filtered = hit.filter((f) => normalizeForMatch(stripExt(f.name)).includes(a));
      if (filtered.length) return filtered[0];
    }
  }

  return undefined;
}
