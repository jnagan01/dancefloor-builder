import { describe, it, expect } from "vitest";
import { allowedForEventType, getEventType } from "../src/lib/eventTypes";
import { reorderForEnergyProgression, type GenerationResult } from "../src/lib/danceFloor";

const school = getEventType("school_dance");
const club = getEventType("club");
const wedding = getEventType("wedding_traditional");

describe("event types", () => {
  it("school dance blocks explicit added songs", () => {
    expect(allowedForEventType({ year: 2022, explicit: true }, school)).toBe(false);
    expect(allowedForEventType({ year: 2022, explicit: false }, school)).toBe(true);
  });
  it("club leaves out added songs from before 2005 but allows explicit", () => {
    expect(allowedForEventType({ year: 1985 }, club)).toBe(false);
    expect(allowedForEventType({ year: 2015, explicit: true }, club)).toBe(true);
  });
  it("traditional wedding keeps older songs", () => {
    expect(allowedForEventType({ year: 1965 }, wedding)).toBe(true);
  });
  it("uploaded songs stay even when they break the event type rules", () => {
    const song = (artist: string, year: number, explicit: boolean, fromUpload: boolean) =>
      ({ artist, song: `${artist} song`, genre: "Pop", decade: "2000s", year, explicit, energy: 7, danceability: 7, popularity: 7, fromUpload }) as never;
    const r = {
      warmUp: [song("Old Upload", 1970, false, true), song("Old Filler", 1970, false, false)],
      transition: [song("Explicit Upload", 2020, true, true), song("Explicit Filler", 2020, true, false)],
      peak: [],
      perSectionTarget: 5,
    } as unknown as GenerationResult;
    const out = reorderForEnergyProgression(r, { eventType: "school_dance" });
    const artists = [...out.warmUp, ...out.transition, ...out.peak].map((s) => s.artist).sort();
    expect(artists).toEqual(["Explicit Upload", "Old Upload"]);
  });
});
