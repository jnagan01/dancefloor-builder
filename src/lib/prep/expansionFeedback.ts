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

/** Feedback that refuses every automatic addition; used when the knowledge it would need is not trustworthy. */
export const BLOCK_ALL_ADDITIONS: ExpansionFeedback = { blocked: () => "never", favored: () => false };

export interface FeedbackOwner { account: string; generation: number }
export interface FeedbackStoreLike {
  get(): { account: string | null; generation: number; status: "signedOut" | "loading" | "ready" | "blocked"; knowledge: PrepKnowledge };
  subscribe(l: () => void): () => void;
  settled(o: FeedbackOwner): Promise<PrepKnowledge>;
}
export type FeedbackGate = { ok: true; owner: FeedbackOwner } | { ok: false; message: string };

const TAIL = "Expansion was stopped and nothing changed. Turn expansion off to work with requests only.";
export const GATE_MESSAGES = {
  blocked: `Saved preparation notes are unreadable, so your Never and dismiss choices can't be honoured. ${TAIL}`,
  signedOut: `Preparation notes aren't loaded for this signed-in account, so your Never and dismiss choices can't be honoured. Sign in again, then retry. ${TAIL}`,
  loading: `Preparation notes are still loading, so your Never and dismiss choices can't be honoured yet. Try Generate again in a moment. ${TAIL}`,
};

/**
 * Automatic expansion requires READY knowledge owned by exactly this account. Loading (or a not-yet-started
 * session) is awaited up to `timeoutMs`; blocked, wrong-owner or timed-out knowledge stops with an actionable
 * message. Never falls back to another account's or an earlier session's knowledge.
 */
export function awaitReadyFeedback(store: FeedbackStoreLike, account: string | null | undefined, timeoutMs = 5000): Promise<FeedbackGate> {
  return new Promise(resolve => {
    let done = false, unsub: () => void = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (g: FeedbackGate) => { if (done) return; done = true; unsub(); if (timer) clearTimeout(timer); resolve(g); };
    const check = () => {
      const s = store.get();
      if (!account) return finish({ ok: false, message: GATE_MESSAGES.signedOut });
      if (s.account === account && s.status === "ready") return finish({ ok: true, owner: { account, generation: s.generation } });
      if (s.account === account && s.status === "blocked") return finish({ ok: false, message: GATE_MESSAGES.blocked });
      if (s.account !== null && s.account !== account) return finish({ ok: false, message: GATE_MESSAGES.signedOut });
      // loading for this account, or signed out while the session starts: wait (bounded).
    };
    unsub = store.subscribe(check);
    check();
    if (!done) timer = setTimeout(() => finish({ ok: false, message: store.get().status === "loading" ? GATE_MESSAGES.loading : GATE_MESSAGES.signedOut }), timeoutMs);
  });
}
