/**
 * Shared duplicate identity for AUTOMATIC additions only (never saved keys, feedback keys, path resolution, clean
 * matching or export approval). Pure and dependency-free so danceFloor can import it without a cycle.
 *
 * Conservative credit evidence:
 * - Explicit feat./ft./featuring/with marks a featured credit. "Mark Ronson feat. Bruno Mars" shares its PRIMARY
 *   credit with "Mark Ronson" (strong evidence) — in either arrival order.
 * - The whole primary credit is never split on unmarked separators (&, commas, x, /, +), so "Earth, Wind & Fire",
 *   "AC/DC" or "Simon & Garfunkel" never equal one of their tokens or a solo artist.
 * - The FULL collaborator set (primary tokens + featured credits) may be reordered: "Bruno Mars & Mark Ronson" ==
 *   "Mark Ronson feat. Bruno Mars" == "Mark Ronson, Bruno Mars". A set key only matches an identical set.
 * Known limitation: an unmarked joint credit ("Bruno Mars & Mark Ronson") is NOT equated with a solo credit
 * ("Mark Ronson") unless an explicitly marked credit for the same title has already joined that group, because a
 * band name and a joint credit cannot be told apart without outside evidence.
 */
const fold = (s: string) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const tidy = (s: string) => s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
const FEAT = /\s*\(\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)]*)\)|\s+(?:feat\.?|ft\.?|featuring|with)\s+(.*)$/;

export interface Credit { primary: string; set: string[] }
/** Primary credit (whole, normalized) and the full sorted collaborator set. */
export function parseCredit(artist: string): Credit {
  let rest = fold(artist).trim();
  const featured: string[] = [];
  for (let m = rest.match(FEAT); m; m = rest.match(FEAT)) {
    featured.push(m[1] ?? m[2] ?? "");
    rest = (rest.slice(0, m.index) + " " + rest.slice((m.index ?? 0) + m[0].length)).trim();
  }
  const primary = tidy(rest);
  const split = (s: string) => s.split(/\s*(?:,|;|\/|&|\+)\s*|\s+(?:x|and|vs\.?)\s+/).map(tidy).filter(Boolean);
  const set = [...new Set([...split(rest), ...featured.flatMap(split)])].sort();
  return { primary, set };
}

export const LABEL = /^(?:clean|dirty|explicit|uncensored|radio edit|radio version|radio clean|clean edit|clean version|clean radio edit|dirty version|explicit version|edited|edited version)$/;
/** Title identity keeping every remix/live/acoustic/extended/named-edit descriptor and all bare title words. Removes
 * only bracketed or dash-suffix featured credits, a bracketed/suffix clean/dirty/radio-edit LABEL, and an embedded copy
 * of the row's own full credit ("Artist - Title"). */
/** True when a bracket/suffix text is only a clean/dirty/radio-edit label (the same rule versionTitleIdentity uses). */
export const isVersionLabel = (text: string) => LABEL.test(tidy(fold(text)));
export function versionTitleIdentity(artist: string, song: string): string {
  let s = fold(song).trim();
  s = s.replace(/[([{]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]}]*[)\]}]/g, " ");
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (all, inner: string) => (LABEL.test(tidy(inner)) ? " " : all));
  s = s.replace(/\s+[-–—]\s+([^-–—]+)$/, (all, tail: string) => (LABEL.test(tidy(tail)) ? "" : all));
  const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) {
    const own = parseCredit(artist), wholeA = tidy(fold(artist));
    const isOwn = (x: string) => { const t = tidy(x); return !!t && (t === own.primary || t === wholeA); };
    if (isOwn(m[1])) s = m[2]; else if (isOwn(m[2])) s = m[1];
  }
  return tidy(s);
}

const keysOf = (artist: string, song: string) => {
  const title = versionTitleIdentity(artist, song);
  if (!title) return { primary: undefined, set: undefined };
  const c = parseCredit(artist);
  return { primary: c.primary ? `P:${c.primary}|${title}` : undefined, set: c.set.length ? `S:${c.set.join("+")}|${title}` : undefined };
};
/** Every identity key; rows are duplicates when any key overlaps. */
export function additionKeys(artist: string, song: string): string[] {
  const k = keysOf(artist, song);
  return [...new Set([k.primary, k.set].filter((x): x is string => !!x))];
}

/** Identity index used by every automatic-addition dedupe (candidate pool, generation passes, final pass). */
export class AdditionKeySet {
  private keys = new Map<string, string>();
  match(artist: string, song: string): string | undefined {
    for (const k of additionKeys(artist, song)) { const v = this.keys.get(k); if (v !== undefined) return v; }
    return undefined;
  }
  has(artist: string, song: string) { return this.match(artist, song) !== undefined; }
  /** A kept row: all its keys identify its group. */
  add(artist: string, song: string, owner = "") { for (const k of additionKeys(artist, song)) if (!this.keys.has(k)) this.keys.set(k, owner); }
  /** A matched duplicate: only its full collaborator SET joins the group (never its primary alone), so a merged
   * alias cannot transitively pull in another artist's solo recording. */
  absorb(artist: string, song: string, owner = "") { const s = keysOf(artist, song).set; if (s && !this.keys.has(s)) this.keys.set(s, owner); }
  /** Returns true when new (and adds it); a duplicate is absorbed. */
  tryAdd(artist: string, song: string, owner = "") {
    const hit = this.match(artist, song);
    if (hit !== undefined) { this.absorb(artist, song, hit); return false; }
    this.add(artist, song, owner); return true;
  }
}

/**
 * Import review: indices of rows that repeat an EARLIER row under the same conservative identity used for automatic
 * additions. Live/remix/acoustic/extended/named edits, different artists and covers stay distinct; explicit featured
 * credits match their primary artist; band names are never split. Rows without a title are never counted.
 * Display/explicit-action helper only: never rewrites saved keys and never removes anything by itself.
 */
export function repeatedRequestRows(songs: ReadonlyArray<{ artist: string; song: string }>): Set<number> {
  const seen = new AdditionKeySet();
  const repeats = new Set<number>();
  songs.forEach((s, i) => {
    if (!versionTitleIdentity(s.artist, s.song)) return;
    if (!seen.tryAdd(s.artist, s.song, String(i))) repeats.add(i);
  });
  return repeats;
}
