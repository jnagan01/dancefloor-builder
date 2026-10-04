import { describe, it, expect } from "vitest";
import { folderForPath } from "@/lib/virtualDj";

const roots = { "!! MY MUSIC !!": "/Users/joe/Music/!! MY MUSIC !!" };

describe("picked file folder detection", () => {
  it("assigns a file inside a connected folder to that folder", () => {
    expect(folderForPath("/Users/joe/Music/!! MY MUSIC !!/Top 40/Song.mp3", roots))
      .toEqual({ label: "!! MY MUSIC !!", relativePath: "!! MY MUSIC !!/Top 40/Song.mp3" });
  });
  it("returns null for files outside every connected folder", () => {
    expect(folderForPath("/Users/joe/Downloads/Song.mp3", roots)).toBeNull();
    expect(folderForPath("/Users/joe/Music/!! MY MUSIC !! old/Song.mp3", roots)).toBeNull();
  });
});
