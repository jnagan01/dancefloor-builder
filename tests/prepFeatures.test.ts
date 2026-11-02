import { describe, expect, it, vi } from "vitest";
import { EMPTY_FILTER, facetOptions, matchesFilter, trackFacts, readFilter, type FilterFacts } from "../src/lib/prep/filters";
import {
  emptyKnowledge, savePreset, readKnowledge, addShortlist, createGroup, copyGroupToEvent, linkShortlistFile, dismissForEvent, undoDismiss,
  setFeedback, eventPrep, mergeKnowledgeAdditive, setTrackNote, songIdentity, setEventTags, type PrepKnowledge,
} from "../src/lib/prep/knowledge";
import { createPrepStore, type PrepBackend } from "../src/lib/prep/prepStore";
import { recommend, type Candidate, type RecControls } from "../src/lib/prep/recommend";
import { buildDashboard, type DashTrack } from "../src/lib/prep/dashboard";
import { createNoteDrafts } from "../src/lib/prep/noteDrafts";
import { createThrottle, parseLastfm, parseMbRecordings } from "../src/lib/prep/lookupParse";
import { planAddToSection } from "../src/lib/prep/addToSection";
import { buildLibrary } from "../src/lib/virtualDj";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareCandidate, createLookupGuard } from "../src/lib/prep/enrichment";
import { validateBackup } from "../src/lib/backups";
import { parseVdjDatabaseXml, type VdjTrack, type SongMatch } from "../src/lib/virtualDj";

const track = (o: Partial<VdjTrack>): VdjTrack => ({ filePath: "/m/a.mp3", artist: "A", title: "T", ...o } as VdjTrack);
const memBackend = (initial: Record<string, unknown> = {}) => {
  const data = new Map(Object.entries(initial));
  const b: PrepBackend & { data: Map<string, unknown>; fail: boolean; gate?: Promise<void> } = {
    data, fail: false,
    async read(k) { return structuredClone(data.get(k)); },
    async write(k, v) { if (b.gate) await b.gate; if (b.fail) throw Error("disk full"); data.set(k, structuredClone(v)); },
  };
  return b;
};

describe("filters: unknown values are explicit, never guessed", () => {
  const facts: FilterFacts[] = [{ bpm: 120, genre: "Pop" }, { genre: "Pop" }, { bpm: 90, genre: "Rock" }, { bpm: 125 }];
  it("combines predicates and include/exclude/only unknown per field", () => {
    const f = { ...EMPTY_FILTER, bpm: [110, 130] as [number, number], genres: ["pop"] };
    expect(facts.map(x => matchesFilter(x, f, "library"))).toEqual([true, true, false, true]);
    expect(facts.map(x => matchesFilter(x, { ...f, bpmUnknown: "exclude", genreUnknown: "exclude" }, "library"))).toEqual([true, false, false, false]);
    expect(facts.map(x => matchesFilter(x, { ...EMPTY_FILTER, bpmUnknown: "only" }, "library"))).toEqual([false, true, false, false]);
  });
  it("never invents energy from BPM; clean label from filename is marked as inferred", () => {
    const f = trackFacts(track({ bpm: "128", filePath: "/m/Song (Clean Edit).mp3" }));
    expect(f.energy).toBeUndefined();
    expect(f).toMatchObject({ clean: "clean", cleanSource: "filename" });
    expect(trackFacts(track({ filePath: "/m/Song (Clean) (Explicit).mp3" })).clean).toBeUndefined();
  });
  it("energy/owned filters only apply in recommendation context", () => {
    const f = { ...EMPTY_FILTER, energy: [7, 10] as [number, number], energyUnknown: "exclude" as const, owned: "notOwned" as const };
    expect(matchesFilter({ owned: true }, f, "library")).toBe(true);
    expect(matchesFilter({ owned: true, energy: 8 }, f, "recommendation")).toBe(false);
    expect(matchesFilter({ owned: false, energy: 8 }, f, "recommendation")).toBe(true);
  });
  it("never keeps malformed saved ranges", () => { expect(readFilter({ ...EMPTY_FILTER, bpm: [5] })?.bpm ?? null).toBeNull(); expect(readFilter("x")).toBeNull(); });
  it("filters 31,250 tracks quickly", () => {
    const many = Array.from({ length: 31250 }, (_, i) => trackFacts(track({ filePath: `/m/${i}.mp3`, bpm: i % 3 ? String(80 + (i % 60)) : undefined, genre: i % 5 ? "House" : undefined, songLength: String(180 + (i % 200)) })));
    const t0 = performance.now();
    const n = many.filter(x => matchesFilter(x, { ...EMPTY_FILTER, bpm: [120, 130], genres: ["house"], duration: [200, 300] }, "library")).length;
    facetOptions(many);
    expect(n).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("account-scoped preparation store", () => {
  const own = (s: ReturnType<typeof createPrepStore>) => s.owner()!;
  it("persists presets per account and isolates accounts", async () => {
    const be = memBackend(), s = createPrepStore(be);
    await s.setAccount("A");
    await s.update(own(s), k => savePreset(k, "Fast", "library", { ...EMPTY_FILTER, bpm: [120, 130] }));
    await s.setAccount("B");
    expect(s.get().knowledge.presets).toEqual([]);
    const fresh = createPrepStore(be); await fresh.setAccount("A");
    expect(fresh.get().knowledge.presets.map(p => p.name)).toEqual(["Fast"]);
  });
  it("blocks writes and backups and preserves unreadable saved data", async () => {
    const be = memBackend({ "prepKnowledge:A": { version: 1, presets: "bad" } }), s = createPrepStore(be);
    await s.setAccount("A");
    expect(s.get().status).toBe("blocked");
    await expect(s.update(own(s), k => setFeedback(k, "x", "y", "never"))).rejects.toThrow();
    await expect(s.backupSection(own(s))).rejects.toThrow(/Backup stopped/);
    expect(be.data.get("prepKnowledge:A")).toEqual({ version: 1, presets: "bad" });
  });
  it("keeps last-good copy when a write fails", async () => {
    const be = memBackend(), s = createPrepStore(be); await s.setAccount("A");
    await s.update(own(s), k => setFeedback(k, "x", "y", "favor"));
    be.fail = true;
    await expect(s.update(own(s), k => setFeedback(k, "x", "y", "never"))).rejects.toThrow("disk full");
    expect(s.get().knowledge.feedback[0].kind).toBe("favor");
    be.fail = false;
    expect((await createPrepStore(be).setAccount("A"), be.data.get("prepKnowledge:A") as PrepKnowledge).feedback[0].kind).toBe("favor");
  });
  it("a stale handler from account A cannot write after A -> B -> A (synchronous invalidation)", async () => {
    const be = memBackend(), s = createPrepStore(be); await s.setAccount("A");
    const staleA = own(s);
    void s.setAccount("B"); // no await: generation must already be invalid
    await expect(s.update(staleA, k => setFeedback(k, "old", "event", "never"))).rejects.toThrow(/changed/);
    await s.setAccount("A");
    await expect(s.update(staleA, k => setFeedback(k, "old", "event", "never"))).rejects.toThrow(/changed/);
    expect(be.data.get("prepKnowledge:A")).toBeUndefined();
    expect(be.data.get("prepKnowledge:B")).toBeUndefined();
  });
  it("same-account sign-in again invalidates old callbacks", async () => {
    const s = createPrepStore(memBackend()); await s.setAccount("A");
    const old = own(s);
    void s.setAccount("A", true);
    await expect(s.update(old, k => k)).rejects.toThrow(/changed/);
    await s.update(own(s), k => setFeedback(k, "x", "y", "favor"));
    expect(s.get().knowledge.feedback).toHaveLength(1);
  });
  it("a pending write that lands after A -> B -> A is reflected in A's reload, never in B", async () => {
    const be = memBackend(), s = createPrepStore(be); await s.setAccount("A");
    let open!: () => void; be.gate = new Promise(r => { open = r; });
    const pending = s.update(own(s), k => setFeedback(k, "x", "y", "never"));
    await new Promise(r => setTimeout(r, 0)); // the write is now in progress inside storage
    const toB = s.setAccount("B");
    open(); be.gate = undefined;
    await expect(pending).rejects.toThrow(/changed/);
    await toB;
    expect(s.get().knowledge.feedback).toEqual([]);
    await s.setAccount("A");
    expect(s.get().knowledge.feedback.map(f => f.kind)).toEqual(["never"]); // what reached A's storage
    expect(be.data.get("prepKnowledge:B")).toBeUndefined();
  });
  it("backupSection never switches accounts and rejects stale owners", async () => {
    const s = createPrepStore(memBackend()); await s.setAccount("A");
    await s.update(own(s), k => setFeedback(k, "x", "y", "favor"));
    const a = own(s);
    await s.setAccount("B");
    await expect(s.backupSection(a)).rejects.toThrow(/changed/);
    expect(s.get().account).toBe("B");
    expect(await s.backupSection(own(s))).toBeUndefined(); // B genuinely has nothing
  });
  it("sign-out clears in-memory knowledge", async () => {
    const s = createPrepStore(memBackend()); await s.setAccount("A");
    await s.update(own(s), k => setFeedback(k, "x", "y", "never"));
    await s.setAccount(null);
    expect(s.get()).toMatchObject({ status: "signedOut", account: null });
    expect(s.get().knowledge.feedback).toEqual([]);
  });
  it("carries a backed-up event's preparation onto the restored-as-new event id additively", async () => {
    const s = createPrepStore(memBackend()); await s.setAccount("A");
    let src = addShortlist(emptyKnowledge(), "OLD", { artist: "A", song: "T" }).next;
    src = setEventTags(dismissForEvent(src, "OLD", "X", "Y"), "OLD", ["singalong"]);
    expect(await s.carryToNewEvent(own(s), eventPrep(src, "OLD"), "NEW")).toBe(3);
    const ev = eventPrep(s.get().knowledge, "NEW");
    expect(ev.shortlist.map(i => i.song)).toEqual(["T"]);
    expect(ev.tags).toEqual(["singalong"]);
    expect(await s.carryToNewEvent(own(s), eventPrep(src, "OLD"), "NEW")).toBe(0);
  });
});

describe("unsaved note drafts", () => {
  it("a tags save finishing never overwrites a note typed meanwhile; drafts survive reopen; isolated per account", async () => {
    const be = memBackend(), s = createPrepStore(be), d = createNoteDrafts(); await s.setAccount("A");
    const id = "/m/Song.mp3";
    d.set("A", id, "tags", "first dance");
    let open!: () => void; be.gate = new Promise(r => { open = r; });
    const tagsSave = s.update(s.owner()!, k => setTrackNote(k, id, { tags: ["first dance"] }));
    d.set("A", id, "note", "Play after speeches"); // typed while tags save is pending
    open(); be.gate = undefined; await tagsSave; d.settle("A", id, "tags", "first dance");
    expect(d.get("A", id, "tags")).toBeUndefined();
    expect(d.get("A", id, "note")).toBe("Play after speeches");
    expect(s.get().knowledge.tracks[0]).toMatchObject({ tags: ["first dance"], note: "" });
    expect(d.get("B", id, "note")).toBeUndefined();
    await s.update(s.owner()!, k => setTrackNote(k, id, { note: d.get("A", id, "note")! })); d.settle("A", id, "note", "Play after speeches");
    const reopened = createPrepStore(be); await reopened.setAccount("A");
    expect(reopened.get().knowledge.tracks[0]).toMatchObject({ tags: ["first dance"], note: "Play after speeches" });
  });
  it("settle keeps text typed during a save; failed save keeps the draft", () => {
    const d = createNoteDrafts();
    d.set("A", "f", "note", "v1"); d.set("A", "f", "note", "v2"); d.settle("A", "f", "note", "v1");
    expect(d.get("A", "f", "note")).toBe("v2");
    d.clearAll(); expect(d.get("A", "f", "note")).toBeUndefined();
  });
});

describe("recommendations", () => {
  const c = (artist: string, song: string, o: Partial<Candidate> = {}): Candidate => ({ artist, song, facts: { owned: true }, origin: "library", playCount: 0, ...o });
  const base: RecControls = { familiarity: 0, clientSimilarity: 1, artistVariety: 0, ownedOnly: false };
  const input = (controls: Partial<RecControls> = {}, extra: Partial<Parameters<typeof recommend>[0]> = {}) => recommend({
    candidates: [c("Queen", "Song B", { facts: { genre: "Rock", owned: true } }), c("Other", "Played", { playCount: 50 }), c("Indie", "Fresh", { facts: { owned: false }, origin: "catalogue", playCount: undefined }), c("Queen", "Song C")],
    requests: [{ artist: "Queen", song: "Song A", genre: "Rock" }], inEvent: [{ artist: "Queen", song: "Song A" }],
    feedback: [], dismissed: [], controls: { ...base, ...controls }, ...extra,
  });
  it("explains score with exactly the rank inputs", () => {
    const top = input().items[0];
    expect(top.artist).toBe("Queen");
    expect(top.evidence.reduce((n, e) => n + e.points, 0)).toBeCloseTo(top.score, 5);
    expect(top.evidence.map(e => e.kind)).toContain("artist");
  });
  it("familiarity control changes ranking and labels play counts as personal", () => {
    const r = input({ familiarity: 1, clientSimilarity: 0 });
    expect(r.items[0].song).toBe("Played");
    expect(r.items[0].evidence[0].text).toMatch(/your familiarity, not crowd/);
    expect(input({ clientSimilarity: 0, familiarity: 0 }).items.every(i => i.evidence.length === 0)).toBe(true);
  });
  it("artist variety penalises repeats; owned-only hides catalogue songs", () => {
    const v = input({ artistVariety: 1 });
    expect(v.items.find(i => i.song === "Song B")!.evidence.some(e => e.kind === "variety")).toBe(true);
    const o = input({ ownedOnly: true });
    expect(o.items.some(i => i.song === "Fresh")).toBe(false);
    expect(o.hidden.notOwned).toBe(1);
  });
  it("event dismiss is scoped to the event; never-recommend is global; undo restores", () => {
    let k = dismissForEvent(emptyKnowledge(), "E1", "Queen", "Song B");
    expect(input({}, { dismissed: eventPrep(k, "E1").dismissed }).items.some(i => i.song === "Song B")).toBe(false);
    expect(input({}, { dismissed: eventPrep(k, "E2").dismissed }).items.some(i => i.song === "Song B")).toBe(true);
    k = undoDismiss(k, "E1", songIdentity("Queen", "Song B"));
    expect(eventPrep(k, "E1").dismissed).toEqual([]);
    const g = setFeedback(emptyKnowledge(), "Queen", "Song B", "never");
    expect(input({}, { feedback: g.feedback }).items.some(i => i.song === "Song B")).toBe(false);
  });
  it("songs already in the event (client requests) are never re-suggested or removed", () => {
    expect(input().items.some(i => i.song === "Song A")).toBe(false);
    expect(input().hidden.inEvent).toBe(0); // "Song A" is not a candidate here; requests are input, not output
  });
});

describe("dashboard uses export-readiness semantics", () => {
  const sections = [{ key: "warmUp", label: "Warm Up", songs: [
    { artist: "A", song: "1" }, { artist: "A", song: "2" }, { artist: "B", song: "3", fromUpload: true },
    { artist: "C", song: "4" }, { artist: "D", song: "5", genre: "Pop", year: 1985 }, { artist: "E", song: "6" },
  ] }];
  const matches: Record<string, SongMatch> = {
    "warmUp:0": { status: "Matched", confidence: 1, trackIndex: 0, alternatives: [], confirmed: true, extraTrackIndices: [3] },
    "warmUp:1": { status: "Multiple Matches", confidence: 0.7, trackIndex: 1, alternatives: [2] },
    "warmUp:3": { status: "Matched", confidence: 1, trackIndex: 99, alternatives: [], confirmed: true },
    "warmUp:4": { status: "Matched", confidence: 1, trackIndex: 2, alternatives: [], confirmed: true, excludedFromVdj: true },
    "warmUp:5": { status: "Matched", confidence: 1, trackIndex: 0, alternatives: [], confirmed: true, extraTrackIndices: [98] },
  };
  const tracks: (DashTrack | undefined)[] = [{ durationSec: 200, genre: "Rock" }, { durationSec: 999 }, {}, { durationSec: 100 }];
  const d = buildDashboard(sections, matches, (s, i) => `${s}:${i}`, i => tracks[i]);
  const sec = d.sections[0];
  it("classifies excluded, unlinked, missing-from-index and pending rows exclusively", () => {
    expect(sec.excluded.map(x => x.index)).toEqual([4]);
    expect(sec.notLinked.map(x => x.index)).toEqual([2]);
    expect(sec.linkedMissing.map(x => x.index)).toEqual([3, 5]);
    expect(sec.linkedMissing[1].detail).toMatch(/1 of 2/);
    expect(sec.pending.map(x => x.index)).toEqual([1]);
    expect(sec.confirmed).toBe(1); // a confirmed flag on a missing track is not confirmed
  });
  it("adds explicitly selected extra tracks to length and labels estimates", () => {
    expect(sec.knownSec).toBe(300);
    expect(sec.unknownDuration.map(x => x.index)).toEqual([1, 2, 3, 5]);
    expect(sec.estimateBasis).toMatch(/Estimate: 4 unknown lengths .*150 s/);
  });
  it("prefers approved track tags and counts event metadata as tentative", () => {
    expect(d.genres.find(g => g.label === "Rock")?.count).toBe(1);
    expect(d.tentativeGenre).toBe(1); // "Pop" came from the event row, not a track tag
    expect(d.tentativeDecade).toBe(1);
  });
});

describe("shortlist and groups", () => {
  it("dedupes by exact identity but keeps different versions separate", () => {
    let k = addShortlist(emptyKnowledge(), "E", { artist: "A", song: "T" }).next;
    expect(addShortlist(k, "E", { artist: " a ", song: "t" }).added).toBe(false);
    k = addShortlist(k, "E", { artist: "A", song: "T", versionNote: "clean" }).next;
    k = addShortlist(k, "E", { artist: "A", song: "T (Remix)" }).next;
    expect(eventPrep(k, "E").shortlist).toHaveLength(3);
    expect(eventPrep(k, "E").shortlist.every(s => s.status === "considering")).toBe(true);
  });
  it("copying a group leaves the group unchanged and only touches that event", () => {
    let k: PrepKnowledge = createGroup(emptyKnowledge(), "Singalongs", [{ artist: "A", song: "T" }, { artist: "B", song: "U" }]);
    const before = structuredClone(k.groups);
    k = addShortlist(k, "E", { artist: "A", song: "T" }).next;
    const r = copyGroupToEvent(k, k.groups[0].id, "E");
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    expect(r.next.groups).toEqual(before);
    expect(eventPrep(r.next, "Other").shortlist).toEqual([]);
  });
  it("one local file cannot be linked to two shortlist entries", () => {
    let k = addShortlist(emptyKnowledge(), "E", { artist: "A", song: "T" }).next;
    k = addShortlist(k, "E", { artist: "B", song: "U" }).next;
    const [a, b] = eventPrep(k, "E").shortlist;
    k = linkShortlistFile(k, "E", a.id, "/m/a.mp3");
    expect(() => linkShortlistFile(k, "E", b.id, "/m/a.mp3")).toThrow();
  });
  it("track notes are keyed by exact file identity", () => {
    const k = setTrackNote(emptyKnowledge(), "/m/Song.mp3", { tags: ["First Dance", "first dance"] });
    expect(k.tracks).toEqual([expect.objectContaining({ id: "/m/Song.mp3", tags: ["first dance"] })]);
    expect(k.tracks.find(t => t.id === "/m/song.mp3")).toBeUndefined();
  });
});

describe("enrichment", () => {
  it("flags remix/clean version differences instead of treating them as the same recording", () => {
    const same = compareCandidate({ artist: "A", title: "Song" }, { artist: "A", title: "Song", lengthSec: null });
    const remix = compareCandidate({ artist: "A", title: "Song" }, { artist: "A", title: "Song (Club Remix)" });
    expect(same.versionMismatch).toBe(false);
    expect(remix.versionMismatch).toBe(true);
    expect(remix.confidence).toBeLessThan(same.confidence);
  });
  it("ignores stale lookup results after subject or account changes", () => {
    const g = createLookupGuard();
    const t1 = g.begin("A", "x|y");
    expect(g.current(t1, "A", "x|y")).toBe(true);
    expect(g.current(t1, "B", "x|y")).toBe(false);
    const t2 = g.begin("A", "z|w");
    expect(g.current(t1, "A", "x|y")).toBe(false);
    expect(t1.signal.aborted).toBe(true);
    g.cancel(); expect(g.current(t2, "A", "z|w")).toBe(false);
  });
});

describe("backups", () => {
  const base = { format: "setarchitect-backup", version: 1, account: "A", createdAt: new Date().toISOString(), events: [], sources: [], roots: {} };
  it("legacy backups without prep still validate", () => { expect(validateBackup(JSON.stringify(base), "A").prep).toBeUndefined(); });
  it("valid prep round-trips; invalid prep is rejected", () => {
    const prep = setFeedback(emptyKnowledge(), "A", "T", "never");
    expect(validateBackup(JSON.stringify({ ...base, prep }), "A").prep).toEqual(prep);
    expect(() => validateBackup(JSON.stringify({ ...base, prep: { version: 1, presets: 3 } }), "A")).toThrow();
  });
  it("additive restore keeps existing entries and adds missing ones", () => {
    const cur = setFeedback(emptyKnowledge(), "A", "T", "favor");
    const inc = setFeedback(setFeedback(emptyKnowledge(), "A", "T", "never"), "B", "U", "never");
    const r = mergeKnowledgeAdditive(cur, inc);
    expect(r.added).toBe(1);
    expect(r.next.feedback.find(f => f.key === songIdentity("A", "T"))!.kind).toBe("favor");
    expect(readKnowledge(r.next)).not.toBeNull();
  });
  it("store restore is fenced to the account", async () => {
    const s = createPrepStore(memBackend()); await s.setAccount("A");
    const a = s.owner()!; await s.setAccount("B");
    await expect(s.restoreAdditive(a, emptyKnowledge())).rejects.toThrow();
    expect(s.get().knowledge).toEqual(emptyKnowledge());
  });
});

describe("lookup parsers and throttle (fixtures)", () => {
  it("parses MusicBrainz recordings, drops invalid ids and strips markup", () => {
    const body = { recordings: [
      { id: "b1a9c0e9-d987-4042-ae91-78d6a3267d69", title: "Bohemian <b>Rhapsody</b>", length: 354000, "first-release-date": "1975-10-31", "artist-credit": [{ name: "Queen" }], releases: [{ title: "A Night at the Opera" }], tags: [{ name: "rock", count: 9 }, { name: "classic", count: 2 }], isrcs: ["GBUM71029604"], score: 100 },
      { id: "not-an-id", title: "x" },
    ] };
    const [c, ...rest] = parseMbRecordings(body);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ artist: "Queen", lengthSec: 354, firstRelease: "1975-10-31", tags: ["rock", "classic"] });
    expect(c.title).not.toMatch(/[<>]/);
    expect(parseMbRecordings({ error: "x" })).toEqual([]);
  });
  it("parses Last.fm tags/similar and tolerates missing sections", () => {
    const r = parseLastfm({ toptags: { tag: [{ name: "80s" }] } }, { similartracks: { track: [{ name: "Song", match: "0.7", artist: { name: "Band" } }, { name: "", artist: {} }] } }, "A", "T");
    expect(r).toMatchObject({ available: true, tags: ["80s"], similar: [{ artist: "Band", title: "Song", match: 0.7 }] });
    expect(parseLastfm(null, null, "A", "T")).toMatchObject({ tags: [], similar: [] });
  });
  it("bounds the MusicBrainz queue instead of waiting indefinitely", async () => {
    let t = 0; const gate = createThrottle(1100, 4000, () => t, async ms => { t += 0 * ms; });
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await gate());
    expect(results.filter(Boolean).length).toBe(4); // waits 0, 1.1, 2.2, 3.3 s; 4.4 s exceeds the 4 s cap
    expect(results.at(-1)).toBe(false);
  });
});

describe("add to section", () => {
  const lib = buildLibrary([{ filePath: "/m/a.mp3", artist: "A", title: "T" } as VdjTrack]);
  const base = { warmUp: [{ artist: "X", song: "Y" }], transition: [], peak: [] };
  const key = (s: string, i: number) => `${s}:${i}`;
  it("never pre-approves; explicit link uses exact identity; refuses duplicates and missing links", () => {
    const r = planAddToSection(base, "peak", { artist: "A", song: "T", trackId: "/m/a.mp3" }, lib, {}, key, () => undefined);
    expect("error" in r).toBe(false);
    if (!("error" in r)) { expect(r.match).toMatchObject({ trackIndex: 0, confirmed: false, status: "Possible Match" }); expect(r.result.peak).toHaveLength(1); expect(base.peak).toHaveLength(0); }
    expect(planAddToSection(base, "peak", { artist: "x", song: " y" }, lib, {}, key, () => undefined)).toMatchObject({ error: expect.stringMatching(/already/) });
    expect(planAddToSection(base, "peak", { artist: "A", song: "T", trackId: "/gone.mp3" }, lib, {}, key, () => undefined)).toMatchObject({ error: expect.stringMatching(/isn't in your current library/) });
  });
});

describe("historical native backup validators accept the optional prep section", () => {
  const req = createRequire(import.meta.url);
  const commits = execFileSync("git", ["log", "--format=%h", "-n", "12", "--", "desktop/backups.cjs", "desktop/backup-policy.json"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const prep = setTrackNote(addShortlist(createGroup(savePreset(emptyKnowledge(), "Fast", "library", { ...EMPTY_FILTER, bpm: [120, 130] }), "G", [{ artist: "A", song: "T", trackId: "/m/a.mp3" }]), "E", { artist: "A", song: "T" }).next, "/m/a.mp3", { tags: ["first dance"], note: "n" });
  const raw = JSON.stringify({ format: "setarchitect-backup", version: 1, account: "acct", createdAt: new Date().toISOString(), events: [], sources: [], roots: {}, prep });
  it.each(commits)("validator at %s", commit => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "prep-validator-")); mkdirSync(path.join(dir, "desktop"));
    for (const f of ["backups.cjs", "backup-policy.json"]) {
      try { writeFileSync(path.join(dir, "desktop", f), execFileSync("git", ["show", `${commit}:desktop/${f}`])); } catch { /* file absent at that commit */ }
    }
    const mod = req(path.join(dir, "desktop", "backups.cjs"));
    const validate = mod.validate ?? mod.validateBackup ?? mod._validate;
    if (validate) { expect(() => validate(raw, "acct")).not.toThrow(); return; }
    // Older module shape: exercise save() through a temp profile, which validates internally.
    const store = mod.createBackupStore(dir);
    return expect(store.save(raw, "acct")).resolves.toBeTruthy();
  });
});
