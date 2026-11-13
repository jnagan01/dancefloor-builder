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
/** Conservative start-up allowance before a streamed reply yields its first complete item. */
export const SUGGESTION_STARTUP_MS = 4_000;
const CLOSED = Symbol("closed");

export type SuggestionFailureKind = "validation" | "transient" | "timeout" | "terminal";
export type SuggestionReply<S> = { suggestions: S[]; partial?: boolean };
export type LaneState = { attempts: number; timeouts: number; transient: number; stopped: boolean; cap: number; latencies: number[];
  /** Measured reply time per returned item (start-up included, so conservative); undefined until a reply lands. */
  perItemMs?: number;
  /** The lane ended because the remaining window could not yield useful output at its measured pace. */
  shortWindow?: boolean };

/** Window a request needs to return `count` items at the lane's measured pace (never below the fixed minimum). */
export function usefulWindowMs(perItemMs: number | undefined, count: number): number {
  if (!perItemMs) return SUGGESTION_MIN_WINDOW_MS;
  return Math.max(SUGGESTION_MIN_WINDOW_MS, SUGGESTION_STARTUP_MS + perItemMs * Math.max(1, Math.min(SUGGESTION_MIN_COUNT, count)));
}

export function suggestionDeadlineError(message = "Suggestion time limit reached"): Error {
  return Object.assign(new Error(message), { code: SUGGESTION_DEADLINE_CODE });
}

export function createSuggestionLanes<Req, S>(o: {
  send: (request: Req, signal: AbortSignal) => Promise<SuggestionReply<S>>;
  classify: (error: unknown) => { kind: SuggestionFailureKind; message: string };
  isCurrent: () => boolean;
  /** Absolute end of the suggestion phase (ms since epoch). */
  end: number;
  /** Optional dynamic earlier end (e.g. leave time to look up what a reply returns). Never extends `end`. */
  latestEnd?: () => number;
  maxCount: number;
  onFailure?: (failure: { kind: SuggestionFailureKind; message: string; lane: string }) => void;
}) {
  const lanes = new Map<string, LaneState>();
  const busy = new Set<string>();
  let stoppedAll = false, closed = false;
  const inflight = new Set<{ controller: AbortController; reject: (e: unknown) => void }>();
  const state = (key: string): LaneState => {
    let s = lanes.get(key);
    if (!s) { s = { attempts: 0, timeouts: 0, transient: 0, stopped: false, cap: o.maxCount, latencies: [] }; lanes.set(key, s); }
    return s;
  };
  const endAt = () => Math.min(o.end, o.latestEnd?.() ?? Infinity);
  const live = () => !closed && !stoppedAll && o.isCurrent() && Date.now() < endAt();

  /** `build(count, deadlineMs)` creates the wire request at dispatch time (fresh context, coordinated deadline). */
  async function request(lane: string, wanted: number, build: (count: number, deadlineMs: number) => Req): Promise<SuggestionReply<S> | null> {
    const s = state(lane);
    // One in-flight request per lane: a caller can never overlap work in the same section.
    if (busy.has(lane)) return null;
    busy.add(lane);
    try {
      for (;;) {
        if (!live() || s.stopped || wanted <= 0) return null;
        const window = endAt() - Date.now() - SUGGESTION_TRANSPORT_MARGIN_MS;
        // Measured pacing: a window that cannot return useful output is never sent (honest lane end).
        if (window < usefulWindowMs(s.perItemMs, Math.min(wanted, s.cap))) { s.stopped = true; s.shortWindow = true; return null; }
        const deadlineMs = Math.min(SUGGESTION_SERVER_DEADLINE_MS, window);
        let count = Math.max(1, Math.min(wanted, s.cap, o.maxCount));
        // Size the request to what the window can stream at this lane's measured pace.
        if (s.perItemMs) count = Math.max(1, Math.min(count, Math.floor((deadlineMs - SUGGESTION_STARTUP_MS) / s.perItemMs)));
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let handle: { controller: AbortController; reject: (e: unknown) => void } | undefined;
        const started = Date.now();
        s.attempts++;
        try {
          const call = o.send(build(count, deadlineMs), controller.signal);
          call.catch(() => {}); // a late rejection after the client deadline is never unhandled
          const reply = await Promise.race([call, new Promise<never>((_, reject) => {
            handle = { controller, reject }; inflight.add(handle);
            timer = setTimeout(() => { controller.abort(); reject(suggestionDeadlineError()); }, deadlineMs + SUGGESTION_TRANSPORT_MARGIN_MS);
          })]);
          if (closed || !o.isCurrent()) return null;
          s.latencies.push(Date.now() - started);
          const returned = Array.isArray(reply.suggestions) ? reply.suggestions.length : 0;
          if (returned > 0) s.perItemMs = (Date.now() - started) / returned;
          // A deadline-bounded partial reply sizes this lane's next request to what fit.
          if (reply.partial) s.cap = Math.max(SUGGESTION_MIN_COUNT, Math.min(s.cap, reply.suggestions.length));
          return { suggestions: Array.isArray(reply.suggestions) ? reply.suggestions : [], partial: !!reply.partial };
        } catch (error) {
          if (closed || error === CLOSED || !o.isCurrent()) return null;
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
          if (handle) inflight.delete(handle);
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
    /** Requests currently awaiting a reply (one per lane at most). */
    get inFlight() { return busy.size; },
    /** End the phase: abort in-flight requests (their late replies are ignored) and send nothing further. */
    close() { closed = true; for (const f of [...inflight]) { f.controller.abort(); f.reject(CLOSED); } inflight.clear(); },
  };
}
