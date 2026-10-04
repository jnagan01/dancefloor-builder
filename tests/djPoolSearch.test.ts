import { describe, it, expect } from "vitest";
import { normalizeText } from "@/lib/matchCore";
import { buildLibrary, searchLibrary, findTrackForPickedFile } from "@/lib/virtualDj";

describe("DJ pool tolerant search", () => {
  it("strips pool tags, track numbers and featuring", () => {
    expect(normalizeText("01 - Levels ft. Someone (DMS) [BPM Supreme]")).toBe("levels");
  });
  it("finds a file by its file name", () => {
    const lib = buildLibrary([{ filePath: "/Music/03 Avicii - Levels (DJcity Intro).mp3", artist: "", title: "Track 3" } as any]);
    expect(searchLibrary("Avicii Levels", lib)).toEqual([0]);
  });
  it("reuses a picked file already in the library", () => {
    const lib = buildLibrary([{ filePath: "/Music/song.mp3", fileSize: "100", artist: "A", title: "B" } as any]);
    expect(findTrackForPickedFile(lib, "song.mp3", 100)).toBe(0);
    expect(findTrackForPickedFile(lib, "other.mp3", 100)).toBe(-1);
  });
});
