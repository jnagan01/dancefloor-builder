import { describe, it, expect } from "vitest";
import {
  generateLists,
  inferAudienceFit,
  sectionScores,
  dedupeKey,
  intensityOf,
  sectionForIntensity,
  reorderForEnergyProgression,
  type Song,
  type ResultSong,
} from "@/lib/danceFloor";

const basePrefs = { artists: [], genres: [], decades: [], notes: "" };

function findSection(
  r: ReturnType<typeof generateLists>,
  artist: string,
  song: string,
): "Warm Up" | "Transition" | "Peak" | null {
  const k = dedupeKey(artist, song);
  if (r.warmUp.some((s) => dedupeKey(s.artist, s.song) === k)) return "Warm Up";
  if (r.transition.some((s) => dedupeKey(s.artist, s.song) === k)) return "Transition";
  if (r.peak.some((s) => dedupeKey(s.artist, s.song) === k)) return "Peak";
  return null;
}

describe("audience-fit inference (helper still used for legacy code paths)", () => {
  it("tags pre-1990 disco/soul/funk as older-friendly", () => {
    expect(inferAudienceFit("1970s", "Disco")).toBe("older");
    expect(inferAudienceFit("1960s", "Soul")).toBe("older");
    expect(inferAudienceFit("1980s", "Pop")).toBe("older");
  });

  it("tags modern clean pop as younger-friendly", () => {
    expect(inferAudienceFit("2020s", "Pop")).toBe("younger");
    expect(inferAudienceFit("2010s", "Pop")).toBe("younger");
  });

  it("tags EDM/Hip Hop as adult", () => {
    expect(inferAudienceFit("2010s", "EDM")).toBe("adult");
    expect(inferAudienceFit("2000s", "Hip Hop")).toBe("adult");
  });
});

describe("intensity-based section assignment", () => {
  it("bucket bands: low intensity → Warm Up, mid → Transition, high → Peak", () => {
    expect(sectionForIntensity(4)).toBe("Warm Up");
    expect(sectionForIntensity(6.5)).toBe("Warm Up");
    expect(sectionForIntensity(7)).toBe("Transition");
    expect(sectionForIntensity(7.5)).toBe("Transition");
    expect(sectionForIntensity(8)).toBe("Peak");
    expect(sectionForIntensity(9)).toBe("Peak");
  });

  it("intensityOf is the mean of energy and danceability", () => {
    expect(intensityOf({ energy: 8, danceability: 6 })).toBe(7);
    expect(intensityOf({ energy: 10, danceability: 10 })).toBe(10);
  });

  it("places a high-energy adult EDM track into Peak", () => {
    const r = generateLists({
      uploaded: [{ artist: "The Weeknd", song: "Blinding Lights" }],
      prefs: basePrefs,
      hours: 1,
      expand: false,
    });
    expect(findSection(r, "The Weeknd", "Blinding Lights")).toBe("Peak");
  });

  it("places a soft ballad-leaning song into Warm Up", () => {
    const r = generateLists({
      uploaded: [{ artist: "Bill Withers", song: "Lovely Day" }],
      prefs: basePrefs,
      hours: 1,
      expand: false,
    });
    expect(findSection(r, "Bill Withers", "Lovely Day")).toBe("Warm Up");
  });

  it("places EDM/Hip Hop uploads into Peak, not Warm Up", () => {
    const uploaded: Song[] = [
      { artist: "Pitbull", song: "Timber" },
      { artist: "LMFAO", song: "Party Rock Anthem" },
      { artist: "Usher", song: "Yeah!" },
      { artist: "David Guetta", song: "Titanium" },
      { artist: "Calvin Harris", song: "Summer" },
    ];
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: false });
    for (const s of uploaded) {
      expect(findSection(r, s.artist, s.song)).not.toBe("Warm Up");
    }
  });
});

describe("sectionScores (legacy heuristic still exported)", () => {
  it("favors Warm Up for low-energy older-friendly songs", () => {
    const s = sectionScores(5, 6, "older");
    expect(s["Warm Up"]).toBeGreaterThan(s.Peak);
  });

  it("favors Peak for high-energy adult songs", () => {
    const s = sectionScores(9, 9, "adult");
    expect(s.Peak).toBeGreaterThan(s["Warm Up"]);
    expect(s.Peak).toBeGreaterThan(s.Transition);
  });
});

describe("energy progression across the generated set", () => {
  const mix: Song[] = [
    { artist: "Bill Withers", song: "Lovely Day" }, // ~5.5
    { artist: "Van Morrison", song: "Brown Eyed Girl" }, // ~5.5
    { artist: "The Temptations", song: "My Girl" }, // ~5.5
    { artist: "Harry Styles", song: "As It Was" }, // ~6.5 → Transition
    { artist: "Earth, Wind & Fire", song: "September" }, // ~8 → Peak
    { artist: "ABBA", song: "Dancing Queen" }, // ~8 → Peak
    { artist: "Bee Gees", song: "Stayin' Alive" }, // ~8 → Peak
    { artist: "The Weeknd", song: "Blinding Lights" }, // ~9 → Peak
    { artist: "Pitbull", song: "Timber" },
    { artist: "LMFAO", song: "Party Rock Anthem" },
  ];

  it("each section is sorted ascending by intensity", () => {
    const r = generateLists({ uploaded: mix, prefs: basePrefs, hours: 2, expand: false });
    for (const list of [r.warmUp, r.transition, r.peak]) {
      for (let i = 1; i < list.length; i++) {
        expect(intensityOf(list[i])).toBeGreaterThanOrEqual(intensityOf(list[i - 1]));
      }
    }
  });

  it("the full warm-up → transition → peak set is a non-decreasing energy ramp", () => {
    const r = generateLists({ uploaded: mix, prefs: basePrefs, hours: 2, expand: false });
    const full = [...r.warmUp, ...r.transition, ...r.peak];
    for (let i = 1; i < full.length; i++) {
      expect(intensityOf(full[i])).toBeGreaterThanOrEqual(intensityOf(full[i - 1]));
    }
  });

  it("reorderForEnergyProgression interleaves AI-style picks into the ramp", () => {
    const r = generateLists({ uploaded: mix, prefs: basePrefs, hours: 2, expand: false });
    // Pretend an AI suggestion landed in the wrong bucket with full score data.
    r.warmUp.push({
      artist: "Made Up Banger",
      song: "Peak Test",
      fromUpload: false,
      energy: 10,
      danceability: 10,
      popularity: 8,
      valence: 9,
    });
    const fixed = reorderForEnergyProgression(r);
    expect(findSection(fixed, "Made Up Banger", "Peak Test")).toBe("Peak");
    const full = [...fixed.warmUp, ...fixed.transition, ...fixed.peak];
    for (let i = 1; i < full.length; i++) {
      expect(intensityOf(full[i])).toBeGreaterThanOrEqual(intensityOf(full[i - 1]));
    }
  });

  it("library expansion preserves the ramp across every section", () => {
    const r = generateLists({ uploaded: [], prefs: basePrefs, hours: 1, expand: true });
    const full = [...r.warmUp, ...r.transition, ...r.peak];
    expect(full.length).toBeGreaterThan(0);
    for (let i = 1; i < full.length; i++) {
      expect(intensityOf(full[i])).toBeGreaterThanOrEqual(intensityOf(full[i - 1]));
    }
  });
});

describe("era + explicit placement bias", () => {
  const perSectionTarget = 4;
  const baseResult = () => ({
    warmUp: [] as any[],
    transition: [] as any[],
    peak: [] as any[],
    targetTotal: perSectionTarget * 3,
    perSectionTarget,
    perSectionBase: perSectionTarget,
    shortfall: { warmUp: 0, transition: 0, peak: 0, total: 0 },
    duplicatesRemoved: 0,
    blockedCount: 0,
  });

  it("pushes a mid-intensity pre-1990 disco track into Warm Up (not Peak)", () => {
    // A high-energy 70s disco track (raw intensity 8) would normally sit in
    // Peak; the era bias should pull it into Warm Up for older guests.
    const mix = [
      { artist: "70s Disco", song: "Boogie", energy: 8, danceability: 8, year: 1978 },
      { artist: "Modern A", song: "A", energy: 5, danceability: 5, year: 2020 },
      { artist: "Modern B", song: "B", energy: 6, danceability: 6, year: 2020 },
      { artist: "Modern C", song: "C", energy: 7, danceability: 7, year: 2020 },
      { artist: "Modern D", song: "D", energy: 9, danceability: 9, year: 2020 },
      { artist: "Modern E", song: "E", energy: 10, danceability: 10, year: 2020 },
    ];
    const r = reorderForEnergyProgression({ ...baseResult(), warmUp: mix });
    expect(findSection(r, "70s Disco", "Boogie")).not.toBe("Peak");
  });

  it("pushes an explicit low-intensity track out of Warm Up when alternatives exist", () => {
    const mix = [
      { artist: "Explicit Rap", song: "Track", energy: 5, danceability: 5, year: 2018, explicit: true },
      { artist: "Clean A", song: "A", energy: 4, danceability: 4, year: 2020 },
      { artist: "Clean B", song: "B", energy: 5, danceability: 5, year: 2020 },
      { artist: "Clean C", song: "C", energy: 6, danceability: 6, year: 2020 },
      { artist: "Clean D", song: "D", energy: 7, danceability: 7, year: 2020 },
      { artist: "Clean E", song: "E", energy: 8, danceability: 8, year: 2020 },
      { artist: "Clean F", song: "F", energy: 9, danceability: 9, year: 2020 },
    ];
    const r = reorderForEnergyProgression({ ...baseResult(), warmUp: mix });
    expect(findSection(r, "Explicit Rap", "Track")).not.toBe("Warm Up");
  });

  it("still respects raw intensity when no year/explicit is present (legacy behavior)", () => {
    const mix = [
      { artist: "Low", song: "L", energy: 3, danceability: 3 },
      { artist: "Mid", song: "M", energy: 7, danceability: 7 },
      { artist: "High", song: "H", energy: 10, danceability: 10 },
    ];
    const r = reorderForEnergyProgression({ ...baseResult(), warmUp: mix });
    expect(findSection(r, "Low", "L")).toBe("Warm Up");
    expect(findSection(r, "High", "H")).toBe("Peak");
  });
});


describe("uploads are never dropped by transition trimming", () => {
  it("keeps every uploaded song in the final result", () => {
    const uploads: ResultSong[] = Array.from({ length: 60 }, (_, i) => ({
      artist: `Upload Artist ${i}`,
      song: `Upload Song ${i}`,
      fromUpload: true,
      energy: 6 + (i % 5) * 0.2,
      danceability: 6 + (i % 5) * 0.2,
    }));
    const filler: ResultSong[] = Array.from({ length: 60 }, (_, i) => ({
      artist: `Filler Artist ${i}`,
      song: `Filler Song ${i}`,
      fromUpload: false,
      energy: 6 + (i % 5) * 0.2,
      danceability: 6 + (i % 5) * 0.2,
    }));
    const result = reorderForEnergyProgression({
      warmUp: [],
      transition: [...uploads, ...filler],
      peak: [],
      targetTotal: 30,
      perSectionTarget: 10,
      perSectionBase: 5,
      shortfall: { warmUp: 0, transition: 0, peak: 0, total: 0 },
      duplicatesRemoved: 0,
      blockedCount: 0,
    });
    const all = [...result.warmUp, ...result.transition, ...result.peak];
    const keys = new Set(all.map((s) => `${s.artist}|${s.song}`));
    for (const u of uploads) {
      expect(keys.has(`${u.artist}|${u.song}`)).toBe(true);
    }
  });
});
