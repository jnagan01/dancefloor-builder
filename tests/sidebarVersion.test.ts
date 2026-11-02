import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSidebarVersion, NATIVE_VERSION_UNAVAILABLE } from "@/lib/sidebarVersion";
import { APP_VERSION } from "@/lib/appVersion";

const userAgent = "Mozilla/5.0 Chrome/130.0.0.0 SetArchitect/1.2.33 Electron/33.4.11 Safari/537.36";
afterEach(() => vi.useRealTimers());
describe("installed sidebar version", () => {
  it("shows installed 1.2.33, not available 1.2.34, through the existing release environment", async () => {
    const status = vi.fn(async () => ({ phase: "available", version: "1.2.34" }));
    expect(await resolveSidebarVersion({ userAgent, nativeBridge: true, status })).toBe("Version 1.2.33");
    expect(status).not.toHaveBeenCalled();
  });
  it("clearly labels the browser fallback", async () => {
    expect(await resolveSidebarVersion({ userAgent: "Mozilla/5.0 Chrome/130.0.0.0", nativeBridge: false })).toBe(`Web version ${APP_VERSION}`);
  });
  it("does not present web version as native when the bridge is missing", async () => {
    expect(await resolveSidebarVersion({ userAgent, nativeBridge: false })).toBe(NATIVE_VERSION_UNAVAILABLE);
  });
  it("never treats update status.version as installed", async () => {
    expect(await resolveSidebarVersion({ userAgent: "Electron/33.4.11", nativeBridge: true, status: async () => ({ version: "1.2.34" }) })).toBe(NATIVE_VERSION_UNAVAILABLE);
  });
  it("handles a rejected bridge without a false web fallback", async () => {
    expect(await resolveSidebarVersion({ userAgent: "Electron/33.4.11", nativeBridge: true, status: async () => { throw Error("IPC unavailable"); } })).toBe(NATIVE_VERSION_UNAVAILABLE);
  });
  it("supports asynchronous explicitly installed version, never latest version", async () => {
    expect(await resolveSidebarVersion({ userAgent: "Electron/33.4.11", nativeBridge: true, status: async () => ({ currentVersion: "1.2.33", version: "1.2.34" }) })).toBe("Version 1.2.33");
  });
  it("bounds an unresponsive bridge", async () => {
    vi.useFakeTimers();
    const result = resolveSidebarVersion({ userAgent: "Electron/33.4.11", nativeBridge: true, status: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe(NATIVE_VERSION_UNAVAILABLE);
  });
  it("rejects malformed native versions and handles older bridge without status", async () => {
    expect(await resolveSidebarVersion({ userAgent: "SetArchitect/invalid Electron/33.4.11", nativeBridge: true })).toBe(NATIVE_VERSION_UNAVAILABLE);
  });
});