import { describe, it, expect } from "vitest";
import { buildAudioIndex, resolveAudioMatch, resolveAudioFile } from "@/lib/audioMatch";
import { buildLibrary, matchSong, searchLibrary, type VdjTrack } from "@/lib/virtualDj";
import { parseTitle, scorePair, makeSubject } from "@/lib/matchCore";

function file(name: string, size = 1000): File {
  return new File([new Uint8Array(size)], name, { type: "audio/mpeg" });
}

function track(artist: string, title: string, path?: string): VdjTrack {
  return { artist, title, filePath: path || `C:/Music/${artist} - ${title}.mp3`, fileSize: "1000" };
}

describe("matchCore title parsing", () => {
  it("keeps the version tag separate from the base title", () => {
    const p = parseTitle("Levels (Club Mix)");
    expect(p.base).toBe("levels");
    expect(p.version).toContain("club");
  });

  it("folds featuring credits away without eating the title", () => {
    expect(parseTitle("Titanium (feat. Sia)").base).toBe("titanium");
    expect(parseTitle("Señorita").base).toBe("senorita");
  });

  it("penalizes a version mismatch without rejecting it", () => {
    const q = makeSubject("Avicii", "Levels");
    const original = scorePair(q, makeSubject("Avicii", "Levels"));
    const remix = scorePair(q, makeSubject("Avicii", "Levels (Club Mix)"));
    expect(original.score).toBeGreaterThan(remix.score);
    expect(remix.score).toBeGreaterThan(0.6);
  });
});

describe("local file resolution", () => {
  it("prefers the original over a remix when no version was requested", () => {
    const idx = buildAudioIndex([
      file("Avicii - Levels (Skrillex Remix).mp3"),
      file("Avicii - Levels.mp3"),
    ]);
    const hit = resolveAudioFile(idx, { artist: "Avicii", title: "Levels" });
    expect(hit?.name).toBe("Avicii - Levels.mp3");
  });

  it("picks the remix when the remix was requested", () => {
    const idx = buildAudioIndex([
      file("Avicii - Levels.mp3"),
      file("Avicii - Levels (Skrillex Remix).mp3"),
    ]);
    const hit = resolveAudioFile(idx, { artist: "Avicii", title: "Levels (Skrillex Remix)" });
    expect(hit?.name).toBe("Avicii - Levels (Skrillex Remix).mp3");
  });

  it("resolves accents, punctuation and featuring variants", () => {
    const idx = buildAudioIndex([file("Shawn Mendes - Senorita (feat. Camila Cabello).mp3")]);
    const hit = resolveAudioFile(idx, { artist: "Shawn Mendes", title: "Señorita" });
    expect(hit).toBeDefined();
  });

  it("tolerates a small typo", () => {
    const idx = buildAudioIndex([file("Bruno Mars - Uptown Funk.mp3")]);
    expect(resolveAudioFile(idx, { artist: "Bruno Mars", title: "Uptwon Funk" })).toBeDefined();
  });

  it("does not match a song title against an unrelated artist-named file", () => {
    const idx = buildAudioIndex([file("Chicago - Hard To Say I'm Sorry.mp3")]);
    const hit = resolveAudioFile(idx, { artist: "Sufjan Stevens", title: "Chicago" });
    expect(hit).toBeUndefined();
  });

  it("is deterministic across index orderings", () => {
    const a = file("Artist - Song.mp3", 1000);
    const b = file("Artist - Song.mp3", 5000);
    const one = resolveAudioMatch(buildAudioIndex([a, b]), { artist: "Artist", title: "Song" });
    const two = resolveAudioMatch(buildAudioIndex([b, a]), { artist: "Artist", title: "Song" });
    expect(one?.file.size).toBe(two?.file.size);
  });

  it("returns a confidence score and exact flag", () => {
    const idx = buildAudioIndex([file("Avicii - Levels.mp3")]);
    const m = resolveAudioMatch(idx, { artist: "Avicii", title: "Levels", filePath: "D:/x/Avicii - Levels.mp3" });
    expect(m?.exact).toBe(true);
    expect(m?.score).toBe(1);
  });
});

describe("library matching", () => {
  const lib = buildLibrary([
    track("Avicii", "Levels"),
    track("Avicii", "Levels (Skrillex Remix)"),
    track("Whitney Houston", "I Wanna Dance With Somebody"),
    track("Earth, Wind & Fire", "September"),
  ]);

  it("matches a track whose artist is misspelled in the playlist", () => {
    const m = matchSong({ artist: "Whitny Huston", song: "I Wanna Dance With Somebody" }, lib);
    expect(m.trackIndex).toBe(2);
    expect(m.status === "Matched" || m.status === "Possible Match").toBe(true);
  });

  it("handles ampersand/and artist variants", () => {
    const m = matchSong({ artist: "Earth Wind and Fire", song: "September" }, lib);
    expect(m.trackIndex).toBe(3);
  });

  it("prefers the non-remix and offers the remix as an alternative", () => {
    const m = matchSong({ artist: "Avicii", song: "Levels" }, lib);
    expect(m.trackIndex).toBe(0);
    expect(m.alternatives).toContain(1);
  });

  it("reports missing tracks", () => {
    const m = matchSong({ artist: "Nobody", song: "Completely Unknown Tune" }, lib);
    expect(m.status).toBe("Missing From Library");
  });

  it("search returns ranked results", () => {
    const res = searchLibrary("september", lib, 5);
    expect(res[0]).toBe(3);
  });
});
