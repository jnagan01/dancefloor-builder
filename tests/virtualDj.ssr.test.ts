/**
 * SSR safety smoke test for src/lib/virtualDj.ts
 *
 * Imports the module in a Node context (no `window`, no DOM) and calls every
 * export that should be safe outside the browser. If any code path references
 * `window` / `document` / `navigator` unguarded at import or invocation time,
 * this script throws and exits non-zero.
 *
 * Run: bun tests/virtualDj.ssr.test.ts
 */

// Hard guarantee: the DOM globals the module must guard are NOT defined.
for (const name of ["window", "document", "localStorage"] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] !== "undefined") {
    throw new Error(`Test precondition failed: ${name} is defined in this runtime`);
  }
}

const mod = await import("../src/lib/virtualDj");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// 1. Pure helpers must work without a DOM.
const lib = mod.buildLibrary([
  {
    filePath: "/music/Artist - Song.mp3",
    artist: "Artist",
    title: "Song",
    fileSize: "1234",
  },
]);
assert(lib.tracks.length === 1, "buildLibrary returns indexed track");

const merged = mod.mergeLibraries([lib, lib]);
assert(merged.tracks.length >= 1, "mergeLibraries returns library");

const match = mod.matchSong({ artist: "Artist", song: "Song" }, merged);
assert(match.status === "Matched" || match.status === "Possible Match", `matchSong status ok: ${match.status}`);

const item = { artist: "Artist", song: "Song", match } as Parameters<typeof mod.buildVirtualDjXml>[0][number];
const xml = mod.buildVirtualDjXml([item], merged);
assert(xml.includes("<VirtualFolder"), "buildVirtualDjXml emits VirtualFolder");

const m3u = mod.buildM3u([item], merged);
assert(m3u.includes("/music/"), `buildM3u emits path: ${m3u}`);

// 1b. Building a library from raw audio files (no XML) must work and match.
const folderTracks = mod.tracksFromAudioFiles([
  { name: "Foo Bar - Hello World.mp3", size: 100, webkitRelativePath: "music/Foo Bar - Hello World.mp3" },
  { name: "notes.txt", size: 1 },
]);
assert(folderTracks.length === 1, `tracksFromAudioFiles filters non-audio: ${folderTracks.length}`);
assert(folderTracks[0].artist === "Foo Bar" && folderTracks[0].title === "Hello World", "filename parsed to artist/title");
const folderLib = mod.buildLibrary(folderTracks);
const fMatch = mod.matchSong({ artist: "Foo Bar", song: "Hello World" }, folderLib);
assert(fMatch.trackIndex === 0, `folder-derived library matches: ${fMatch.status}`);
const fXml = mod.buildVirtualDjXml(
  [{ artist: "Foo Bar", song: "Hello World", match: fMatch } as Parameters<typeof mod.buildVirtualDjXml>[0][number]],
  folderLib,
);
assert(fXml.includes("<song "), `folder export emits <song>: ${fXml}`);

// 2. Feature-detect helpers must return false (not throw) without a window.
assert(mod.supportsDirectoryWrite() === false, "supportsDirectoryWrite returns false on server");

// Note: parseVdjDatabaseXml uses DOMParser and pickXmlFiles/pickDirectoryFiles
// use document.createElement — these are only invoked from user-triggered file
// pickers (event handlers, client-only), so they are not exercised here.

console.log("✓ virtualDj.ts is SSR-safe");
