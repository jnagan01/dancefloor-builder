import { eventPrep, songIdentity, type PrepKnowledge } from "./knowledge";

/**
 * Applies account-fenced preparation knowledge to automatic additions only.
 * Client requests are never passed through this gate. Event dismissals apply only to their own event id;
 * global "never" applies everywhere for the account; "favor" only reorders, never bypasses other rules.
 */
export interface ExpansionFeedback {
  blocked(artist: string, song: string): false | "never" | "dismissed";
  favored(artist: string, song: string): boolean;
}

export function expansionFeedback(k: PrepKnowledge | null, eventId: string | null | undefined): ExpansionFeedback {
  if (!k) return { blocked: () => false, favored: () => false };
  const never = new Set<string>(), favor = new Set<string>();
  for (const f of k.feedback) (f.kind === "never" ? never : favor).add(f.key);
  const dismissed = new Set(eventId ? eventPrep(k, eventId).dismissed.map(d => d.key) : []);
  return {
    blocked: (a, s) => { const key = songIdentity(a, s); return never.has(key) ? "never" : dismissed.has(key) ? "dismissed" : false; },
    favored: (a, s) => favor.has(songIdentity(a, s)),
  };
}

/** Stable reorder: favoured additions first, original order otherwise. */
export function favoredFirst<T extends { artist: string; song: string }>(list: readonly T[], fb: ExpansionFeedback): T[] {
  return list.map((x, i) => ({ x, i, f: fb.favored(x.artist, x.song) ? 0 : 1 })).sort((a, b) => a.f - b.f || a.i - b.i).map(o => o.x);
}

/**
 * Final re-check before an automatic generation result is committed: drops any non-request addition that the
 * latest knowledge now blocks (feedback changed while generation was running). Requests are always kept.
 */
export function recheckAdditions<T extends { artist: string; song: string; fromUpload?: boolean }>(list: readonly T[], fb: ExpansionFeedback): { kept: T[]; removed: number } {
  const kept = list.filter(t => t.fromUpload || !fb.blocked(t.artist, t.song));
  return { kept, removed: list.length - kept.length };
}
