import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPublishedBuild, parsePublishedBuild, describeResult, VERSION_ENDPOINT } from "@/lib/webVersion";

const A = "2026-11-02T18:04:19.298Z.aaaaaaaa-1111-4111-8111-111111111111";
const B = "2026-11-02T18:04:19.298Z.bbbbbbbb-2222-4222-8222-222222222222";
const body = (buildId: string, version = "1.1.0") => ({ buildId, buildTime: "2026-11-02T18:04:19.298Z", version });
const ok = (json: unknown) => vi.fn(async () => new Response(JSON.stringify(json), { status: 200 }));
const run = (fetchImpl: unknown, extra: object = {}) =>
  checkPublishedBuild({ loadedBuildId: A, origin: "https://x.test", fetchImpl: fetchImpl as typeof fetch, ...extra });

afterEach(() => vi.useRealTimers());

describe("loaded vs published web build", () => {
  it("stale loaded A vs published B with same version and same build time is reported as different", async () => {
    const r = await run(ok(body(B)));
    expect(r.kind).toBe("different");
    expect(describeResult(r)).toMatch(/different web version/);
  });
  it("same build id is current", async () => {
    expect((await run(ok(body(A)))).kind).toBe("current");
  });
  it("requests the same-origin endpoint, cache-busted and no-store, each time unique", async () => {
    const f = ok(body(A));
    await run(f);
    await run(f);
    const [u1, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const [u2] = f.mock.calls[1] as unknown as [string];
    expect(u1.startsWith(`https://x.test${VERSION_ENDPOINT}?t=`)).toBe(true);
    expect(u1).not.toBe(u2);
    expect(init.cache).toBe("no-store");
  });
  it.each([
    ["http 500", vi.fn(async () => new Response("x", { status: 500 })), "http"],
    ["html instead of json", vi.fn(async () => new Response("<html>", { status: 200 })), "malformed"],
    ["missing buildId", ok({ buildTime: "2026-11-02T00:00:00Z", version: "1.1.0" }), "malformed"],
    ["bad date", ok({ buildId: B, buildTime: "nope", version: "1.1.0" }), "malformed"],
    ["array", ok([]), "malformed"],
    ["offline", vi.fn(async () => { throw new TypeError("Failed to fetch"); }), "offline"],
  ])("%s never claims up to date", async (_n, f, reason) => {
    const r = await run(f);
    expect(r).toEqual({ kind: "unverified", reason });
    expect(describeResult(r)).not.toMatch(/running the published/);
  });
  it("times out without claiming up to date", async () => {
    vi.useFakeTimers();
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = run(hang, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p).toEqual({ kind: "unverified", reason: "timeout" });
  });
  it("caller abort (unmount / repeated click) is reported as aborted, not current", async () => {
    const c = new AbortController();
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = run(hang, { signal: c.signal });
    c.abort();
    expect(await p).toEqual({ kind: "unverified", reason: "aborted" });
  });
  it("an unstamped loaded build cannot be current and does not fetch", async () => {
    const f = ok(body(A));
    expect(await checkPublishedBuild({ loadedBuildId: null, origin: "https://x.test", fetchImpl: f as unknown as typeof fetch })).toEqual({ kind: "unverified", reason: "unstamped" });
    expect(f).not.toHaveBeenCalled();
  });
  it("parser rejects too-short ids", () => {
    expect(parsePublishedBuild({ buildId: "x", buildTime: "2026-01-01T00:00:00Z", version: "1" })).toBeNull();
  });
});
