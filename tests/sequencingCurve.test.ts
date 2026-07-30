import { describe, it, expect } from "vitest";
import {
  placementScore,
  tempoScore,
  targetCurve,
  applyPeakWave,
  applyVarietyReranker,
  buildGapProfile,
  intensityOf,
  reorderForEnergyProgression,
  type GenerationResult,
  type ResultSong,
} from "@/lib/danceFloor";

const mk = (
  artist: string,
  song: string,
  extras: Partial<ResultSong> = {},
): ResultSong => ({ artist, song, energy: 7, danceability: 7, ...extras });

describe("tempoScore", () => {
  it("maps BPM onto the 1-10 scale and halves double-time tags", () => {
    expect(tempoScore(80)).toBeCloseTo(1, 5);
    expect(tempoScore(140)).toBeCloseTo(10, 5);
    expect(tempoScore(120)).toBeGreaterThan(tempoScore(100)!);
    expect(tempoScore(174)).toBeCloseTo(tempoScore(87)!, 5);
    expect(tempoScore(undefined)).toBeUndefined();
  });
});

describe("placementScore", () => {
  it("matches raw intensity when only energy+danceability are known", () => {
    const s = { energy: 6, danceability: 6 };
    expect(placementScore(s)).toBeCloseTo(intensityOf(s), 5);
  });

  it("separates a euphoric track from a melancholy one at the same tempo", () => {
    const happy = placementScore({ energy: 7, danceability: 7, valence: 10, bpm: 128 });
    const sad = placementScore({ energy: 7, danceability: 7, valence: 2, bpm: 128 });
    expect(happy).toBeGreaterThan(sad);
  });

  it("nudges widely-known anthems later than obscure tracks", () => {
    const anthem = placementScore({ energy: 8, danceability: 8, popularity: 10 });
    const deepCut = placementScore({ energy: 8, danceability: 8, popularity: 2 });
    expect(anthem).toBeGreaterThan(deepCut);
  });
});

describe("targetCurve", () => {
  it("rises monotonically from warm-up level to peak level", () => {
    const total = 60;
    let prev = -Infinity;
    for (let i = 0; i < total; i++) {
      const t = targetCurve(i, total);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(targetCurve(0, total)).toBeLessThanOrEqual(5);
    expect(targetCurve(total - 1, total)).toBeGreaterThanOrEqual(9);
  });
});

describe("applyPeakWave", () => {
  const peak: ResultSong[] = Array.from({ length: 15 }, (_, i) =>
    mk(`Artist ${i}`, `Peak ${i}`, {
      energy: 8 + (i % 3) * 0.5,
      danceability: 8 + (i % 3) * 0.4,
      popularity: 6 + (i % 4),
    }),
  );

  it("keeps every track and adds recovery slots", () => {
    const out = applyPeakWave(peak);
    expect(out).toHaveLength(peak.length);
    expect(out.filter((s) => s.waveRole === "breather").length).toBeGreaterThan(0);
    const keys = new Set(out.map((s) => `${s.artist}|${s.song}`));
    expect(keys.size).toBe(peak.length);
  });

  it("never dips more than a bounded amount below the previous track", () => {
    const out = applyPeakWave(peak);
    for (let i = 1; i < out.length; i++) {
      const drop = intensityOf(out[i - 1]) - intensityOf(out[i]);
      expect(drop).toBeLessThanOrEqual(2.5);
    }
  });

  it("is a no-op for short peak lists", () => {
    const short = peak.slice(0, 4);
    expect(applyPeakWave(short)).toEqual(short);
  });
});

describe("rolling-window variety", () => {
  it("avoids stacking the same genre four in a row when alternatives exist", () => {
    const songs: ResultSong[] = [
      ...Array.from({ length: 6 }, (_, i) =>
        mk(`Rap ${i}`, `R${i}`, { genre: "Hip Hop", energy: 7, danceability: 7 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        mk(`Pop ${i}`, `P${i}`, { genre: "Pop", energy: 7, danceability: 7 }),
      ),
    ];
    const out = applyVarietyReranker(songs);
    for (let i = 3; i < out.length; i++) {
      const window = out.slice(i - 3, i + 1).map((s) => s.genre);
      const same = window.filter((g) => g === out[i].genre).length;
      expect(same).toBeLessThanOrEqual(3);
    }
  });

  it("breaks up long runs from one decade", () => {
    const songs: ResultSong[] = [
      ...Array.from({ length: 6 }, (_, i) =>
        mk(`Eighties ${i}`, `E${i}`, { year: 1985, genre: "Pop", energy: 7, danceability: 7 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        mk(`Tens ${i}`, `T${i}`, { year: 2015, genre: "Pop", energy: 7, danceability: 7 }),
      ),
    ];
    const out = applyVarietyReranker(songs);
    let run = 1;
    let longest = 1;
    for (let i = 1; i < out.length; i++) {
      run = out[i].year === out[i - 1].year ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(5);
  });
});

describe("placement reasoning", () => {
  it("attaches a why-here explanation to every song", () => {
    const result: GenerationResult = {
      warmUp: [mk("A", "w1", { energy: 4, danceability: 4 })],
      transition: [mk("B", "t1", { energy: 7, danceability: 7 })],
      peak: [mk("C", "p1", { energy: 10, danceability: 10 })],
      targetTotal: 3,
      perSectionTarget: 1,
      perSectionBase: 1,
      shortfall: { warmUp: 0, transition: 0, peak: 0, total: 0 },
      duplicatesRemoved: 0,
      blockedCount: 0,
    };
    const out = reorderForEnergyProgression(result);
    for (const s of [...out.warmUp, ...out.transition, ...out.peak]) {
      expect(typeof s.placementReason).toBe("string");
      expect(s.placementReason!.length).toBeGreaterThan(0);
      expect(s.placementReason).toContain("curve target");
    }
  });
});

describe("buildGapProfile", () => {
  const selected: ResultSong[] = [
    ...Array.from({ length: 8 }, (_, i) =>
      mk(`Rapper ${i}`, `Song ${i}`, { genre: "Hip Hop", year: 2015, bpm: 100 }),
    ),
    mk("Duo", "One", { genre: "Hip Hop", year: 2015, bpm: 100 }),
    mk("Duo", "Two", { genre: "Hip Hop", year: 2015, bpm: 100 }),
  ];

  it("flags over-represented genres and decades", () => {
    const gaps = buildGapProfile(selected, selected, "Transition");
    expect(gaps.overGenres).toContain("hip hop");
    expect(gaps.overDecades).toContain("2010s");
    expect(gaps.underGenres.length).toBeGreaterThan(0);
    expect(gaps.underDecades).toContain("1970s");
  });

  it("excludes artists already at the two-track cap", () => {
    const gaps = buildGapProfile(selected, selected, "Transition");
    expect(gaps.excludeArtists).toContain("Duo");
  });

  it("centers the tempo window on the section's current average", () => {
    const gaps = buildGapProfile(selected, selected, "Transition");
    expect(gaps.bpmMin).toBe(92);
    expect(gaps.bpmMax).toBe(108);
    expect(gaps.targetIntensity).toBeCloseTo(7.25, 5);
  });
});
