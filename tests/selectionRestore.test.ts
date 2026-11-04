import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolveSavedSelections, selectionBase, rowSelectionKey, legacyIdentityMatches } from "@/lib/selectionRestore";
import * as vdj from "@/lib/virtualDj"; import * as dance from "@/lib/danceFloor"; import * as audio from "@/lib/audioMatch"; import * as snapshots from "@/lib/snapshotSafety"; import * as drafts from "@/lib/eventDrafts"; import * as input from "@/lib/inputSafety"; import * as autosave from "@/lib/eventAutosave"; import * as vibes from "@/lib/vibes"; import * as isolation from "@/lib/workflowIsolation"; import * as theory from "@/lib/musicTheory"; import * as revisions from "@/lib/eventRevision";
import { vi } from "vitest";

// TEST-ONLY synthetic songs; generic shapes of the reported collision (stale positional keys beside current ones).
const usher = { artist: "Usher", song: "Yeah" }, common = { artist: "Common", song: "Be" }, beeGees = { artist: "Bee Gees", song: "Stayin Alive" };
const queen = { artist: "Queen", song: "Dont Stop Me Now" }, stevie = { artist: "Stevie Wonder", song: "Signed Sealed Delivered" };
const k = (s: "warmUp" | "transition" | "peak", i: number, x: { artist: string; song: string }) => rowSelectionKey(s, i, x);
const sel = (p: string, extra: object = {}) => ({ paths: [p], confirmed: true, ...extra });

describe("identity-safe selection restore (unit)", () => {
  const lists = { warmUp: [], transition: [], peak: [common, queen, usher] };
  const current = { [k("peak", 0, common)]: sel("/m/common-be.mp3"), [k("peak", 1, queen)]: sel("/m/queen.mp3"), [k("peak", 2, usher)]: sel("/m/usher.mp3") };
  // Stale keys from an earlier generation: same positions, different songs.
  const stale = { [k("peak", 0, beeGees)]: sel("/m/beegees.mp3"), [k("peak", 1, stevie)]: sel("/m/stevie.mp3"), [k("peak", 3, usher)]: sel("/m/usher-old.mp3", { excluded: true }) };
  it.each([["current first", { ...current, ...stale }], ["stale first", { ...stale, ...current }]])("exact current key wins (%s)", (_n, stored) => {
    const r = resolveSavedSelections(lists, stored);
    expect(r[k("peak", 0, common)].paths).toEqual(["/m/common-be.mp3"]);
    expect(r[k("peak", 1, queen)].paths).toEqual(["/m/queen.mp3"]);
    expect(r[k("peak", 2, usher)]).toEqual(sel("/m/usher.mp3"));
    expect(Object.keys(r)).toHaveLength(3);
  });
  it("stale keys alone never apply to a different song at that position", () => {
    expect(resolveSavedSelections(lists, stale)).toEqual({});
  });
  it("legacy dedupe spelling applies only with matching identity at the same position", () => {
    const weeknd = { artist: "The Weeknd", song: "Blinding Lights" };
    const r = resolveSavedSelections({ warmUp: [weeknd] }, { "warmUp:0:the weeknd|blinding lights": sel("/m/w.mp3") });
    expect(r[k("warmUp", 0, weeknd)].paths).toEqual(["/m/w.mp3"]);
    expect(resolveSavedSelections({ warmUp: [weeknd] }, { "warmUp:1:the weeknd|blinding lights": sel("/m/w.mp3") })).toEqual({});
    expect(resolveSavedSelections({ warmUp: [weeknd] }, { "warmUp:0:old": sel("/m/w.mp3") })).toEqual({});
    expect(legacyIdentityMatches("weeknd|save your tears", weeknd)).toBe(false);
    expect(legacyIdentityMatches("usher feat lil jon|yeah", usher)).toBe(true);
    expect(legacyIdentityMatches("cover band|yeah", usher)).toBe(false);
  });
  it("disagreeing validated legacy entries are ambiguous and apply nothing", () => {
    const w = { artist: "The Weeknd", song: "Blinding Lights" };
    const stored = { "warmUp:0:the weeknd|blinding lights": sel("/a.mp3"), "warmUp:0:weeknd feat x|blinding lights": sel("/b.mp3") };
    expect(resolveSavedSelections({ warmUp: [w] }, stored)).toEqual({});
  });
  it("repeated occurrences keep per-position choices, extras, exclusion and empty entries", () => {
    const l = { warmUp: [usher], transition: [], peak: [usher] };
    const stored = { [k("warmUp", 0, usher)]: { paths: ["/m/usher-clean.mp3", "/m/usher-extra.mp3"], confirmed: true }, [k("peak", 0, usher)]: { paths: [], excluded: true } };
    expect(resolveSavedSelections(l, stored)).toEqual(stored);
  });
  it("serialization drops stale identity keys, keeps inert legacy keys and migrates validated ones", () => {
    const stored = { ...stale, ...current, "warmUp:0:old": sel("/m/x.mp3"), "peak:2:usher|yeah": sel("/m/usher.mp3") };
    const r = resolveSavedSelections(lists, stored);
    const base = selectionBase(stored, r, new Set(Object.keys(r)));
    expect(Object.keys(base).sort()).toEqual([...Object.keys(current), "warmUp:0:old"].sort());
  });
});

const require = createRequire(import.meta.url);
const harness = require("./helpers/eventRouteHarness.cjs").createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });
const tracks = [
  ["Common", "Be", "/lib/common-be.mp3"], ["Bee Gees", "Stayin Alive", "/lib/beegees.mp3"], ["Queen", "Dont Stop Me Now", "/lib/queen.mp3"],
  ["Stevie Wonder", "Signed Sealed Delivered", "/lib/stevie.mp3"], ["Usher", "Yeah", "/lib/usher.mp3"], ["Usher", "Yeah (Live)", "/lib/usher-live.mp3"], ["Usher", "Yeah (Extended)", "/lib/usher-ext.mp3"],
].map(([artist, title, filePath]) => ({ artist, title, filePath }));
const all = (r: any) => [...r.warmUp, ...r.transition, ...r.peak];
const rowOf = (selections: object) => ({ id: "A", name: "Test", updated_at: "v1", inputs: { hours: "0.25", buffer: 2, listType: "dance", eventName: "Test", songs: [common, queen, usher] }, lists: { warmUp: [usher], transition: [], peak: [common, queen, usher], selections } });
// Read paths through the route's own serialization (its merged library), not the test's index order.
const pathsOf = (h: any, sec: string, i: number, s: any) => { const key = `${sec}:${i}:${dance.dedupeKey(s.artist, s.song)}`; const m = h.current.matches[key]; if (m?.trackIndex == null) return []; return h.current.eventSnapshot(h.current.result, h.current.matches).lists.selections[key]?.paths ?? []; };
const pathOf = (h: any, sec: string, i: number, s: any) => pathsOf(h, sec, i, s)[0];

describe("real event route reopening", () => {
  const current = { [k("warmUp", 0, usher)]: { paths: ["/lib/usher-live.mp3", "/lib/usher-ext.mp3"], confirmed: true }, [k("peak", 0, common)]: sel("/lib/common-be.mp3"), [k("peak", 1, queen)]: sel("/lib/queen.mp3"), [k("peak", 2, usher)]: { paths: ["/lib/usher.mp3"], confirmed: true, excluded: true } };
  const stale = { [k("peak", 0, beeGees)]: sel("/lib/beegees.mp3"), [k("peak", 1, stevie)]: sel("/lib/stevie.mp3"), [k("peak", 3, usher)]: sel("/lib/usher-ext.mp3") };
  for (const [name, stored] of [["current first", { ...current, ...stale }], ["stale first", { ...stale, ...current }]] as const) {
    it(`colliding keys (${name}): every row keeps its own file, no repeats, passive open never writes, edit prunes stale`, async () => {
      vi.useFakeTimers();
      try {
        const h = harness({ rows: { A: rowOf(stored) } }); await h.flush();
        const lib = vdj.buildLibrary(tracks as any); h.lib = lib; h.library(lib); await h.flush();
        expect(pathOf(h, "peak", 0, common)).toBe("/lib/common-be.mp3");
        expect(pathOf(h, "peak", 1, queen)).toBe("/lib/queen.mp3");
        expect(pathOf(h, "peak", 2, usher)).toBe("/lib/usher.mp3");
        expect(pathOf(h, "warmUp", 0, usher)).toBe("/lib/usher-live.mp3");
        expect(pathsOf(h, "warmUp", 0, usher)).toEqual(["/lib/usher-live.mp3", "/lib/usher-ext.mp3"]);
        expect(h.current.matches[k("peak", 2, usher)].excludedFromVdj).toBe(true);
        await vi.advanceTimersByTimeAsync(2000); expect(h.requests).toHaveLength(0);
        // Actual export artifact: unrelated audio never appears; excluded occurrence omitted.
        h.testWindow.electronAvailability = { check: async (paths: string[]) => ({ ok: true, availability: Object.fromEntries(paths.map(p => [p, "available"])) }) };
        await h.current.exportAllZip();
        const m3u = h.files.filter((f: any) => f.name.endsWith(".m3u")).map((f: any) => f.data).join("\n");
        expect(m3u).toContain("/lib/common-be.mp3"); expect(m3u).toContain("/lib/queen.mp3");
        expect(m3u).not.toContain("/lib/beegees.mp3"); expect(m3u).not.toContain("/lib/stevie.mp3");
        h.edit("Renamed"); await vi.advanceTimersByTimeAsync(1500);
        const saved = h.requests.at(-1).lists.selections;
        expect(Object.keys(saved).sort()).toEqual(Object.keys(current).sort());
        expect(saved[k("peak", 2, usher)]).toMatchObject({ paths: ["/lib/usher.mp3"], excluded: true });
        h.unmount();
        const re = harness({ rows: { A: { ...rowOf(saved), inputs: h.requests.at(-1).inputs } } }); await re.flush(); re.lib = lib; re.library(lib); await re.flush();
        expect(pathOf(re, "peak", 0, common)).toBe("/lib/common-be.mp3"); expect(pathOf(re, "peak", 1, queen)).toBe("/lib/queen.mp3"); re.unmount();
      } finally { vi.useRealTimers(); }
    });
  }
  it("missing saved file stays missing (no silent substitute) and resolves when the library later has it", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ rows: { A: rowOf({ [k("peak", 0, common)]: sel("/elsewhere/common-be.mp3") }) } }); await h.flush();
      const lib = vdj.buildLibrary(tracks as any); h.lib = lib; h.library(lib); await h.flush();
      expect(pathOf(h, "peak", 0, common)).toBeUndefined();
      h.edit("Edited"); await vi.advanceTimersByTimeAsync(1500);
      expect(h.requests.at(-1).lists.selections[k("peak", 0, common)].paths).toEqual(["/elsewhere/common-be.mp3"]);
      const lib2 = vdj.buildLibrary([...tracks, { artist: "Common", title: "Be", filePath: "/elsewhere/common-be.mp3" }] as any); h.lib = lib2; h.library(lib2); await h.flush();
      expect(pathOf(h, "peak", 0, common)).toBe("/elsewhere/common-be.mp3");
      h.unmount();
    } finally { vi.useRealTimers(); }
  });
  it("regeneration does not re-attach earlier saved files by position", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ rows: { A: rowOf({ ...{ [k("peak", 0, beeGees)]: sel("/lib/beegees.mp3") } }) } }); await h.flush();
      const lib = vdj.buildLibrary(tracks as any); h.lib = lib; h.library(lib); await h.flush();
      await h.current.generate(); await h.flush(); await vi.advanceTimersByTimeAsync(1500);
      const r = h.current.result;
      for (const sec of ["warmUp", "transition", "peak"]) r[sec].forEach((s: any, i: number) => { const p = pathOf(h, sec, i, s); if (p === "/lib/beegees.mp3") expect(s.artist).toBe("Bee Gees"); });
      const saved = h.requests.at(-1)?.lists.selections ?? {};
      expect(Object.keys(saved).filter(x => x.includes("bee gees") && !all(r).some((s: any) => s.artist === "Bee Gees"))).toEqual([]);
      h.unmount();
    } finally { vi.useRealTimers(); }
  });
});
