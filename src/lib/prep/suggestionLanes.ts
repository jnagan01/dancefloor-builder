/**
 * Bounded suggestion lifecycle: one in-flight request per section lane, lanes run side by side so a slow
 * section never starves a later one. Client and server deadlines are coordinated: the client asks the server
 * to finish within `deadlineMs` (at most SUGGESTION_SERVER_DEADLINE_MS) and waits that long plus a transport
 * margin, so a healthy 20–25 s reply is never discarded and the server's own deadline ends its work first
 * (no orphan generation keeps running after the client gives up).
 *
 * Failure scope: validation/terminal errors are deterministic for every lane and stop all lanes; a timeout only
 * affects its own lane (bounded, smaller retry later); a transient 429/5xx gets one delayed retry in its lane.
 * Every await is followed by the caller's fence: a stale event/account/generation never reports or retries.
 */
export const SUGGESTION_SERVER_DEADLINE_MS = 30_000;
export const SUGGESTION_TRANSPORT_MARGIN_MS = 4_000;
/** Below this window a request cannot return useful work; the lane ends honestly instead of sending. */
export const SUGGESTION_MIN_WINDOW_MS = 8_000;
export const SUGGESTION_MAX_LANE_TIMEOUTS = 2;
export const SUGGESTION_MIN_COUNT = 8;
export const SUGGESTION_DEADLINE_CODE = "SUGGESTION_DEADLINE";

export type SuggestionFailureKind = "validation" | "transient" | "timeout" | "terminal";
export type SuggestionReply<S> = { suggestions: S[]; partial?: boolean };
export type LaneState = { attempts: number; timeouts: number; transient: number; stopped: boolean; cap: number; latencies: number[] };

export function suggestionDeadlineError(message = "Suggestion time limit reached"): Error {
  return Object.assign(new Error(message), { code: SUGGESTION_DEADLINE_CODE });
}

export function createSuggestionLanes<Req, S>(o: {
  send: (request: Req, signal: AbortSignal) => Promise<SuggestionReply<S>>;
  classify: (error: unknown) => { kind: SuggestionFailureKind; message: string };
  isCurrent: () => boolean;
  /** Absolute end of the suggestion phase (ms since epoch). */
  end: number;
  maxCount: number;
  onFailure?: (failure: { kind: SuggestionFailureKind; message: string; lane: string }) => void;
}) {
  const lanes = new Map<string, LaneState>();
  const busy = new Set<string>();
  let stoppedAll = false;
  const state = (key: string): LaneState => {
    let s = lanes.get(key);
    if (!s) { s = { attempts: 0, timeouts: 0, transient: 0, stopped: false, cap: o.maxCount, latencies: [] }; lanes.set(key, s); }
    return s;
  };
  const live = () => !stoppedAll && o.isCurrent() && Date.now() < o.end;

  /** `build(count, deadlineMs)` creates the wire request at dispatch time (fresh context, coordinated deadline). */
  async function request(lane: string, wanted: number, build: (count: number, deadlineMs: number) => Req): Promise<SuggestionReply<S> | null> {
    const s = state(lane);
    // One in-flight request per lane: a caller can never overlap work in the same section.
    if (busy.has(lane)) return null;
    busy.add(lane);
    try {
      for (;;) {
        if (!live() || s.stopped || wanted <= 0) return null;
        const window = o.end - Date.now() - SUGGESTION_TRANSPORT_MARGIN_MS;
        if (window < SUGGESTION_MIN_WINDOW_MS) { s.stopped = true; return null; }
        const deadlineMs = Math.min(SUGGESTION_SERVER_DEADLINE_MS, window);
        const count = Math.max(1, Math.min(wanted, s.cap, o.maxCount));
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const started = Date.now();
        s.attempts++;
        try {
          const call = o.send(build(count, deadlineMs), controller.signal);
          call.catch(() => {}); // a late rejection after the client deadline is never unhandled
          const reply = await Promise.race([call, new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(suggestionDeadlineError()); }, deadlineMs + SUGGESTION_TRANSPORT_MARGIN_MS);
          })]);
          if (!o.isCurrent()) return null;
          s.latencies.push(Date.now() - started);
          // A deadline-bounded partial reply sizes this lane's next request to what fit.
          if (reply.partial) s.cap = Math.max(SUGGESTION_MIN_COUNT, Math.min(s.cap, reply.suggestions.length));
          return { suggestions: Array.isArray(reply.suggestions) ? reply.suggestions : [], partial: !!reply.partial };
        } catch (error) {
          if (!o.isCurrent()) return null;
          const failure = o.classify(error);
          o.onFailure?.({ ...failure, lane });
          if (failure.kind === "timeout") {
            s.timeouts++;
            s.cap = Math.max(SUGGESTION_MIN_COUNT, Math.floor(count / 2));
            if (s.timeouts >= SUGGESTION_MAX_LANE_TIMEOUTS) s.stopped = true;
            return null;
          }
          if (failure.kind === "transient" && s.transient < 1) {
            s.transient++;
            if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
            await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(1000, o.end - Date.now()))));
            continue; // fenced again at the top of the loop before any resend
          }
          if (failure.kind === "transient") { s.stopped = true; return null; }
          stoppedAll = true;
          return null;
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
    } finally {
      busy.delete(lane);
    }
  }
  return {
    request,
    lane: (key: string): Readonly<LaneState> => state(key),
    /** True when this lane can still be offered a request. */
    open: (key: string) => live() && !state(key).stopped,
    get stoppedAll() { return stoppedAll; },
  };
}
