import { describe, it, expect } from "vitest";
import { equalSplit, generateLists, reorderForEnergyProgression, sectionTargetsFromSplit } from "../src/lib/danceFloor";

const prefs = { artists: [], genres: [], decades: [], notes: "" };

describe("custom section lengths", () => {
  it("defaults to equal thirds of the dance floor", () => {
    expect(equalSplit(3)).toEqual({ warmUp: 60, transition: 60, peak: 60 });
  });

  it("sizes each section by its own minutes (45/45/90 at 2x buffer)", () => {
    expect(sectionTargetsFromSplit({ warmUp: 45, transition: 45, peak: 90 }, 2)).toEqual({
      warmUp: 24,
      transition: 24,
      peak: 46,
    });
  });

  it("gives Peak the bigger share when built with a custom split", () => {
    const r = generateLists({ uploaded: [], prefs, hours: 3, expand: true, buffer: 1, split: { warmUp: 45, transition: 45, peak: 90 } });
    const o = reorderForEnergyProgression(r);
    expect(o.peak.length).toBeGreaterThan(o.warmUp.length);
  });

  it("keeps every upload with a custom split", () => {
    const uploaded = Array.from({ length: 40 }, (_, i) => ({ artist: `Artist ${i}`, song: `Song ${i}` }));
    const r = generateLists({ uploaded, prefs, hours: 1, expand: false, split: { warmUp: 10, transition: 10, peak: 40 } });
    const o = reorderForEnergyProgression(r);
    expect(o.warmUp.length + o.transition.length + o.peak.length).toBe(40);
  });
});
