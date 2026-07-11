import { describe, expect, it } from "vitest";
import {
  applyVarietyReranker,
  reorderForEnergyProgression,
  type GenerationResult,
  type ResultSong,
} from "@/lib/danceFloor";
import { toCamelot, camelotDistance, bpmCloseness } from "@/lib/musicTheory";

const mk = (
  artist: string,
  song: string,
  energy: number,
  danceability: number,
  extras: Partial<ResultSong> = {},
): ResultSong => ({
  artist,
  song,
  energy,
  danceability,
  ...extras,
});

describe("applyVarietyReranker", () => {
  it("caps any single artist at 2 tracks and pushes overflow to the end", () => {
    const songs: ResultSong[] = [
      mk("A", "1", 5, 5),
      mk("A", "2", 5, 5),
      mk("A", "3", 5, 5), // overflow
      mk("B", "1", 6, 6),
      mk("C", "1", 7, 7),
    ];
    const out = applyVarietyReranker(songs, { artistCap: 2 });
    expect(out).toHaveLength(songs.length);
    // The 3rd "A" should be last (or near last) — overflow appended.
    expect(out[out.length - 1].artist).toBe("A");
    // Among the first 4, artist A appears at most twice.
    const firstFour = out.slice(0, 4);
    expect(firstFour.filter((s) => s.artist === "A").length).toBeLessThanOrEqual(2);
  });

  it("avoids back-to-back same artist when alternatives exist", () => {
    const songs: ResultSong[] = [
      mk("A", "1", 5, 5),
      mk("A", "2", 5, 5),
      mk("B", "1", 5, 5),
      mk("C", "1", 5, 5),
    ];
    const out = applyVarietyReranker(songs);
    for (let i = 1; i < out.length; i++) {
      // Allow same-artist only if everything left is from that artist.
      if (out[i].artist === out[i - 1].artist) {
        const remainingArtists = new Set(out.slice(i).map((s) => s.artist));
        expect(remainingArtists.size).toBe(1);
      }
    }
  });

  it("prefers small BPM jumps between neighbors", () => {
    const songs: ResultSong[] = [
      mk("A", "1", 7, 7, { bpm: 120 }),
      mk("B", "1", 7, 7, { bpm: 122 }),
      mk("C", "1", 7, 7, { bpm: 150 }), // far jump
    ];
    const out = applyVarietyReranker(songs);
    // The 150-BPM track should not be sandwiched between 120 and 122.
    const idx150 = out.findIndex((s) => s.bpm === 150);
    expect(idx150).toBe(out.length - 1);
  });

  it("drops near-identical duplicate entries", () => {
    const songs: ResultSong[] = [
      mk("A", "Hit", 5, 5),
      mk("A", "Hit", 5, 5),
      mk("B", "Other", 6, 6),
    ];
    const out = applyVarietyReranker(songs);
    expect(out).toHaveLength(2); // duplicate dropped, not appended
    const titles = out.map((s) => `${s.artist}|${s.song}`);
    expect(new Set(titles).size).toBe(2);
  });


  it("is a no-op for single song", () => {
    const songs = [mk("A", "1", 5, 5)];
    expect(applyVarietyReranker(songs)).toEqual(songs);
  });
});

describe("toCamelot / camelotDistance", () => {
  it("converts common musical keys", () => {
    expect(toCamelot("Am")).toBe("8A");
    expect(toCamelot("A minor")).toBe("8A");
    expect(toCamelot("C")).toBe("8B");
    expect(toCamelot("F#")).toBe("2B");
    expect(toCamelot("8A")).toBe("8A");
  });
  it("returns undefined for garbage", () => {
    expect(toCamelot("not a key")).toBeUndefined();
    expect(toCamelot("")).toBeUndefined();
    expect(toCamelot(undefined)).toBeUndefined();
  });
  it("camelot distance is 0 for identical, small for adjacent", () => {
    expect(camelotDistance("8A", "8A")).toBe(0);
    expect(camelotDistance("8A", "9A")).toBe(1);
    expect(camelotDistance("8A", "8B")).toBe(1); // relative
    expect(camelotDistance("8A", "2A")).toBeGreaterThanOrEqual(4);
  });
});

describe("bpmCloseness", () => {
  it("is 1 for same BPM, decreases with gap, 0 past 12%", () => {
    expect(bpmCloseness(120, 120)).toBe(1);
    expect(bpmCloseness(120, 125)).toBeGreaterThan(0.5);
    expect(bpmCloseness(120, 140)).toBe(0);
  });
});

describe("reorderForEnergyProgression preserves monotonic ramp after variety", () => {
  it("keeps overall energy roughly ascending across sections", () => {
    const make = (artist: string, song: string, e: number, d: number): ResultSong => ({
      artist,
      song,
      energy: e,
      danceability: d,
      fromUpload: true,
    });
    const result: GenerationResult = {
      warmUp: [
        make("A", "w1", 3, 4),
        make("B", "w2", 4, 5),
        make("C", "w3", 5, 5),
      ],
      transition: [
        make("D", "t1", 6, 7),
        make("E", "t2", 7, 7),
        make("F", "t3", 7, 8),
      ],
      peak: [
        make("G", "p1", 8, 8),
        make("H", "p2", 9, 9),
        make("I", "p3", 10, 9),
      ],
      targetTotal: 9,
      perSectionTarget: 3,
      perSectionBase: 3,
      shortfall: { warmUp: 0, transition: 0, peak: 0, total: 0 },
      duplicatesRemoved: 0,
      blockedCount: 0,
    };
    const out = reorderForEnergyProgression(result);
    const avg = (s: ResultSong) => ((s.energy ?? 0) + (s.danceability ?? 0)) / 2;
    const warmAvg = out.warmUp.reduce((a, s) => a + avg(s), 0) / out.warmUp.length;
    const transAvg =
      out.transition.reduce((a, s) => a + avg(s), 0) / out.transition.length;
    const peakAvg = out.peak.reduce((a, s) => a + avg(s), 0) / out.peak.length;
    expect(warmAvg).toBeLessThan(transAvg);
    expect(transAvg).toBeLessThan(peakAvg);
  });
});
