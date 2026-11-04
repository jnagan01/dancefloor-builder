import { describe, expect, it } from "vitest";
import { classifyVersions, sameWork } from "../src/lib/prep/versionIdentity";

const f = (filePath: string, artist: string, title: string, remix?: string) => ({ filePath, artist, title, ...(remix ? { remix } : {}) });

describe("Versions in your library: conservative same-work identity", () => {
  it("drops fuzzy title-word matches from other artists (observed Chasing Cars case)", () => {
    const sel = f("/m/a/Snow Patrol - Chasing Cars.mp3", "Snow Patrol", "Chasing Cars");
    const v = classifyVersions("Snow Patrol", "Chasing Cars", sel, [
      f("/m/b/Tiesto - Chasing Summers.mp3", "Tiësto", "Chasing Summers"),
      f("/m/b/Walking On Cars - Speeding Cars.mp3", "Walking On Cars", "Speeding Cars"),
      f("/m/b/Alma - Chasing Highs.mp3", "ALMA", "Chasing Highs"),
    ]);
    expect(v.selected).toEqual({ track: sel, sameWork: true });
    expect(v.versions).toEqual([]);
    expect(v.hidden).toBe(3);
  });
  it("keeps clean/radio, remix, live and acoustic of the same song as distinct variants", () => {
    const v = classifyVersions("Snow Patrol", "Chasing Cars", undefined, [
      f("/1.mp3", "Snow Patrol", "Chasing Cars (Clean)"),
      f("/2.mp3", "Snow Patrol", "Chasing Cars (Radio Edit)"),
      f("/3.mp3", "Snow Patrol", "Chasing Cars", "Live at Brixton"),
      f("/4.mp3", "Snow Patrol", "Chasing Cars - Acoustic Version"),
      f("/5.mp3", "Snow Patrol", "Chasing Cars (Hardwell Remix)"),
    ]);
    expect(v.versions.map(x => [x.track.filePath, x.variant])).toEqual([["/1.mp3", false], ["/2.mp3", false], ["/3.mp3", true], ["/4.mp3", true], ["/5.mp3", true]]);
  });
  it("same artist other track, covers, similar words and missing metadata are not versions", () => {
    expect(sameWork("Snow Patrol", "Chasing Cars", "Snow Patrol", "Run")).toBe(false);
    expect(sameWork("Snow Patrol", "Chasing Cars", "Boyce Avenue", "Chasing Cars")).toBe(false);
    expect(sameWork("Snow Patrol", "Chasing Cars", "Snow Patrol", "Chasing Cars Again")).toBe(false);
    expect(sameWork("Snow Patrol", "Chasing Cars", "", "Chasing Cars")).toBe(false);
    expect(sameWork("Snow Patrol", "Chasing Cars", "Snow Patrol", "")).toBe(false);
  });
  it("featured credits and reordered collaborator sets match; band names are not split", () => {
    expect(sameWork("Mark Ronson feat. Bruno Mars", "Uptown Funk", "Mark Ronson", "Uptown Funk (feat. Bruno Mars)")).toBe(true);
    expect(sameWork("Mark Ronson feat. Bruno Mars", "Uptown Funk", "Bruno Mars & Mark Ronson", "Uptown Funk")).toBe(true);
    expect(sameWork("Earth, Wind & Fire", "September", "Fire", "September")).toBe(false);
  });
  it("shows an unrelated or untitled selected file but never blesses it as a version", () => {
    const wrong = f("/x.mp3", "Tiësto", "Chasing Summers");
    expect(classifyVersions("Snow Patrol", "Chasing Cars", wrong, []).selected?.sameWork).toBe(false);
    expect(classifyVersions("Snow Patrol", "Chasing Cars", f("/u.mp3", "", ""), []).selected?.sameWork).toBe(false);
  });
  it("same basename in different roots stays two files; exact duplicates of the selected path are skipped", () => {
    const sel = f("/A/Chasing Cars.mp3", "Snow Patrol", "Chasing Cars");
    const v = classifyVersions("Snow Patrol", "Chasing Cars", sel, [sel, f("/B/Chasing Cars.mp3", "Snow Patrol", "Chasing Cars"), f("/b/Chasing Cars.mp3", "Snow Patrol", "Chasing Cars")]);
    expect(v.versions.map(x => x.track.filePath)).toEqual(["/B/Chasing Cars.mp3", "/b/Chasing Cars.mp3"]);
  });
  it("repeated identical titles by different artists stay separate", () => {
    const v = classifyVersions("Whitney Houston", "I Will Always Love You", undefined, [f("/d.mp3", "Dolly Parton", "I Will Always Love You"), f("/w.mp3", "Whitney Houston", "I Will Always Love You")]);
    expect(v.versions.map(x => x.track.filePath)).toEqual(["/w.mp3"]);
    expect(v.hidden).toBe(1);
  });
});
