import { describe, it, expect } from "vitest";
import {
  applyVarietyReranker,
  isFavoriteArtist,
  buildGapProfile,
  FAVORITE_ARTIST_CAP,
  type ResultSong,
} from "@/lib/danceFloor";

function track(artist: string, song: string, energy = 7): ResultSong {
  return { artist, song, energy, danceability: energy, popularity: 8, valence: 7 } as ResultSong;
}

describe("favorite artists", () => {
  it("matches loosely on normalized names", () => {
    expect(isFavoriteArtist("Beyoncé feat. Jay-Z", ["Beyonce"])).toBe(true);
    expect(isFavoriteArtist("Drake", ["Beyonce"])).toBe(false);
  });

  it("allows up to 3 tracks per list for a favorite artist", () => {
    const songs = [1, 2, 3, 4, 5].map((i) => track("Beyonce", `Song ${i}`, 5 + i * 0.1));
    const out = applyVarietyReranker(songs, { favoriteArtists: ["Beyonce"] });
    expect(out.length).toBe(FAVORITE_ARTIST_CAP);
  });

  it("keeps non-favorites capped at 2 per list", () => {
    const songs = [1, 2, 3, 4].map((i) => track("Random Band", `Song ${i}`, 5 + i * 0.1));
    const out = applyVarietyReranker(songs, { favoriteArtists: ["Beyonce"] });
    expect(out.length).toBe(2);
  });

  it("does not exclude a favorite from the AI gap brief until it hits the per-list cap", () => {
    const section = [track("Beyonce", "A"), track("Beyonce", "B")];
    const gaps = buildGapProfile(section, section, "Peak", { favoriteArtists: ["Beyonce"] });
    expect(gaps.excludeArtists).not.toContain("Beyonce");

    const full = [...section, track("Beyonce", "C")];
    const gaps2 = buildGapProfile(full, full, "Peak", { favoriteArtists: ["Beyonce"] });
    expect(gaps2.excludeArtists).toContain("Beyonce");
  });

  it("still excludes non-favorites at 2", () => {
    const section = [track("Random Band", "A"), track("Random Band", "B")];
    const gaps = buildGapProfile(section, section, "Peak", { favoriteArtists: ["Beyonce"] });
    expect(gaps.excludeArtists).toContain("Random Band");
  });
});
