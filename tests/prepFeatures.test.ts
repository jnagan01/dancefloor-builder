import { describe, expect, it, vi } from "vitest";
import { EMPTY_FILTER, facetOptions, matchesFilter, trackFacts, readFilter, type FilterFacts } from "../src/lib/prep/filters";
import {
  emptyKnowledge, savePreset, readKnowledge, addShortlist, createGroup, copyGroupToEvent, linkShortlistFile, dismissForEvent, undoDismiss,
  setFeedback, eventPrep, mergeKnowledgeAdditive, setTrackNote, songIdentity, type PrepKnowledge,
} from "../src/lib/prep/knowledge";
import { createPrepStore, type PrepBackend } from "../src/lib/prep/prepStore";
import { recommend, type Candidate, type RecControls } from "../src/lib/prep/recommend";
import { buildDashboard } from "../src/lib/prep/dashboard";
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
  it("rejects malformed saved filters", () => { expect(readFilter({ ...EMPTY_FILTER, bpm: [5] })).toBeNull(); });
  it("filters 31,250 tracks quickly", () => {
    const many = Array.from({ length: 31250 }, (_, i) => trackFacts(track({ filePath: `/m/${i}.mp3`, bpm: i % 3 ? String(80 + (i % 60)) : undefined, genre: i % 5 ? "House" : undefined, songLength: String(180 + (i % 200)) })));
    const t0 = performance.now();
    const n = many.filter(x => matchesFilter(x, { ...EMPTY_FILTER, bpm: [120, 130], genres: ["house"], duration: [200, 300] }, "library")).length;
    facetOptions(many);
    expect(n).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it("reads VirtualDJ SongLength as seconds", () => {
    const xml = `<VirtualDJ_Database><Song FilePath="/m/x.mp3"><Tags Author="A" Title="T"/><Infos SongLength="215.6"/></Song></VirtualDJ_Database>`;
    expect(parseVdjDatabaseXml(xml)[0]?.songLength).toBe("216");
  });
});

describe("account-scoped preparation store", () => {
  it("persists presets per account and isolates accounts", async () => {
    const be = memBackend(), s = createPrepStore(be);
    await s.setAccount("A");
    await s.update("A", k => savePreset(k, "Fast", "library", { ...EMPTY_FILTER, bpm: [120, 130] }));
    await s.setAccount("B");
    expect(s.get().knowledge.presets).toEqual([]);
    const fresh = createPrepStore(be); await fresh.setAccount("A");
    expect(fresh.get().knowledge.presets.map(p => p.name)).toEqual(["Fast"]);
  });
  it("blocks writes and preserves unreadable saved data", async () => {
    const be = memBackend({ "prepKnowledge:A": { version: 1, presets: "bad" } }), s = createPrepStore(be);
    await s.setAccount("A");
    expect(s.get().status).toBe("blocked");
    await expect(s.update("A", k => setFeedback(k, "x", "y", "never"))).rejects.toThrow();
    expect(be.data.get("prepKnowledge:A")).toEqual({ version: 1, presets: "bad" });
  });
  it("keeps last-good copy when a write fails", async () => {
    const be = memBackend(), s = createPrepStore(be); await s.setAccount("A");
    await s.update("A", k => setFeedback(k, "x", "y", "favor"));
    be.fail = true;
    await expect(s.update("A", k => setFeedback(k, "x", "y", "never"))).rejects.toThrow("disk full");
    expect(s.get().knowledge.feedback[0].kind).toBe("favor");
  });
  it("drops an in-flight save's result after an account switch", async () => {
    const be = memBackend(), s = createPrepStore(be); await s.setAccount("A");
    let open!: () => void; be.gate = new Promise(r => { open = r; });
    const p = s.update("A", k => setFeedback(k, "x", "y", "never"));
    await s.setAccount("B");
    open();
    await expect(p).rejects.toThrow(/Account changed/);
    expect(s.get().account).toBe("B");
    expect(s.get().knowledge.feedback).toEqual([]);
    await expect(s.update("A", k => k)).rejects.toThrow(/Account changed/);
  });
  it("sign-out clears in-memory knowledge", async () => {
    const s = createPrepStore(memBackend()); await s.setAccount("A");
    await s.update("A", k => setFeedback(k, "x", "y", "never"));
    await s.setAccount(null);
    expect(s.get()).toMatchObject({ status: "signedOut", account: null });
    expect(s.get().knowledge.feedback).toEqual([]);
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

describe("dashboard", () => {
  const sections = [{ key: "warmUp", label: "Warm Up", songs: [{ artist: "A", song: "1" }, { artist: "A", song: "2" }, { artist: "B", song: "3", fromUpload: true }] }];
  const matches: Record<string, SongMatch> = {
    "warmUp:0": { status: "Matched", confidence: 1, trackIndex: 0, alternatives: [], confirmed: true },
    "warmUp:1": { status: "Multiple Matches", confidence: 0.7, trackIndex: 1, alternatives: [2] },
  };
  const tracks = [{ durationSec: 200 }, { durationSec: 999 }, {}];
  const d = buildDashboard(sections, matches, (s, i) => `${s}:${i}`, i => tracks[i]);
  it("counts only confirmed lengths and labels estimates", () => {
    expect(d.sections[0].knownSec).toBe(200);
    expect(d.sections[0].unknownDuration).toHaveLength(2);
    expect(d.sections[0].estimateBasis).toMatch(/Estimate: 2 unknown lengths .*200 s/);
    expect(d.totals).toMatchObject({ pending: 1, missing: 1, alternates: 1, confirmed: 1 });
    expect(d.artistRepeats[0]).toMatchObject({ artist: "A", count: 2 });
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
    await expect(s.restoreAdditive("B", emptyKnowledge())).rejects.toThrow();
    vi.restoreAllMocks();
  });
});
