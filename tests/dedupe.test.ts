import { describe, it, expect } from "vitest";
import {
  SongKeySet,
  dedupeSongs,
  generateLists,
  reorderForEnergyProgression,
  topUpSectionsFromLibrary,
  dedupeKey,
} from "../src/lib/danceFloor";

describe("duplicate detection", () => {
  it("treats credit-order and featured-artist variants as the same song", () => {
    const set = new SongKeySet();
    set.add("Mark Ronson feat. Bruno Mars", "Uptown Funk");
    expect(set.has("Bruno Mars", "Uptown Funk!")).toBe(true);
    expect(set.has("Bruno Mars & Mark Ronson", "Uptown Funk (Radio Edit)")).toBe(true);
    expect(set.has("Bruno Mars", "24K Magic")).toBe(false);
  });

  it("ignores a leading 'The'", () => {
    const set = new SongKeySet();
    set.add("The Killers", "Mr. Brightside");
    expect(set.has("Killers", "Mr Brightside")).toBe(true);
  });

  it("dedupeSongs collapses variants", () => {
    const out = dedupeSongs([
      { artist: "Beyoncé feat. Jay-Z", song: "Crazy in Love" },
      { artist: "Beyonce", song: "Crazy In Love" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("final lists never contain the same song twice after top-up", () => {
    const uploads = Array.from({ length: 6 }, (_, i) => ({ artist: `A${i}`, song: `Peak ${i}` }));
    const prefs = { artists: [], genres: [], decades: [], notes: "", doNotPlay: [] };
    const g = generateLists({ uploaded: uploads, prefs, hours: 4, expand: false });
    const topped = topUpSectionsFromLibrary(reorderForEnergyProgression(g), prefs);
    const keys = [...topped.warmUp, ...topped.transition, ...topped.peak].map((s) => dedupeKey(s.artist, s.song));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
