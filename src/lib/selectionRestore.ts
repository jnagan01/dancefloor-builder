import { dedupeKey, normalizeKey, songKeys } from "@/lib/danceFloor";

export type SavedSelection = { paths: string[]; excluded?: boolean; confirmed?: boolean };
export type SelectionMap = Record<string, SavedSelection>;
type Section = "warmUp" | "transition" | "peak";
type Row = { artist: string; song: string };
type Lists = Partial<Record<Section, Row[]>>;

const SECTIONS: Section[] = ["warmUp", "transition", "peak"];
const POSITIONAL = /^(warmUp|transition|peak):(\d+):(.*)$/s;

/** The current row key format. Kept here so restore and serialization agree with the route. */
export function rowSelectionKey(section: Section, idx: number, s: Row): string {
  return `${section}:${idx}:${dedupeKey(s.artist, s.song)}`;
}

function parsePositional(key: string): { section: Section; idx: number; identity: string } | null {
  const m = key.match(POSITIONAL);
  return m ? { section: m[1] as Section, idx: Number(m[2]), identity: m[3] } : null;
}

/** Positional key that carries an `artist|title` identity (current or older dedupe spelling). */
export function isIdentityKey(key: string): boolean {
  const p = parsePositional(key);
  return !!p && p.identity.includes("|");
}

/**
 * Does a stored key's identity suffix positively name this song? The suffix is an older normalized
 * `artist|title`; re-normalizing it must give the same dedupe key, or overlap the song's credit-tolerant
 * keys (title must still match). Position, basename or library contents are never evidence.
 */
export function legacyIdentityMatches(identity: string, song: Row): boolean {
  const bar = identity.indexOf("|");
  if (bar <= 0 || bar === identity.length - 1) return false;
  const a = identity.slice(0, bar), t = identity.slice(bar + 1);
  if (dedupeKey(a, t) === dedupeKey(song.artist, song.song)) return true;
  // Older spellings normalized the row's own artist/title without later title clean-up (e.g. "Song - Live").
  const plain = (x: string) => (x || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  for (const [ar, ti] of [[normalizeKey(song.artist), normalizeKey(song.song)], [plain(song.artist), plain(song.song)]]) {
    if (ti && [ar, ar.replace(/^(the|a)\s+/, "")].some(x => x && `${x}|${ti}` === identity)) return true;
  }
  const theirs = new Set(songKeys(a, t));
  return songKeys(song.artist, song.song).some(k => theirs.has(k));
}

const sameSelection = (x: SavedSelection, y: SavedSelection) =>
  x.paths.length === y.paths.length && x.paths.every((p, i) => p === y.paths[i]) && !!x.excluded === !!y.excluded && x.confirmed === y.confirmed;

/**
 * Deterministic, identity-safe restore. For each current row:
 * 1. the exact current key wins, regardless of object enumeration order;
 * 2. otherwise a legacy key at the SAME section+position whose identity suffix positively names this song;
 *    several validated legacy entries that disagree are ambiguous and none is applied;
 * 3. otherwise nothing — stale keys for other songs never lend paths/confirmation/exclusion.
 */
export function resolveSavedSelections(lists: Lists, stored: SelectionMap | null | undefined): SelectionMap {
  const out: SelectionMap = {};
  if (!stored) return out;
  const legacy = new Map<string, SavedSelection[]>();
  for (const [k, v] of Object.entries(stored)) {
    const p = parsePositional(k);
    if (!p || !v || !Array.isArray(v.paths)) continue;
    const at = `${p.section}:${p.idx}`;
    const row = lists[p.section]?.[p.idx];
    if (!row || k === rowSelectionKey(p.section, p.idx, row)) continue;
    if (!legacyIdentityMatches(p.identity, row)) continue;
    legacy.set(at, [...(legacy.get(at) ?? []), v]);
  }
  for (const section of SECTIONS) (lists[section] ?? []).forEach((row, idx) => {
    const key = rowSelectionKey(section, idx, row);
    const exact = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : undefined;
    if (exact && Array.isArray(exact.paths)) { out[key] = exact; return; }
    const cands = legacy.get(`${section}:${idx}`) ?? [];
    if (cands.length && cands.every(c => sameSelection(c, cands[0]))) out[key] = cands[0];
  });
  return out;
}

/**
 * Serialization base for a snapshot write (only explicit edits ever write). Identity-bearing positional
 * keys are replaced by the resolved entries for the CURRENT rows, so stale keys for songs no longer at that
 * position cannot become exact matches later (e.g. after regeneration). Non-positional or identity-less
 * legacy keys are inert (never applied) and kept verbatim.
 */
export function selectionBase(stored: SelectionMap | null | undefined, resolved: SelectionMap, currentKeys: Set<string>): SelectionMap {
  const out: SelectionMap = {};
  for (const [k, v] of Object.entries(stored ?? {})) if (!isIdentityKey(k)) out[k] = v;
  for (const [k, v] of Object.entries(resolved)) if (currentKeys.has(k)) out[k] = v;
  return out;
}

// ---- Runtime file selections (library indices are positional; saved paths are the identity) ----
import type { SongMatch } from "@/lib/virtualDj";
import { createIdentityIndex } from "@/lib/fileIdentity";

type TrackLike = { filePath?: string };

/** Case-sensitive identity resolver over a library; duplicates/unknown resolve to undefined (never a guess). */
export function libraryResolver(tracks: readonly TrackLike[], roots: Record<string, string>): (path: string) => number | undefined {
  const index = createIdentityIndex(tracks.map((_, i) => i), i => tracks[i]?.filePath ?? "", roots);
  return path => (path ? index.resolve(path) : undefined);
}

/** Full ordered selection paths of a runtime match, including saved paths not currently in the library. */
export function selectionPaths(match: SongMatch | undefined, tracks: readonly TrackLike[]): string[] {
  if (!match) return [];
  if (match.trackIndex == null) return [...(match.unresolvedPaths ?? [])];
  const found = [match.trackIndex, ...(match.extraTrackIndices ?? [])].map(i => tracks[i]?.filePath).filter((p): p is string => !!p);
  return [...found, ...(match.unresolvedPaths ?? []).filter(p => !found.includes(p))];
}

/**
 * Build a runtime match from an ordered saved path list. The primary is never replaced by an extra: a
 * missing primary leaves the row unlinked (extras are not exported) and keeps every path as unresolved.
 * Approval/exclusion are carried as saved; an unlinked row can never export.
 */
export function matchFromPaths(paths: readonly string[], resolve: (p: string) => number | undefined, opts: { confirmed?: boolean; excluded?: boolean; alternatives?: number[] }): SongMatch {
  const confirmed = opts.confirmed === true;
  const found = paths.map(resolve);
  const primary = found[0];
  if (primary === undefined) return { status: "Missing From Library", confidence: 0, confirmed: paths.length ? confirmed : false, trackIndex: undefined, extraTrackIndices: [], alternatives: opts.alternatives ?? [], excludedFromVdj: opts.excluded, ...(paths.length ? { unresolvedPaths: [...paths] } : {}) };
  const extras: number[] = [], lost: string[] = [];
  found.slice(1).forEach((i, n) => { if (i === undefined) lost.push(paths[n + 1]); else if (i !== primary && !extras.includes(i)) extras.push(i); });
  return { status: confirmed ? "Manually Matched" : "Possible Match", confidence: confirmed ? 1 : 0, confirmed, trackIndex: primary, extraTrackIndices: extras, alternatives: opts.alternatives ?? [], excludedFromVdj: opts.excluded, ...(lost.length ? { unresolvedPaths: lost } : {}) };
}

/**
 * Re-point every match after a library rebuild by file identity (old index → path → new index), never by
 * position. Files no longer present become unresolved paths; nothing is substituted.
 */
export function remapMatches(matches: Record<string, SongMatch>, oldTracks: readonly TrackLike[], newTracks: readonly TrackLike[], roots: Record<string, string>): Record<string, SongMatch> {
  const resolve = libraryResolver(newTracks, roots);
  const out: Record<string, SongMatch> = {};
  for (const [key, m] of Object.entries(matches)) {
    if (!m) { out[key] = m; continue; }
    const paths = selectionPaths(m, oldTracks);
    const alternatives = (m.alternatives ?? []).map(i => oldTracks[i]?.filePath).map(p => (p ? resolve(p) : undefined)).filter((i): i is number => i !== undefined);
    if (!paths.length) { out[key] = { ...m, alternatives }; continue; }
    const rebuilt = matchFromPaths(paths, resolve, { confirmed: m.confirmed, excluded: m.excludedFromVdj, alternatives });
    // Keep the original status/confidence while the primary still resolves (automatic matches stay automatic).
    out[key] = rebuilt.trackIndex != null && m.trackIndex != null ? { ...m, trackIndex: rebuilt.trackIndex, extraTrackIndices: rebuilt.extraTrackIndices, alternatives, unresolvedPaths: rebuilt.unresolvedPaths } : { ...m, ...rebuilt, ...(rebuilt.unresolvedPaths ? {} : { unresolvedPaths: undefined }) };
  }
  return out;
}
