import { describe, it, expect } from "vitest";
import {
  generateLists,
  dedupeKey,
  reorderForEnergyProgression,
  SECTION_BUFFER,
  topUpSectionsFromLibrary,
  type Song,
} from "@/lib/danceFloor";
import { SONG_LIBRARY } from "@/lib/songLibrary";

function fabricated(count: number, titleHint: string, prefix: string): Song[] {
  return Array.from({ length: count }, (_, i) => ({
    artist: `${prefix} Artist ${i}`,
    song: `${titleHint} Track ${i}`,
  }));
}

const basePrefs = { artists: [], genres: [], decades: [], notes: "" };

describe("generateLists buffered targets", () => {
  it('1× retains all 40 requested tracks above baseline without any additions or truncation', () => {
    const uploaded=fabricated(40,'Client','Original');
    const r=generateLists({uploaded,preserveRequestedRows:true,prefs:basePrefs,hours:1,buffer:1,expand:false,averageTrackSeconds:240});
    const all=[...r.warmUp,...r.transition,...r.peak];
    expect(all).toHaveLength(40); expect(all.every(t=>t.fromUpload)).toBe(true);
    expect(new Set(all.map(t=>dedupeKey(t.artist,t.song)))).toEqual(new Set(uploaded.map(t=>dedupeKey(t.artist,t.song))));
  });
  it('1× five client tracks stay five; explicit expansion can add constrained choices', () => {
    const uploaded=fabricated(5,'Client','Original');
    const input={uploaded,prefs:basePrefs,hours:1,buffer:1,averageTrackSeconds:240};
    const off=generateLists({...input,expand:false});
    expect([...off.warmUp,...off.transition,...off.peak]).toHaveLength(5);
    const on=generateLists({...input,expand:true});
    expect([...on.warmUp,...on.transition,...on.peak].filter(t=>t.fromUpload)).toHaveLength(5);
    expect([...on.warmUp,...on.transition,...on.peak].length).toBeGreaterThan(5);
  });
  it('uses available average length while omitted length keeps legacy 2× targets', () => {
    expect(generateLists({uploaded:[],prefs:basePrefs,hours:1,buffer:1,expand:false,averageTrackSeconds:120}).targetTotal).toBe(30);
    expect(generateLists({uploaded:[],prefs:basePrefs,hours:1,expand:false}).targetTotal).toBe(30);
  });
  it("computes perSectionTarget as 2× the base per-section need", () => {
    const r = generateLists({ uploaded: [], prefs: basePrefs, hours: 2, expand: false });
    const base = Math.ceil((2 * 15) / 3);
    expect(r.perSectionBase).toBe(base);
    expect(r.perSectionTarget).toBe(Math.ceil(base * SECTION_BUFFER));
  });

  it("expansion pads each section up to the buffered target", () => {
    const uploaded = fabricated(3, "slow love", "Mellow");
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: true });
    expect(r.warmUp.length).toBeGreaterThanOrEqual(r.perSectionTarget);
    expect(r.transition.length).toBeGreaterThanOrEqual(r.perSectionTarget);
    expect(r.peak.length).toBeGreaterThanOrEqual(r.perSectionTarget);
    expect(r.shortfall.total).toBeGreaterThan(0); // shortfall reflects uploads only
  });

  it("expand off + uploads below buffer reports positive shortfall per section", () => {
    const uploaded = fabricated(3, "slow love", "Mellow");
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 2, expand: false });
    expect(r.shortfall.warmUp + r.shortfall.transition + r.shortfall.peak).toBe(r.shortfall.total);
    expect(r.shortfall.total).toBeGreaterThan(0);
  });

  it("expand off does not add library songs", () => {
    const uploaded = fabricated(9, "midtempo", "Mid");
    const uploadedKeys = new Set(uploaded.map((s) => dedupeKey(s.artist, s.song)));
    const r = generateLists({ uploaded, prefs: basePrefs, hours: 1, expand: false });
    for (const list of [r.warmUp, r.transition, r.peak]) {
      for (const s of list) {
        expect(uploadedKeys.has(dedupeKey(s.artist, s.song))).toBe(true);
      }
    }
  });

  it("respects doNotPlay during expansion", () => {
    const blocked = SONG_LIBRARY.find((l) => l.section === "Peak")!;
    const r = generateLists({
      uploaded: [],
      prefs: { ...basePrefs, doNotPlay: [{ artist: blocked.artist, song: blocked.song }] },
      hours: 1,
      expand: true,
    });
    const blockedKey = dedupeKey(blocked.artist, blocked.song);
    expect(r.peak.some((s) => dedupeKey(s.artist, s.song) === blockedKey)).toBe(false);
  });

  it("tops sections back up from the library after reordering leaves a section short", () => {
    const uploads = fabricated(6, "peak banger", "PeakOnly");
    const generated = generateLists({ uploaded: uploads, prefs: basePrefs, hours: 1, expand: false });
    generated.peak = generated.peak.map((s) => ({ ...s, energy: 10, danceability: 10 }));
    const reordered = reorderForEnergyProgression(generated);
    expect(reordered.finalShortfall?.total).toBeGreaterThan(0);

    const topped = topUpSectionsFromLibrary(reordered, basePrefs);
    expect(topped.warmUp.length).toBeGreaterThanOrEqual(topped.perSectionTarget);
    expect(topped.transition.length).toBeGreaterThanOrEqual(topped.perSectionTarget);
    expect(topped.peak.length).toBeGreaterThanOrEqual(topped.perSectionTarget);
    expect(topped.finalShortfall?.total).toBe(0);
    expect([...topped.warmUp, ...topped.transition, ...topped.peak].some((s) => s.metaSource === "Library")).toBe(true);
  });
});
