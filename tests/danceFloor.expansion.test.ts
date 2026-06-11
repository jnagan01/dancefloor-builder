import { describe, it, expect } from "vitest";
import { generateLists, dedupeKey, type Song } from "@/lib/danceFloor";
import { SONG_LIBRARY } from "@/lib/songLibrary";

const uploadedKeys = (songs: Song[]) =>
  new Set(songs.map((s) => dedupeKey(s.artist, s.song)));

function libraryAppearedIn(result: Song[], uploaded: Song[], section: "Warm Up" | "Transition" | "Peak") {
  const up = uploadedKeys(uploaded);
  const librarySectionKeys = new Set(
    SONG_LIBRARY.filter((l) => l.section === section).map((l) => dedupeKey(l.artist, l.song)),
  );
  return result.some((s) => {
    const k = dedupeKey(s.artist, s.song);
    return !up.has(k) && librarySectionKeys.has(k);
  });
}

function fabricated(count: number, titleHint: string, prefix: string): Song[] {
  return Array.from({ length: count }, (_, i) => ({
    artist: `${prefix} Artist ${i}`,
    song: `${titleHint} Track ${i}`,
  }));
}

const basePrefs = { artists: [], genres: [], decades: [], notes: "" };

describe("generateLists expansion", () => {
  it("adds Warm Up library songs even when uploads already meet the per-section target", () => {
    const uploaded = fabricated(30, "slow love forever", "Mellow");
    const result = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: true });
    expect(libraryAppearedIn(result.warmUp, uploaded, "Warm Up")).toBe(true);
  });

  it("adds Transition library songs even when uploads already meet the per-section target", () => {
    const uploaded = fabricated(30, "midtempo groove", "Mid");
    const result = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: true });
    expect(libraryAppearedIn(result.transition, uploaded, "Transition")).toBe(true);
  });

  it("adds Peak library songs even when uploads already meet the per-section target", () => {
    const uploaded = fabricated(30, "party dance fire", "Hype");
    const result = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: true });
    expect(libraryAppearedIn(result.peak, uploaded, "Peak")).toBe(true);
  });

  it("does not add library songs when expand is off (regression guard)", () => {
    const uploaded = [
      ...fabricated(10, "slow love", "Mellow"),
      ...fabricated(10, "midtempo", "Mid"),
      ...fabricated(10, "party dance fire", "Hype"),
    ];
    const result = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: false });
    expect(libraryAppearedIn(result.warmUp, uploaded, "Warm Up")).toBe(false);
    expect(libraryAppearedIn(result.transition, uploaded, "Transition")).toBe(false);
    expect(libraryAppearedIn(result.peak, uploaded, "Peak")).toBe(false);
  });

  it("respects doNotPlay during expansion even when uploads saturate the target", () => {
    const uploaded = fabricated(30, "party dance fire", "Hype");
    const blocked = SONG_LIBRARY.find((l) => l.section === "Peak")!;
    const result = generateLists({
      uploaded,
      prefs: { ...basePrefs, doNotPlay: [{ artist: blocked.artist, song: blocked.song }] },
      hours: 1,
      expand: true,
    });
    const blockedKey = dedupeKey(blocked.artist, blocked.song);
    expect(result.peak.some((s) => dedupeKey(s.artist, s.song) === blockedKey)).toBe(false);
  });
});
