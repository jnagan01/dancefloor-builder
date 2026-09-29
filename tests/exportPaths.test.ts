import { describe, it, expect } from "vitest";
import { resolveExportPath as rep } from "../src/lib/virtualDj";
describe("resolveExportPath", () => {
  const roots = { "!! MY MUSIC !!": "/Users/joenagan/Music/!! MY MUSIC !!/" };
  it("joins folder location without duplicating the folder name", () => {
    expect(rep("!! MY MUSIC !!/House/Song.mp3", roots)).toBe("/Users/joenagan/Music/!! MY MUSIC !!/House/Song.mp3");
    expect(rep("!! MY MUSIC !!/song name.mp3", roots)).toBe("/Users/joenagan/Music/!! MY MUSIC !!/song name.mp3");
  });
  it("keeps absolute paths and returns null when unknown", () => {
    expect(rep("/a/b.mp3", roots)).toBe("/a/b.mp3");
    expect(rep("C:\\Music\\b.mp3", roots)).toBe("C:\\Music\\b.mp3");
    expect(rep("Other/b.mp3", roots)).toBeNull();
  });
  it("uses backslashes for Windows roots", () => {
    expect(rep("Mix/a.mp3", { Mix: "D:\\DJ\\Mix" })).toBe("D:\\DJ\\Mix\\a.mp3");
  });
});
