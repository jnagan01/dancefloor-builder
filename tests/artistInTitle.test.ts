import { describe, it, expect } from "vitest";
import { SongKeySet, dedupeKey, stripArtistFromTitle } from "../src/lib/danceFloor";
describe("artist embedded in title", () => {
  it("strips artist prefix and suffix", () => {
    expect(stripArtistFromTitle("Earth, Wind & Fire", "Earth, Wind & Fire - September")).toBe("September");
    expect(stripArtistFromTitle("The Killers", "Mr. Brightside - The Killers")).toBe("Mr. Brightside");
    expect(stripArtistFromTitle("Queen", "Under Pressure - Remastered")).toBe("Under Pressure - Remastered");
  });
  it("dedupes 'Artist - Song' vs 'Song'", () => {
    const s = new SongKeySet();
    s.add("Earth, Wind & Fire", "September");
    expect(s.has("Earth, Wind & Fire", "Earth, Wind & Fire - September")).toBe(true);
    expect(dedupeKey("Earth, Wind & Fire", "Earth, Wind & Fire - September")).toBe(dedupeKey("Earth, Wind & Fire", "September"));
  });
});
