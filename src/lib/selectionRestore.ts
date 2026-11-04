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
