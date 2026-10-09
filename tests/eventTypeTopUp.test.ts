import { describe, expect, it } from "vitest";
import { topUpSectionsFromLibrary, type GenerationResult, type Preferences } from "../src/lib/danceFloor";
import { SONG_LIBRARY } from "../src/lib/songLibrary";
import { getEventType, libraryAllowedForEventType } from "../src/lib/eventTypes";

const empty = (): GenerationResult =>
  ({
    warmUp: [], transition: [], peak: [],
    sectionTargets: { warmUp: 15, transition: 15, peak: 15 },
  }) as unknown as GenerationResult;

const prefs = (eventType?: string): Preferences =>
  ({ artists: [], genres: [], decades: [], notes: "", doNotPlay: [], eventType }) as unknown as Preferences;

describe("library top-up respects event type era", () => {
  it("school dance never gets pre-2000s library songs", () => {
    const r = topUpSectionsFromLibrary(empty(), prefs("school_dance"));
    const all = [...r.warmUp, ...r.transition, ...r.peak];
    const decadeOf = new Map(SONG_LIBRARY.map((l) => [`${l.artist}|${l.song}`, l.decade]));
    for (const s of all) {
      const d = parseInt(decadeOf.get(`${s.artist}|${s.song}`) ?? "2020", 10);
      expect(d).toBeGreaterThanOrEqual(2000);
    }
  });

  it("decade cutoff: 1990s passes a 1995 minimum, 1980s does not", () => {
    const t = getEventType("wedding_modern");
    expect(libraryAllowedForEventType({ decade: "1990s" }, t)).toBe(true);
    expect(libraryAllowedForEventType({ decade: "1980s" }, t)).toBe(false);
  });
});
