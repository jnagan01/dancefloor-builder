import { describe, it, expect } from "vitest";
import { songsToCsv, combinedCsv } from "../src/lib/danceFloor";
import type { Song, GenerationResult } from "../src/lib/danceFloor";

const song = (artist: string, s: string): Song => ({ artist, song: s } as Song);

describe("CSV export columns", () => {
  const result: GenerationResult = {
    warmUp: [song("Pitbull", "Give Me Everything"), song("ABBA", "Dancing Queen")],
    transition: [song("Flo Rida", "Low")],
    peak: [song('Rihanna, "Robyn"', 'We Found "Love" (Remix)')],
  } as unknown as GenerationResult;

  const lines = (csv: string) => csv.trim().split(/\r?\n/);

  it("section CSVs contain exactly the Artist and Song columns", () => {
    for (const section of [result.warmUp, result.transition, result.peak]) {
      const rows = lines(songsToCsv(section));
      expect(rows[0]).toBe("Artist,Song");
      expect(rows).toHaveLength(section.length + 1);
    }
  });

  it("combined CSV contains exactly the Artist and Song columns, sections in order", () => {
    const rows = lines(combinedCsv(result));
    expect(rows[0]).toBe("Artist,Song");
    expect(rows).toHaveLength(5); // header + 4 songs, no Section column
    expect(rows[1]).toContain("Pitbull");
    expect(rows[4]).toContain("Rihanna");
  });

  it("quotes values containing commas or quotes", () => {
    const csv = songsToCsv([song('Rihanna, "Robyn"', 'We Found "Love" (Remix)')]);
    expect(csv.split("\n")[1]).toBe('"Rihanna, ""Robyn""","We Found ""Love"" (Remix)"');
  });
});
