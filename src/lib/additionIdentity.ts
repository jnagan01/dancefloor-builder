/**
 * Shared duplicate identity for AUTOMATIC additions only (never saved keys, feedback keys, path resolution or export
 * approval). Two rows are the same intended recording when their title (with every version descriptor kept) matches
 * and they share a whole credited artist name. Pure and dependency-free so danceFloor can import it without a cycle.
 */
const fold = (s: string) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const tidy = (s: string) => s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");

/** Whole credited names: feat/ft/featuring/with/&/x/vs/commas/semicolons/slash. Never splits inside a name. */
export function creditNames(artist: string): string[] {
  const parts = fold(artist).split(/\s*(?:,|;|\/|&|\+)\s*|\s+(?:x|vs\.?|feat\.?|ft\.?|featuring|with)\s+|\s*\((?:feat\.?|ft\.?|featuring|with)\s+|\)/);
  const out = new Set<string>();
  for (const p of parts) { const n = tidy(p); if (n) out.add(n); }
  return [...out];
}

/** Title identity keeping remix/live/acoustic/extended/named-edit descriptors. Only featured-artist credits,
 * an embedded copy of the row's own artist, and interchangeable clean/dirty/radio-edit labels are removed. */
export function versionTitleIdentity(artist: string, song: string): string {
  let s = fold(song);
  s = s.replace(/[([{]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]}]*[)\]}]/g, " ")
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+[^([{-]*$/g, " ");
  const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) {
    const own = new Set(creditNames(artist));
    const isOwn = (x: string) => { const c = creditNames(x); return c.length > 0 && c.every((n) => own.has(n)); };
    if (isOwn(m[1])) s = m[2]; else if (isOwn(m[2])) s = m[1];
  }
  s = s.replace(/\b(clean|dirty|explicit|uncensored|radio\s+edit|radio\s+clean|clean\s+edit|clean\s+version)\b/g, " ");
  return tidy(s);
}

/** Every identity key; rows are duplicates when any key overlaps. */
export function additionKeys(artist: string, song: string): string[] {
  const title = versionTitleIdentity(artist, song);
  if (!title) return [];
  const keys = new Set<string>();
  const whole = tidy(fold(artist)); if (whole) keys.add(`${whole}|${title}`);
  for (const n of creditNames(artist)) keys.add(`${n}|${title}`);
  return [...keys];
}

export class AdditionKeySet {
  private keys = new Map<string, string>();
  /** Returns the owner tag of a matching earlier row, if any. */
  match(artist: string, song: string): string | undefined {
    for (const k of additionKeys(artist, song)) { const v = this.keys.get(k); if (v !== undefined) return v; }
    return undefined;
  }
  has(artist: string, song: string) { return this.match(artist, song) !== undefined; }
  add(artist: string, song: string, owner = "") { for (const k of additionKeys(artist, song)) if (!this.keys.has(k)) this.keys.set(k, owner); }
}
