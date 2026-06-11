import { describe, it, expect } from "vitest";
import {
  generateLists,
  inferAudienceFit,
  sectionScores,
  dedupeKey,
  type Song,
} from "@/lib/danceFloor";
import { SONG_LIBRARY } from "@/lib/songLibrary";

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

describe("audience-fit inference", () => {
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

describe("sectionScores", () => {
  it("favors Warm Up for low-energy older-friendly songs", () => {
    const s = sectionScores(5, 6, "older");
    expect(s["Warm Up"]).toBeGreaterThan(s.Peak);
  });

  it("favors Peak for high-energy adult songs", () => {
    const s = sectionScores(9, 9, "adult");
    expect(s.Peak).toBeGreaterThan(s["Warm Up"]);
    expect(s.Peak).toBeGreaterThan(s.Transition);
  });

  it("danceability breaks ties when energy is equal", () => {
    const a = sectionScores(7, 9, "all");
    const b = sectionScores(7, 4, "all");
    expect(a.Transition).toBeGreaterThan(b.Transition);
  });
});

describe("generateLists section filtering", () => {
  it("places older-friendly disco/oldies into Warm Up, not Peak", () => {
    const uploaded: Song[] = [
      { artist: "Earth, Wind & Fire", song: "September" },
      { artist: "ABBA", song: "Dancing Queen" },
      { artist: "Bee Gees", song: "Stayin' Alive" },
      { artist: "The Temptations", song: "My Girl" },
      { artist: "Bill Withers", song: "Lovely Day" },
      { artist: "Van Morrison", song: "Brown Eyed Girl" },
    ];
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: false });
    for (const s of uploaded) {
      expect(findSection(r, s.artist, s.song)).not.toBe("Peak");
    }
  });

  it("places adult-skewing EDM/Hip Hop into Peak, not Warm Up", () => {
    const uploaded: Song[] = [
      { artist: "Pitbull", song: "Timber" },
      { artist: "LMFAO", song: "Party Rock Anthem" },
      { artist: "Usher", song: "Yeah!" },
      { artist: "Cardi B", song: "I Like It" },
      { artist: "David Guetta", song: "Titanium" },
      { artist: "Calvin Harris", song: "Summer" },
    ];
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: false });
    for (const s of uploaded) {
      expect(findSection(r, s.artist, s.song)).not.toBe("Warm Up");
    }
  });

  it("keeps a high-energy older-friendly disco track out of Peak", () => {
    const uploaded: Song[] = [{ artist: "Earth, Wind & Fire", song: "September" }];
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: false });
    expect(findSection(r, "Earth, Wind & Fire", "September")).not.toBe("Peak");
  });

  it("balances mixed uploads roughly evenly across the three sections", () => {
    const mix: Song[] = [
      // older-leaning
      { artist: "Earth, Wind & Fire", song: "September" },
      { artist: "ABBA", song: "Dancing Queen" },
      { artist: "The Jackson 5", song: "I Want You Back" },
      { artist: "Stevie Wonder", song: "Signed, Sealed, Delivered I'm Yours" },
      { artist: "Bee Gees", song: "Stayin' Alive" },
      { artist: "Bill Withers", song: "Lovely Day" },
      { artist: "The Temptations", song: "My Girl" },
      { artist: "Van Morrison", song: "Brown Eyed Girl" },
      // younger-leaning pop
      { artist: "Taylor Swift", song: "Shake It Off" },
      { artist: "Dua Lipa", song: "Levitating" },
      { artist: "Harry Styles", song: "As It Was" },
      { artist: "Bruno Mars", song: "Marry You" },
      { artist: "Ed Sheeran", song: "Shape of You" },
      { artist: "Katy Perry", song: "Teenage Dream" },
      { artist: "Doja Cat", song: "Say So" },
      // adult/peak
      { artist: "Pitbull", song: "Timber" },
      { artist: "LMFAO", song: "Party Rock Anthem" },
      { artist: "Usher", song: "Yeah!" },
      { artist: "Flo Rida", song: "Low" },
      { artist: "Cardi B", song: "I Like It" },
      { artist: "David Guetta", song: "Titanium" },
      { artist: "Calvin Harris", song: "Summer" },
      { artist: "Avicii", song: "Wake Me Up" },
      { artist: "Kesha", song: "TiK ToK" },
      { artist: "The Weeknd", song: "Blinding Lights" },
      { artist: "Rihanna", song: "Don't Stop the Music" },
      { artist: "Lady Gaga", song: "Bad Romance" },
      { artist: "Bruno Mars", song: "24K Magic" },
      { artist: "Taio Cruz", song: "Dynamite" },
      { artist: "Mark Ronson", song: "Uptown Funk" },
    ];
    const r = generateLists({ uploaded: mix, prefs: basePrefs, hours: 1, expand: false });
    const lo = Math.floor(mix.length / 3) - 1;
    const hi = Math.ceil(mix.length / 3) + 1;
    expect(r.warmUp.length).toBeGreaterThanOrEqual(lo);
    expect(r.warmUp.length).toBeLessThanOrEqual(hi);
    expect(r.transition.length).toBeGreaterThanOrEqual(lo);
    expect(r.transition.length).toBeLessThanOrEqual(hi);
    expect(r.peak.length).toBeGreaterThanOrEqual(lo);
    expect(r.peak.length).toBeLessThanOrEqual(hi);
  });

  it("library expansion fills Warm Up with older/younger-fit and Peak with adult-fit", () => {
    const r = generateLists({ uploaded: [], prefs: basePrefs, hours: 1, expand: true });

    const fitOf = (artist: string, song: string) => {
      const lib = SONG_LIBRARY.find(
        (l) => l.artist === artist && l.song === song,
      );
      return lib ? inferAudienceFit(lib.decade, lib.genre) : "all";
    };

    const warmFits = r.warmUp.map((s) => fitOf(s.artist, s.song));
    const warmAdult = warmFits.filter((f) => f === "adult").length;
    expect(warmAdult).toBeLessThanOrEqual(Math.floor(r.warmUp.length / 3));

    const peakFits = r.peak.map((s) => fitOf(s.artist, s.song));
    const peakOlderYounger = peakFits.filter((f) => f === "older").length;
    expect(peakOlderYounger).toBeLessThanOrEqual(Math.floor(r.peak.length / 3));
  });
});
