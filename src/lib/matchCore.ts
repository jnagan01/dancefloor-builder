// Shared matching core used by both the local-file resolver (audioMatch.ts)
// and the library matcher (virtualDj.ts).
//
// Goals:
// - One normalizer, so a song that matches in one place matches in the other.
// - Version tags (remix / live / edit / ...) are preserved as a separate field
//   instead of being deleted, so an original is never silently swapped for a
//   remix.
// - Candidate generation via a token inverted index (title tokens included),
//   not artist-only lookups.
// - Deterministic ranking with explicit tie-breakers.

// --- normalization ------------------------------------------------------------

const NORM_CACHE_LIMIT = 8000;
const normCache = new Map<string, string>();

const NOISE_RE =
  /\b(remaster(ed)?|remastered\s+\d{4}|bonus\s+track|hd|hq|official(\s+(audio|video|music\s+video))?|lyrics?|with\s+lyrics|explicit|clean|album\s+version|single\s+version|stereo|mono)\b/g;

// DJ record-pool / download-site tags that pollute file names and tags.
const DJ_POOL_RE =
  /\b(dms|bpm\s*supreme|djcity|dj\s*city|digital\s*dj\s*pool|ddp|mp3\s*pool|club\s*killers|crooklyn\s*clan|zip\s*dj|beatport|traxsource|barbangerz|hood\s*pool|franchise|heavy\s*hits|direct\s*music\s*service|promo\s*only|ultimix|xmix|x\s*mix|dj\s*tools?|quick\s*hit|snipz|dirty|intro|outro|short\s*edit|hype\s*intro|clap\s*intro|transition|redrum|\d{2,3}\s*bpm|[1-9]{1,2}[ab]|\d{1,2}\s*(?:a|b)\s*-?\s*(?:minor|major)?|320\s*kbps|kbps)\b/g;

/** Aggressive normalization for matching. Memoized, bounded. */
export function normalizeText(input: string): string {
  if (!input) return "";
  const cached = normCache.get(input);
  if (cached !== undefined) return cached;

  let s = input.toLowerCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/&/g, " and ");
  s = s.replace(/\b(feat\.?|ft\.?|featuring|w\/)\s+[^\-\[\]()_]+/g, " ");
  s = s.replace(DJ_POOL_RE, " ");
  s = s.replace(NOISE_RE, " ");
  s = s.replace(/[_\-–—]+/g, " ");
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // Leading track numbers: "01 ", "1-02 ", "103 "
  s = s.replace(/^(\d{1,2}\s+)?\d{1,3}\s+/, "");

  if (normCache.size >= NORM_CACHE_LIMIT) {
    const firstKey = normCache.keys().next().value;
    if (firstKey !== undefined) normCache.delete(firstKey);
  }
  normCache.set(input, s);
  return s;
}

// --- version tags -------------------------------------------------------------

export const VERSION_WORDS = [
  "remix",
  "mix",
  "edit",
  "extended",
  "radio",
  "club",
  "dub",
  "acoustic",
  "live",
  "instrumental",
  "acapella",
  "a cappella",
  "reprise",
  "demo",
  "vip",
  "bootleg",
  "mashup",
  "intro",
  "outro",
  "transition",
  "short",
  "clean",
  "dirty",
  "super",
  "quick",
] as const;

const VERSION_WORD_RE = new RegExp(`\\b(${VERSION_WORDS.join("|")})\\b`, "i");
const BRACKET_RE = /[\(\[\{]([^\)\]\}]*)[\)\]\}]/g;

export interface ParsedTitle {
  /** Normalized title with any version tag removed. */
  base: string;
  /** Normalized version tag ("club mix", "live", ...) or "" when none. */
  version: string;
  /** Base tokens, deduped. */
  tokens: string[];
}

/**
 * Split a raw title into its base and a version tag. Bracketed segments that
 * contain a version word become the version; other bracketed segments (e.g.
 * "(feat. X)") are folded away.
 */
export function parseTitle(raw: string): ParsedTitle {
  if (!raw) return { base: "", version: "", tokens: [] };
  let versionRaw = "";
  let stripped = raw.replace(BRACKET_RE, (_m, inner: string) => {
    if (!versionRaw && VERSION_WORD_RE.test(inner)) {
      versionRaw = inner;
      return " ";
    }
    return " ";
  });

  // Trailing dash form: "Song - Club Mix"
  if (!versionRaw) {
    const m = stripped.match(/\s[-–—]\s([^-–—]{1,40})$/);
    if (m && VERSION_WORD_RE.test(m[1])) {
      versionRaw = m[1];
      stripped = stripped.slice(0, m.index);
    }
  }

  const base = normalizeText(stripped);
  const version = normalizeVersion(versionRaw);
  return { base, version, tokens: tokenize(base) };
}

/** Collapse a version tag to a comparable form ("Extended Club Mix" -> "club extended mix"). */
export function normalizeVersion(raw: string): string {
  const n = normalizeText(raw);
  if (!n) return "";
  const words = n.split(" ").filter(Boolean);
  // Drop the remixer name; keep only recognized version words, sorted.
  const keep = words.filter((w) => VERSION_WORD_RE.test(w));
  if (!keep.length) return n;
  return Array.from(new Set(keep)).sort().join(" ");
}

export function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  return Array.from(new Set(normalized.split(" ").filter((t) => t.length > 1)));
}

// --- similarity ---------------------------------------------------------------

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const dp: number[] = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[bl];
}

export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = Math.max(a.length, b.length);
  return 1 - editDistance(a, b) / m;
}

/** Jaccard-ish token overlap, generous toward the shorter side. */
export function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let hit = 0;
  for (const t of a) if (setB.has(t)) hit++;
  return hit / Math.min(a.length, b.length);
}

// --- scoring ------------------------------------------------------------------

export interface MatchSubject {
  artist: string; // normalized
  title: ParsedTitle;
}

export function makeSubject(artist: string, title: string): MatchSubject {
  return { artist: normalizeText(artist), title: parseTitle(title) };
}

export interface ScoreParts {
  score: number;
  titleSim: number;
  artistSim: number;
  versionMatch: boolean;
}

/**
 * Weighted score in 0..1. Title dominates; a version mismatch is a penalty,
 * never an outright rejection, so remixes stay findable.
 */
export function scorePair(q: MatchSubject, c: MatchSubject): ScoreParts {
  const titleSim = Math.max(
    similarity(q.title.base, c.title.base),
    tokenOverlap(q.title.tokens, c.title.tokens) * 0.98,
  );
  const artistSim = q.artist && c.artist ? similarity(q.artist, c.artist) : 0;
  const artistKnown = Boolean(q.artist && c.artist);

  let score = artistKnown ? titleSim * 0.72 + artistSim * 0.28 : titleSim * 0.9;

  // Containment bonus (one title fully inside the other, e.g. subtitle noise).
  if (
    q.title.base &&
    c.title.base &&
    (q.title.base.includes(c.title.base) || c.title.base.includes(q.title.base))
  ) {
    score = Math.min(1, score + 0.05);
  }

  // A strong title hit against a clearly different artist is usually a
  // coincidence (e.g. a song titled like some other band's name).
  if (artistKnown && artistSim < 0.35) score *= 0.85;

  const versionMatch = q.title.version === c.title.version;
  if (!versionMatch) {
    // Asking for an original and getting a version (or vice versa) is a soft
    // penalty; two *different* versions is a bigger one.
    score -= q.title.version && c.title.version ? 0.18 : 0.1;
  }

  return { score: Math.max(0, Math.min(1, score)), titleSim, artistSim, versionMatch };
}

/**
 * Deterministic comparator for equally-scored candidates:
 * exact version match -> larger file size -> lexicographic path.
 */
export function tieBreak(
  a: { versionMatch: boolean; size?: number; path?: string },
  b: { versionMatch: boolean; size?: number; path?: string },
): number {
  if (a.versionMatch !== b.versionMatch) return a.versionMatch ? -1 : 1;
  const as = a.size ?? 0;
  const bs = b.size ?? 0;
  if (as !== bs) return bs - as;
  return (a.path || "").localeCompare(b.path || "");
}

// --- token inverted index -----------------------------------------------------

export interface TokenIndex {
  postings: Map<string, number[]>;
  docCount: number;
}

export function buildTokenIndex(docTokens: string[][]): TokenIndex {
  const postings = new Map<string, number[]>();
  docTokens.forEach((tokens, i) => {
    for (const t of tokens) {
      const arr = postings.get(t);
      if (arr) arr.push(i);
      else postings.set(t, [i]);
    }
  });
  return { postings, docCount: docTokens.length };
}

/**
 * Candidate doc ids ordered by how many query tokens they contain.
 * Very common tokens are skipped so "the"-style words don't dominate.
 */
export function candidatesFor(idx: TokenIndex, tokens: string[], limit = 400): number[] {
  if (!tokens.length) return [];
  const hits = new Map<number, number>();
  const maxPosting = Math.max(50, Math.floor(idx.docCount * 0.25));
  for (const t of tokens) {
    const arr = idx.postings.get(t);
    if (!arr || arr.length > maxPosting) continue;
    for (const d of arr) hits.set(d, (hits.get(d) || 0) + 1);
  }
  if (!hits.size) return [];
  return Array.from(hits.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([d]) => d);
}

// Confidence floors shared by both matchers.
export const STRONG_MATCH = 0.9;
export const POSSIBLE_MATCH = 0.62;
export const FILE_MATCH_FLOOR = 0.66;
