/**
 * Loaded-versus-published web build comparison.
 *
 * The published identity comes from the same-origin /api/public/version
 * endpoint (served by the deployed worker bundle, no-store). Only an exact,
 * well-formed match counts as "current"; anything else is "different" or
 * "unverified" — never a false "up to date".
 */
export const VERSION_ENDPOINT = "/api/public/version";
export const VERSION_CHECK_TIMEOUT_MS = 10_000;

export type PublishedBuild = { buildId: string; buildTime: string; version: string };

export type WebVersionResult =
  | { kind: "current"; published: PublishedBuild }
  | { kind: "different"; published: PublishedBuild }
  | { kind: "unverified"; reason: "unstamped" | "http" | "malformed" | "offline" | "timeout" | "aborted" };

export function parsePublishedBuild(value: unknown): PublishedBuild | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const { buildId, buildTime, version } = v;
  if (typeof buildId !== "string" || buildId.length < 8 || buildId.length > 200) return null;
  if (typeof buildTime !== "string" || Number.isNaN(Date.parse(buildTime))) return null;
  if (typeof version !== "string" || version.length === 0 || version.length > 50) return null;
  return { buildId, buildTime, version };
}

export async function checkPublishedBuild(opts: {
  loadedBuildId: string | null;
  origin: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
}): Promise<WebVersionResult> {
  if (!opts.loadedBuildId) return { kind: "unverified", reason: "unstamped" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? VERSION_CHECK_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);
  try {
    if (opts.signal?.aborted) return { kind: "unverified", reason: "aborted" };
    const url = `${opts.origin}${VERSION_ENDPOINT}?t=${(opts.now ?? Date.now)()}-${Math.random().toString(36).slice(2)}`;
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "unverified", reason: "http" };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (timedOut) return { kind: "unverified", reason: "timeout" };
      if (opts.signal?.aborted) return { kind: "unverified", reason: "aborted" };
      return { kind: "unverified", reason: "malformed" };
    }
    const published = parsePublishedBuild(body);
    if (!published) return { kind: "unverified", reason: "malformed" };
    return published.buildId === opts.loadedBuildId ? { kind: "current", published } : { kind: "different", published };
  } catch {
    if (timedOut) return { kind: "unverified", reason: "timeout" };
    if (opts.signal?.aborted) return { kind: "unverified", reason: "aborted" };
    return { kind: "unverified", reason: "offline" };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }
}

export function describeResult(result: WebVersionResult): string {
  switch (result.kind) {
    case "current":
      return "You’re running the published web version.";
    case "different":
      return "A different web version has been published. Refresh the app (Cmd+R, or reload the page) to load it. Save or finish any open event first.";
    case "unverified":
      return {
        unstamped: "This copy has no build identity, so it can’t be compared. Refresh the app to load the published version.",
        http: "Couldn’t verify the published version (the server didn’t answer correctly). Try again shortly.",
        malformed: "Couldn’t verify the published version (unexpected response). Try again shortly.",
        offline: "Couldn’t check for updates. Check your internet connection and try again.",
        timeout: "The update check timed out. Check your connection and try again.",
        aborted: "The update check was cancelled.",
      }[result.reason];
  }
}
