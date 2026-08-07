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

  it("prioritizes 3 favorite tracks and 2 non-favorite tracks before demoting overflow", () => {
    const songs = [
      ...[1, 2, 3, 4, 5].map((i) => track("Beyonce", `Fav ${i}`, 5 + i * 0.1)),
      ...[1, 2, 3, 4].map((i) => track("Random Band", `Other ${i}`, 5 + i * 0.1)),
    ];
    const out = applyVarietyReranker(songs, { favoriteArtists: ["Beyonce"] });
    const head = out.slice(0, 5);
    expect(head.filter((s) => s.artist === "Beyonce").length).toBe(FAVORITE_ARTIST_CAP);
    expect(head.filter((s) => s.artist === "Random Band").length).toBe(2);
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

describe("hard 3-per-artist cap", () => {
  it("drops non-upload songs beyond 3 by the same artist", () => {
    const songs = [1, 2, 3, 4, 5].map((i) => track("Beyonce", `Fav ${i}`, 5 + i * 0.1));
    const out = applyVarietyReranker(songs, { favoriteArtists: ["Beyonce"] });
    expect(out.filter((s) => s.artist === "Beyonce").length).toBe(3);
  });

  it("keeps every imported (uploaded) song by the same artist", () => {
    const uploads = [1, 2, 3, 4, 5].map((i) => ({ ...track("Beyonce", `Up ${i}`, 5 + i * 0.1), fromUpload: true }));
    const ai = [1, 2].map((i) => track("Beyonce", `AI ${i}`, 6 + i * 0.1));
    const out = applyVarietyReranker([...uploads, ...ai], { favoriteArtists: ["Beyonce"] });
    expect(out.filter((s) => s.song.startsWith("Up ")).length).toBe(5);
    expect(out.filter((s) => s.song.startsWith("AI ")).length).toBe(0);
  });
});
