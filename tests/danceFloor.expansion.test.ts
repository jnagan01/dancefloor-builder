import { describe, it, expect } from "vitest";
import { generateLists, dedupeKey, SECTION_BUFFER, type Song } from "@/lib/danceFloor";
import { SONG_LIBRARY } from "@/lib/songLibrary";

function fabricated(count: number, titleHint: string, prefix: string): Song[] {
  return Array.from({ length: count }, (_, i) => ({
    artist: `${prefix} Artist ${i}`,
    song: `${titleHint} Track ${i}`,
  }));
}

const basePrefs = { artists: [], genres: [], decades: [], notes: "" };

describe("generateLists buffered targets", () => {
  it("computes perSectionTarget as 2× the base per-section need", () => {
    const r = generateLists({ uploaded: [], prefs: basePrefs, hours: 2, expand: false });
    const base = Math.ceil((2 * 15) / 3);
    expect(r.perSectionBase).toBe(base);
    expect(r.perSectionTarget).toBe(Math.ceil(base * SECTION_BUFFER));
  });

  it("expansion pads each section up to the buffered target", () => {
    const uploaded = fabricated(3, "slow love", "Mellow");
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: true });
    expect(r.warmUp.length).toBeGreaterThanOrEqual(r.perSectionTarget);
    expect(r.transition.length).toBeGreaterThanOrEqual(r.perSectionTarget);
    expect(r.peak.length).toBeGreaterThanOrEqual(r.perSectionTarget);
    expect(r.shortfall.total).toBeGreaterThan(0); // shortfall reflects uploads only
  });

  it("expand off + uploads below buffer reports positive shortfall per section", () => {
    const uploaded = fabricated(3, "slow love", "Mellow");
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 2, expand: false });
    expect(r.shortfall.warmUp + r.shortfall.transition + r.shortfall.peak).toBe(r.shortfall.total);
    expect(r.shortfall.total).toBeGreaterThan(0);
  });

  it("expand off does not add library songs", () => {
    const uploaded = fabricated(9, "midtempo", "Mid");
    const uploadedKeys = new Set(uploaded.map((s) => dedupeKey(s.artist, s.song)));
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: false });
    for (const list of [r.warmUp, r.transition, r.peak]) {
      for (const s of list) {
        expect(uploadedKeys.has(dedupeKey(s.artist, s.song))).toBe(true);
      }
    }
  });

  it("respects doNotPlay during expansion", () => {
    const blocked = SONG_LIBRARY.find((l) => l.section === "Peak")!;
    const r = generateLists({
      uploaded: [],
      prefs: { ...basePrefs, doNotPlay: [{ artist: blocked.artist, song: blocked.song }] },
      hours: 1,
      expand: true,
    });
    const blockedKey = dedupeKey(blocked.artist, blocked.song);
    expect(r.peak.some((s) => dedupeKey(s.artist, s.song) === blockedKey)).toBe(false);
  });
});
