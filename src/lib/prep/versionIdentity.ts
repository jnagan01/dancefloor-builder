import { parseCredit, versionTitleIdentity } from "../additionIdentity";

/**
 * Conservative "same work" identity for the details drawer's "Versions in your library" list. Display only: it never
 * changes selections, matching candidates, approvals, saved keys or audio/file identity.
 *
 * Same work = same artist credit (whole primary credit, or the identical full collaborator set; explicit feat. credits
 * reduce to their primary) AND the same base title once version descriptors are removed (remix/live/acoustic/edit/
 * clean/radio/remaster...). Sharing only title words, a similar title, or the same title by another artist (covers)
 * is NOT the same work. Files without artist or title are never accepted.
 */
const fold = (s: string) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const tidy = (s: string) => s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const DESC = /\b(?:remix|mix|edit|version|live|acoustic|remaster(?:ed)?|radio|clean|dirty|explicit|uncensored|extended|instrumental|intro|outro|demo|mono|stereo|dub|rework|bootleg|vip|unplugged|original|redrum|session|single)\b/;

export function workTitle(artist: string, title: string): string {
  let s = fold(title);
  s = s.replace(/[([{]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]}]*[)\]}]/g, " ");
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (all, inner: string) => (DESC.test(inner) ? " " : all));
  s = s.replace(/\s+[-–—]\s+([^-–—]+)$/, (all, tail: string) => (DESC.test(tail) ? "" : all));
  return versionTitleIdentity(artist, s);
}

export function sameCredit(a: string, b: string): boolean {
  const x = parseCredit(a), y = parseCredit(b);
  if (!x.primary || !y.primary) return false;
  return x.primary === y.primary || (x.set.length > 1 && x.set.join("+") === y.set.join("+"));
}

export function sameWork(aArtist: string, aTitle: string, bArtist: string, bTitle: string): boolean {
  const ta = workTitle(aArtist, aTitle), tb = workTitle(bArtist, bTitle);
  return !!ta && ta === tb && sameCredit(aArtist, bArtist);
}

export interface FileLike { filePath: string; artist: string; title: string; remix?: string }
const fullTitle = (t: FileLike) => t.remix && !fold(t.title).includes(fold(t.remix)) ? `${t.title} (${t.remix})` : t.title;

export interface VersionView<T extends FileLike> {
  /** The exact selected file, always shown, flagged when it is not the same work as the song. */
  selected?: { track: T; sameWork: boolean };
  /** Other files that are the same work; `variant` marks a distinct remix/live/acoustic/etc. identity. */
  versions: { track: T; variant: boolean }[];
  /** Matcher candidates hidden here because they are not the same work (still available in the row's matcher). */
  hidden: number;
}

/** O(alternatives): the matcher already capped candidates, so no library scan happens per row. */
export function classifyVersions<T extends FileLike>(artist: string, song: string, selected: T | undefined, alternatives: readonly T[]): VersionView<T> {
  const base = versionTitleIdentity(artist, song);
  const out: VersionView<T> = { versions: [], hidden: 0 };
  if (selected) out.selected = { track: selected, sameWork: sameWork(artist, song, selected.artist, fullTitle(selected)) };
  const seen = new Set(selected ? [selected.filePath] : []);
  for (const a of alternatives) {
    if (!a || seen.has(a.filePath)) continue; // case-sensitive exact file identity; same basename in another root stays distinct
    seen.add(a.filePath);
    if (sameWork(artist, song, a.artist, fullTitle(a))) out.versions.push({ track: a, variant: versionTitleIdentity(a.artist, fullTitle(a)) !== base });
    else out.hidden++;
  }
  return out;
}
