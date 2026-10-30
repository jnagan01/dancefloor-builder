import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { nativeScanProblem } from "../src/lib/nativeScanSafety";
const require = createRequire(import.meta.url);
const { scanFolder } = require("../desktop/scan.cjs");

const file = (name: string) => ({ name, isFile: () => true, isDirectory: () => false });
const folder = (name: string) => ({ name, isFile: () => false, isDirectory: () => true });
function mockFs(failure?: { operation: "stat" | "readdir"; target: string; code: string }) {
  const dirs: Record<string, unknown[]> = { "/music": [file("one.mp3"), folder("nested")], "/music/nested": [file("two.mp3")] };
  const readdir = vi.fn(async (target: string) => {
    if (failure?.operation === "readdir" && failure.target === target) throw Object.assign(new Error("mock"), { code: failure.code });
    return dirs[target] ?? [];
  });
  const stat = vi.fn(async (target: string) => {
    if (failure?.operation === "stat" && failure.target === target) throw Object.assign(new Error("mock"), { code: failure.code });
    return { size: 123, isDirectory: () => Boolean(dirs[target]) };
  });
  const tagCache = { get: vi.fn(() => ({ bpm: "120" })), flush: vi.fn(async () => {}) };
  return { fs: { promises: { readdir, stat } }, tagCache };
}
describe("atomic native scans (mocked filesystem only)", () => {
  for (const code of ["EACCES", "EPERM", "ENOENT"]) {
    for (const operation of ["stat", "readdir"] as const) {
      it.each(["/music", "/music/nested"])(`fails ${code} ${operation} at %s without a successful partial result`, async target => {
        const deps = mockFs({ operation, target, code });
        const result = await scanFolder("/music", deps);
        expect(result.ok).toBe(false);
        expect(result.complete).toBe(false);
        expect(result.files).toBeUndefined();
        expect(result.error).toContain("saved music index has been kept");
        expect(deps.tagCache.flush).not.toHaveBeenCalled();
      });
    }
    it(`fails audio-file stat ${code} after already finding one song`, async () => {
      const result = await scanFolder("/music", mockFs({ operation: "stat", target: "/music/nested/two.mp3", code }));
      expect(result.ok).toBe(false);
      expect(result.files).toBeUndefined();
    });
  }
  it("returns normal complete metadata scans", async () => {
    const deps = mockFs();
    const result = await scanFolder("/music", deps);
    expect(result.ok).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.files.map((f: { relativePath: string })=>f.relativePath)).toEqual(["music/one.mp3", "music/nested/two.mp3"]);
    expect(result.files[0]).toMatchObject({ size: 123, tags: { bpm: "120" } });
    expect(deps.tagCache.flush).toHaveBeenCalledTimes(1);
  });
  it("rejects scan cap overflow instead of reporting truncated success", async () => {
    const result = await scanFolder("/music", { ...mockFs(), maxFiles: 1 });
    expect(result.ok).toBe(false);
    expect(result.files).toBeUndefined();
    expect(result.error).toContain("scan limit");
  });
  it("accepts exactly the cap when traversal is complete", async () => {
    const result = await scanFolder("/music", { ...mockFs(), maxFiles: 2 });
    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(2);
  });
});

describe("source index replacement safety", () => {
  const savedTracks = [{ filePath: "music/saved.mp3", bpm: "120", playCount: 42 }];
  it.each([
    { ok: false, error: "EACCES" },
    { ok: false, error: "EPERM" },
    { ok: false, error: "ENOENT" },
    { ok: true, complete: false, files: [file("partial.mp3")] },
    { ok: true, truncated: true, files: [file("partial.mp3")] },
    { ok: true },
    { ok: true, complete: true, files: [] },
    { ok: true, files: [] }, // Old installed shell swallowed EACCES.
  ])("keeps saved tracks for unsuccessful/incomplete/unexpected empty scans: %j", result => {
    const problem = nativeScanProblem(result as never, savedTracks.length);
    const nextTracks = problem ? savedTracks : [];
    expect(problem).toBeTruthy();
    expect(nextTracks).toBe(savedTracks);
    expect(nextTracks[0]).toEqual({ filePath: "music/saved.mp3", bpm: "120", playCount: 42 });
  });
  it("accepts nonempty normal new-folder scans and legacy successful rescans", () => {
    const files = [{ name: "song.mp3", path: "/music/song.mp3", relativePath: "music/song.mp3" }];
    expect(nativeScanProblem({ ok: true, complete: true, files }, 0)).toBeNull();
    expect(nativeScanProblem({ ok: true, files }, 1)).toBeNull();
  });
  it("allows truly empty scans only when no nonempty index would be lost", () => {
    expect(nativeScanProblem({ ok: true, complete: true, files: [] }, 0)).toBeNull();
  });
});