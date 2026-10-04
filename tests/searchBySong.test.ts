import { describe, it, expect } from "vitest";
import { searchLibraryBySong, matchSong, type VdjLibrary } from "../src/lib/virtualDj";
const lib = { tracks: [
  { artist: "Journey", title: "Don't Stop Believin'", path: "a/journey.mp3" },
  { artist: "Queen", title: "Don't Stop Me Now", path: "a/queen.mp3" },
] } as unknown as VdjLibrary;
describe("artist-aware card search", () => {
  it("ranks the file whose artist and title both match first", () => {
    expect(searchLibraryBySong("Queen", "Dont Stop Me Now", lib, 5)[0].i).toBe(1);
  });
  it("re-matching a corrected name finds the file", () => {
    expect(matchSong({ artist: "Journey", song: "Dont Stop Believin" } as never, lib).trackIndex).toBe(0);
  });
});
