import { describe, it, expect, vi, afterEach } from "vitest";
import { allocateSourceLabel, relabelScan, createIdentityIndex, trackIdentity, normalizeFilePath } from "@/lib/fileIdentity";
import { buildAudioIndex, resolveAudioFile } from "@/lib/audioMatch";
import { readNativeAudioFile, rememberNativeFilePath, getNativeFilePath, writeNativeTags } from "@/lib/desktopBridge";
import { buildLibrary, findTrackForPickedFile, folderForPath, resolveExportPath, tracksFromAudioFiles, buildM3u } from "@/lib/virtualDj";
import { metadataResolver, mergeTrackMetadata } from "@/lib/trackMetadataIdentity";

const roots = { Music: "/Volumes/A/Music", "Music (2)": "/Volumes/B/Music" };
const paths = ["Music/Song.mp3", "Music (2)/Song.mp3"];
function audio(path: string) {
  const f = new File([path], path.split("/").pop() ?? path);
  Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}
const track = (filePath: string, bpm?: string, key?: string, playCount?: number) => ({ filePath, artist: "Artist", title: "Song", bpm, key, playCount });
afterEach(() => vi.unstubAllGlobals());

describe("selected playback identity", () => {
  it("finds the requested exact file globally even when the first basename collides", () => {
    const a = audio(paths[0]), b = audio(paths[1]);
    const idx = buildAudioIndex([a, b], [], paths, roots);
    expect(resolveAudioFile(idx, { filePath: paths[1] })).toBe(b);
    expect(resolveAudioFile(idx, { filePath: "/Volumes/B/Music/Song.mp3" })).toBe(b);
  });
  it("never substitutes a cached sibling when a selected identity is offline", () => {
    const idx = buildAudioIndex([audio(paths[0])], [], paths, roots);
    expect(resolveAudioFile(idx, { filePath: paths[1], artist: "Artist", title: "Song" })).toBeUndefined();
    expect(resolveAudioFile(idx, { filePath: "Song.mp3" })).toBeUndefined();
  });
  it("refuses unknown qualified paths even with only one loaded basename", () => {
    expect(resolveAudioFile(buildAudioIndex([audio(paths[0])]), { filePath: "Elsewhere/Song.mp3" })).toBeUndefined();
  });
  it("allows a genuinely unique legacy basename", () => {
    const f = audio(paths[0]);
    expect(resolveAudioFile(buildAudioIndex([f], [], [paths[0]], roots), { filePath: "Song.mp3" })).toBe(f);
  });
  it("keeps case-only siblings distinct on case-sensitive volumes", () => {
    const lower = audio("Music/song.mp3"), upper = audio("Music/Song.mp3");
    const idx = buildAudioIndex([lower, upper], [], [], roots);
    expect(resolveAudioFile(idx, { filePath: "Music/Song.mp3" })).toBe(upper);
    expect(resolveAudioFile(idx, { filePath: "music/Song.mp3" })).toBeUndefined();
    expect(folderForPath("/volumes/A/Music/Song.mp3", roots)).toBeNull();
  });
  it("retains scored artist/title matching without selected identity", () => {
    const f = audio("Music/Avicii - Levels.mp3");
    expect(resolveAudioFile(buildAudioIndex([f]), { artist: "Avicii", title: "Levels" })).toBe(f);
  });
  it("native disk reads preserve exact identity instead of rematching by name", async () => {
    const readAudio = vi.fn(async () => ({ ok: true, data: new ArrayBuffer(4) }));
    vi.stubGlobal("window", { electronFiles: { isAvailable: true, readAudio } });
    const full = resolveExportPath(paths[1], roots);
    if (!full) throw new Error("Expected full path");
    const file = await readNativeAudioFile(full, paths[1]);
    expect(readAudio).toHaveBeenCalledWith("/Volumes/B/Music/Song.mp3");
    if (!file) throw new Error("Expected native file");
    expect(getNativeFilePath(file)).toBe(full);
    expect(resolveAudioFile(buildAudioIndex([audio(paths[0]), file], [], paths, roots), { filePath: paths[1] })).toBe(file);
  });
  it("picked-file selections and native tag writes resolve the intended full path", async () => {
    const lib = buildLibrary(paths.map(p => track(p)));
    expect(findTrackForPickedFile(lib, "Song.mp3", 4, "/Volumes/B/Music/Song.mp3", roots)).toBe(1);
    expect(findTrackForPickedFile(lib, "Song.mp3", 4, undefined, roots)).toBe(-1);
    expect(findTrackForPickedFile(lib, "Song.mp3", 4, "/Volumes/C/Music/Song.mp3", roots)).toBe(-1);
    const writeTags = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("window", { electronFiles: { isAvailable: true, writeTags } });
    const intended = resolveExportPath(lib.tracks[1].filePath, roots);
    if (!intended) throw new Error("Expected full path");
    await writeNativeTags(intended, { bpm: "128" });
    expect(writeTags).toHaveBeenCalledWith("/Volumes/B/Music/Song.mp3", { bpm: "128" });
  });
});

describe("stable folder labels", () => {
  it("allocates a distinct label without rebinding the old root", () => {
    expect(allocateSourceLabel("Music", "/Volumes/B/Music", ["Music"], { Music: roots.Music })).toBe("Music (2)");
    expect(resolveExportPath(paths[0], roots)).toBe("/Volumes/A/Music/Song.mp3");
  });
  it("reuses the same root after restart and does not duplicate it", () => {
    const restored = JSON.parse(JSON.stringify(roots));
    expect(allocateSourceLabel("Music", "/Volumes/B/Music/", Object.keys(restored), restored)).toBe("Music (2)");
    expect(allocateSourceLabel("Music", "/Volumes/A/Music", [], restored)).toBe("Music");
  });
  it("reserves removed roots and handles already suffixed folder names", () => {
    expect(allocateSourceLabel("Music", "/Volumes/C/Music", [], roots)).toBe("Music (3)");
    expect(allocateSourceLabel("Music (2)", null, [], roots)).toBe("Music (2) (2)");
  });
  it("does not silently replace an indistinguishable browser folder", () => {
    expect(allocateSourceLabel("Music", null, ["Music"], {})).toBe("Music (2)");
  });
  it("relabels native rescans and exports both folders to their real roots", () => {
    const scan = [{ name: "Song.mp3", relativePath: "Music/Song.mp3", path: "/Volumes/B/Music/Song.mp3" }];
    const renamed = relabelScan(scan, "Music (2)");
    expect(renamed[0].relativePath).toBe(paths[1]);
    expect(scan[0].relativePath).toBe(paths[0]);
    const lib = buildLibrary(tracksFromAudioFiles([{ name: "Song.mp3", webkitRelativePath: paths[0] }, ...renamed.map(f => ({ name: f.name, webkitRelativePath: f.relativePath }))]));
    expect(lib.tracks).toHaveLength(2);
    const m3u = buildM3u(lib.tracks.map((t, i) => ({ song: { artist: t.artist, song: t.title }, match: { status: "Matched" as const, confidence: 1, alternatives: [], trackIndex: i } })), lib, roots);
    expect(m3u).toContain("/Volumes/A/Music/Song.mp3");
    expect(m3u).toContain("/Volumes/B/Music/Song.mp3");
    expect(m3u).not.toContain("/Music/Music (2)/");
  });
  it("manual picks use the longest nested root and preserve virtual labels", () => {
    const nested = { ...roots, Nested: "/Volumes/B/Music/House" };
    expect(folderForPath("/Volumes/B/Music/House/Song.mp3", nested)).toEqual({ label: "Nested", relativePath: "Nested/Song.mp3" });
    expect(folderForPath("/Volumes/B/Music/Song.mp3", roots)).toEqual({ label: "Music (2)", relativePath: paths[1] });
    expect(resolveExportPath("Nested/Song.mp3", nested)).toBe("/Volumes/B/Music/House/Song.mp3");
  });
  it("old saved selections stay resolvable after removal/re-add and normalization", () => {
    const saved = { selectedPath: paths[0] };
    const restored = JSON.parse(JSON.stringify(roots));
    expect(trackIdentity(saved.selectedPath, restored)).toBe("/Volumes/A/Music/Song.mp3");
    expect(normalizeFilePath("/Volumes/A/Music/./House/../Song.mp3")).toBe("/Volumes/A/Music/Song.mp3");
    expect(resolveExportPath("Music/../Song.mp3", restored)).toBeNull();
  });
});

describe("VirtualDJ and rescan metadata identity", () => {
  it("never cross-copies BPM, key or plays for duplicate names", () => {
    const vdj = [track("/Volumes/A/Music/Song.mp3", "90", "1A", 10), track("/Volumes/B/Music/Song.mp3", "128", "9B", 20)];
    const local = paths.map(p => track(p));
    const resolver = metadataResolver(vdj, local, roots);
    expect(local.map(t => mergeTrackMetadata(t, resolver.resolve(t.filePath), true))).toEqual([
      expect.objectContaining({ filePath: paths[0], bpm: "90", key: "1A", playCount: 10 }),
      expect.objectContaining({ filePath: paths[1], bpm: "128", key: "9B", playCount: 20 }),
    ]);
  });
  it("retains metadata when the only VDJ file has a conflicting full path", () => {
    const local = track(paths[0], "105", "3A", 7);
    const resolver = metadataResolver([track("/Volumes/B/Music/Song.mp3", "128", "9B", 20)], [local], roots);
    expect(mergeTrackMetadata(local, resolver.resolve(local.filePath), true)).toBe(local);
  });
  it("rescan carry-forward uses exact subfolder identity", () => {
    const old = [track("Music/House/Song.mp3", "128", "9B", 20), track("Music/Slow/Song.mp3", "90", "1A", 10)];
    const resolver = metadataResolver(old, old, roots);
    expect(mergeTrackMetadata(track("Music/Slow/Song.mp3"), resolver.resolve("Music/Slow/Song.mp3"))).toMatchObject({ bpm: "90", key: "1A", playCount: 10 });
    expect(resolver.resolve("Music/New/Song.mp3")).toBeUndefined();
  });
  it("only supports globally unique legacy metadata, never known conflicting paths", () => {
    const vdj = [track(paths[0], "90")];
    expect(metadataResolver(vdj, [track("Song.mp3")], roots).resolve("Song.mp3")).toBeUndefined();
    expect(metadataResolver(vdj, [], roots).resolve("Song.mp3")?.bpm).toBe("90");
    expect(metadataResolver(vdj, [track(paths[1])], roots).resolve("Song.mp3")).toBeUndefined();
  });
  it("duplicate exact records fail safely rather than last-wins", () => {
    expect(createIdentityIndex([track(paths[0], "90"), track(paths[0], "128")], t => t.filePath, roots).resolve(paths[0])).toBeUndefined();
  });
  it("native cached files keep their path through wrapping", () => {
    const f = audio(paths[1]);
    rememberNativeFilePath(f, "/Volumes/B/Music/Song.mp3");
    expect(getNativeFilePath(f)).toBe("/Volumes/B/Music/Song.mp3");
  });
});