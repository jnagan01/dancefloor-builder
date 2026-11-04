import { AdditionKeySet } from "../additionIdentity";

/** Pre-ranking automatic-addition candidate pool. Credit aliases collapse into ONE entry before ranking, so slots and
 * artist variety are never spent twice on the same recording. The result is independent of arrival order:
 * an exact owned file (incoming identity == file identity) is always promoted, lowest track index wins, and
 * non-owned representatives use the smallest identity with order-independent metadata merging. */
export interface PoolRow { artist: string; song: string; aiReason?: string; aiSuggestion?: boolean }
export interface PoolEntry<R, S> { row: R; prefer?: S; trackIdx?: number }
export interface PoolOptions<R extends PoolRow, S> {
  cap: number;
  taken: (artist: string, song: string) => boolean;
  identity: (artist: string, song: string) => string;
  /** Track index only when that file's own identity equals the incoming row's identity. */
  exactOwned: (row: R) => number | undefined;
  ownedRow: (idx: number, reason?: string) => R;
  merge: (a: R, b: R) => R;
  sectionRank: (k?: S) => number;
  /** Optional stable admission order, NOT a score. Lowest keys survive saturation, regardless of source arrival.
   * Callers can reserve their finite catalogue ahead of bounded discovered candidates. */
  admissionKey?: (row: R) => string;
  /** Optional backing map (the caller reads entries for enrichment/eligibility). */
  map?: Map<string, PoolEntry<R, S>>;
}

const minReason = (a?: string, b?: string) => (!a ? b : !b ? a : a <= b ? a : b);

export function createCandidatePool<R extends PoolRow, S>(o: PoolOptions<R, S>) {
  const map = o.map ?? new Map<string, PoolEntry<R, S>>();
  let alias = new AdditionKeySet();
  const owned = (idx: number, reason: string | undefined, ai: boolean | undefined) => ({ ...o.ownedRow(idx, reason), aiSuggestion: ai });
  function offer(row: R, prefer?: S): boolean {
    if (!row.artist || !row.song || o.taken(row.artist, row.song)) return false;
    const exact = o.exactOwned(row);
    const group = alias.match(row.artist, row.song);
    const old = group === undefined ? undefined : map.get(group);
    if (!old) {
      if (map.size >= o.cap) {
        if (!o.admissionKey || o.cap <= 0) return false;
        const keyFor = (r: R) => `${o.admissionKey?.(r)}\0${o.identity(r.artist, r.song)}`;
        const worst = [...map.entries()].sort((a, b) => keyFor(b[1].row).localeCompare(keyFor(a[1].row)))[0];
        if (!worst || keyFor(row).localeCompare(keyFor(worst[1].row)) >= 0) return false;
        map.delete(worst[0]);
        alias = new AdditionKeySet();
        for (const [key, entry] of map) alias.add(entry.row.artist, entry.row.song, key);
      }
      const key = o.identity(row.artist, row.song);
      map.set(key, exact !== undefined ? { row: o.merge(owned(exact, row.aiReason, row.aiSuggestion), row), prefer, trackIdx: exact } : { row, prefer });
      alias.add(row.artist, row.song, key);
      return true;
    }
    if (group === undefined) return false;
    alias.absorb(row.artist, row.song, group);
    const reason = minReason(old.row.aiReason, row.aiReason);
    const ai = old.row.aiSuggestion || row.aiSuggestion || undefined;
    if (exact !== undefined && (old.trackIdx === undefined || exact < old.trackIdx)) {
      const file = owned(exact, reason, ai);
      old.row = o.identity(file.artist, file.song) === o.identity(old.row.artist, old.row.song) ? o.merge(file, old.row) : file;
      old.row = o.merge(old.row, row); old.trackIdx = exact;
    } else if (old.trackIdx === undefined) {
      const merged = o.merge(old.row, row);
      const takeNew = o.identity(row.artist, row.song) < o.identity(old.row.artist, old.row.song);
      old.row = { ...merged, ...(takeNew ? { artist: row.artist, song: row.song } : {}), aiReason: reason, aiSuggestion: ai };
    } else {
      old.row = { ...(o.identity(old.row.artist, old.row.song) === o.identity(row.artist, row.song) ? o.merge(old.row, row) : old.row), aiReason: reason, aiSuggestion: ai };
    }
    if (o.sectionRank(prefer) < o.sectionRank(old.prefer)) old.prefer = prefer;
    return false;
  }
  return { offer, map };
}
