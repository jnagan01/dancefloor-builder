import { describe, it, expect, vi, afterEach } from "vitest";
import { parseFile, generateLists, equalSplit } from "@/lib/danceFloor";
import { folderRootsProblem, getFolderRoots, setFolderRoot, resolveExportPath, buildM3u, buildLibrary } from "@/lib/virtualDj";
import { readEventSnapshot } from "@/lib/snapshotSafety";
import { createWorkspaceIndexes } from "@/lib/workspaceIndexes";
import { storeEventDraft, loadEventDraft, confirmEventDraft } from "@/lib/eventDrafts";
import { createEventAutosave } from "@/lib/eventAutosave";
import { writeEventConditionally } from "@/lib/eventWriteContract";
import { EVENT_REVISION_FIELD } from "@/lib/eventRevision";
import { validSavedLibrary, loadMusicLibrary, saveMusicLibrary } from "@/lib/libraryStore";
const track = (filePath: string, title = "Old") => ({ filePath, artist: "A", title, bpm: "90" });
const prefs = { artists: [], genres: [], decades: [], notes: "" };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } } as Storage;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("stress findings 5–11: validation and preservation", () => {
  it("retains nonblank partial CSV rows through generation", async () => {
    const songs = await parseFile(new File(["Artist,Song\n,Only Title\nOnly Artist,\n,\nA,Valid\n"], "client.csv"));
    expect(songs).toHaveLength(3);
    const r = generateLists({ uploaded: songs, hours: 1, prefs, expand: false });
    expect([...r.warmUp, ...r.transition, ...r.peak]).toHaveLength(3);
    expect([...r.warmUp, ...r.transition, ...r.peak].some(s => s.artist === "Unknown Artist" && s.song === "Only Title")).toBe(true);
  });
  it("retains internal TXT title separators", async () => {
    expect(await parseFile(new File(["A - Song - Live"], "client.txt"))).toEqual([{ artist: "A", song: "Song - Live" }]);
  });
  it.each(["null", "[]", "3", '{"Music":3}', "{bad"])("invalid roots %s cannot be overwritten", raw => {
    const s = storage(); s.setItem("dancefloor:musicFolderRoots", raw); vi.stubGlobal("localStorage", s);
    expect(folderRootsProblem()).toBeTruthy(); expect(resolveExportPath("Music/Song.mp3", getFolderRoots())).toBeNull();
    expect(() => setFolderRoot("Music", "/mock/Music")).toThrow(); expect(s.getItem("dancefloor:musicFolderRoots")).toBe(raw);
  });
  it("inherited labels never resolve; own special labels are safe", () => {
    expect(resolveExportPath("constructor/Song.mp3", {})).toBeNull();
    expect(resolveExportPath("toString/Song.mp3", {})).toBeNull();
    expect(resolveExportPath("__proto__/Song.mp3", {})).toBeNull();
    const s = storage(); vi.stubGlobal("localStorage", s); setFolderRoot("__proto__", "/mock/Music");
    expect(resolveExportPath("__proto__/Song.mp3")).toBe("/mock/Music/Song.mp3");
  });
  it.each([[null], [{ label: "Music", tracks: "bad" }], [{ label: "Music", tracks: [{ filePath: 2 }] }]])("rejects nested malformed library %j", sources => {
    expect(validSavedLibrary({ version: 1, savedAt: 1, sources })).toBe(false);
  });
  it("restores missing legacy sections and retains selections/unknown fields", () => {
    const { snapshot } = readEventSnapshot({ inputs: { custom: "keep" }, lists: { warmUp: [{ artist: "A", song: "One" }], selections: { legacy: { paths: ["Music/One.mp3"] } }, extra: 7 } });
    expect(snapshot.lists.transition).toEqual([]); expect(snapshot.lists.peak).toEqual([]);
    expect(snapshot.inputs.custom).toBe("keep"); expect(snapshot.lists.extra).toBe(7); expect(snapshot.lists.selections?.legacy.paths).toEqual(["Music/One.mp3"]);
  });
  it("malformed snapshots fail without mutation", () => {
    const original = { inputs: {}, lists: { warmUp: "bad" } };
    expect(() => readEventSnapshot(original)).toThrow("preserved"); expect(original.lists.warmUp).toBe("bad");
  });
  it("out-of-range legacy duration remains intact and read-only", () => {
    const result = readEventSnapshot({ inputs: { hours: "1000" }, lists: {} });
    expect(result.snapshot.inputs.hours).toBe("1000"); expect(result.problem).toContain("read-only");
  });
  it.each([NaN, Infinity, -1, 1e9])("rejects unsafe generation hours %s", hours => {
    expect(() => generateLists({ uploaded: [], hours, prefs, expand: false })).toThrow();
    expect(() => equalSplit(hours)).toThrow();
  });
  it("accepts boundary durations and rejects invalid splits/buffers", () => {
    expect(generateLists({ uploaded: [], hours: 24, buffer: 4, prefs, expand: false }).targetTotal).toBe(1440);
    expect(() => generateLists({ uploaded: [], hours: 1, buffer: Infinity, prefs, expand: false })).toThrow();
    expect(() => generateLists({ uploaded: [], hours: 1, split: { warmUp: NaN, transition: 20, peak: 20 }, prefs, expand: false })).toThrow();
  });
  it("rejects CR/LF paths and normalizes only display metadata", () => {
    const item = { song: { artist: "A", song: "Song" }, match: { status: "Matched" as const, trackIndex: 0, alternatives: [], confidence: 1 } };
    const t = track("/mock/line\n#EXTINF:0,Injected.mp3");
    expect(() => buildM3u([item], buildLibrary([t]))).toThrow("No playlist was written");
    const normal = track("/mock/Song.mp3", "Song\nLive"); normal.artist = "A\rB";
    expect(buildM3u([item], buildLibrary([normal]))).toContain("A B - Song Live"); expect(normal.title).toBe("Song\nLive");
  });
});

describe("finding 3: durable account/event recovery", () => {
  it("survives reload, isolates account/event, and clears only confirmed latest draft", () => {
    const s = storage(); const draft = { version: 1 as const, account: "A", event: "E", token: "one", createId: "stable", baseVersion: "v1", snapshot: { name: "latest" }, savedAt: 1 };
    storeEventDraft(draft, s); expect(loadEventDraft("A", "E", s)?.snapshot).toEqual({ name: "latest" });
    expect(loadEventDraft("B", "E", s)).toBeNull(); expect(loadEventDraft("A", "F", s)).toBeNull();
    storeEventDraft({ ...draft, token: "two" }, s); confirmEventDraft("A", "E", "one", s); expect(loadEventDraft("A", "E", s)?.token).toBe("two");
    confirmEventDraft("A", "E", "two", s); expect(loadEventDraft("A", "E", s)).toBeNull();
  });
  it("quota errors are surfaced and do not delete the previous draft", () => {
    const s = storage(); s.setItem("sentinel", "original"); s.setItem = () => { throw new Error("QuotaExceededError"); };
    expect(() => storeEventDraft({ version: 1, account: "A", event: "E", token: "one", createId: "stable", baseVersion: null, snapshot: {}, savedAt: 1 }, s)).toThrow("Quota");
    expect(s.getItem("sentinel")).toBe("original");
  });
  it("draft persists when the coordinator resets before debounce completes", async () => {
    vi.useFakeTimers(); const s=storage(); const snapshot={ name:"unsaved" };
    storeEventDraft({ version:1, account:"A", event:"E", token:"t", createId:"id", baseVersion:"v1", snapshot, savedAt:1 },s);
    const write=vi.fn(async()=>({id:"E"})); const q=createEventAutosave({write,onState:vi.fn(),onId:vi.fn(),onError:vi.fn()});
    q.schedule(snapshot,"E",()=>true);q.reset();await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();expect(loadEventDraft("A","E",s)?.snapshot).toEqual(snapshot);
  });
});

describe("finding 2: unknown-outcome save isolation", () => {
  it("hung A permits B, aborts at timeout, and late A cannot mark B saved", async () => {
    vi.useFakeTimers(); let resolveA: (v: { id: string }) => void = () => {};
    const write = vi.fn((id: string | null) => id === "A" ? new Promise<{ id: string }>(r => { resolveA = r; }) : Promise.resolve({ id: "B" }));
    const onId = vi.fn(); const onState = vi.fn();
    const q = createEventAutosave({ write, onId, onState, onError: vi.fn(), timeoutMs: 20, safeWriteContract: true });
    q.schedule("a", "A", () => true, 0); await vi.advanceTimersByTimeAsync(0); q.reset(); q.schedule("b", "B", () => true, 0); await vi.advanceTimersByTimeAsync(0);
    expect(onId).toHaveBeenLastCalledWith("B"); await vi.advanceTimersByTimeAsync(20); resolveA({ id: "A" }); await vi.advanceTimersByTimeAsync(0);
    expect(onId.mock.calls).toEqual([["B"]]); q.reset();
  });
  it("timeout retries use the same create UUID and expected version", async () => {
    vi.useFakeTimers(); const attempts: any[] = [];
    const q = createEventAutosave({ write: (_id, _s, attempt) => { attempts.push(attempt); return new Promise(() => {}); }, onId: vi.fn(), onState: vi.fn(), onError: vi.fn(), timeoutMs: 10, safeWriteContract: true });
    q.configure(null, null, "stable-create"); q.schedule("create", null, () => true, 0); await vi.advanceTimersByTimeAsync(10); q.retry(); await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toHaveLength(2); expect(attempts.map(a => a.createId)).toEqual(["stable-create", "stable-create"]); expect(attempts[0].signal.aborted).toBe(true); q.reset();
  });
  it("unsafe writers never overlap uncertain same-record writes", async () => {
    vi.useFakeTimers(); const write = vi.fn(() => new Promise<{ id: string }>(() => {}));
    const q = createEventAutosave({ write, onId: vi.fn(), onState: vi.fn(), onError: vi.fn(), timeoutMs: 10 });
    q.schedule("a", "A", () => true, 0); await vi.advanceTimersByTimeAsync(10); q.retry(); await vi.advanceTimersByTimeAsync(0); expect(write).toHaveBeenCalledTimes(1); q.reset();
  });
});

describe("performance caches retain collision invariants", () => {
  it("metadata-only edits reuse audio/native indexes but refresh library tags", () => {
    const cache = createWorkspaceIndexes(); const roots = { Music: "/mock/Music" }, files: File[] = [];
    let sources = [{ label: "Music", tracks: [track("Music/Song.mp3")] }];
    let paths = cache.paths(sources); const a = cache.audio(files, paths, roots); const maps = new Map([["Music", new Map([["Music/Song.mp3", "/mock/Music/Song.mp3"]])]]);
    const native = cache.native(1, maps, paths, roots);
    sources = [{ label: "Music", tracks: [track("Music/Song.mp3", "Edited")] }]; paths = cache.paths(sources);
    expect(cache.audio(files, paths, roots)).toBe(a); expect(cache.native(1, maps, paths, roots)).toBe(native); expect(cache.library(sources).tracks[0].title).toBe("Edited");
    cache.paths([...sources, { label: "Other", tracks: [track("Other/Song.mp3")] }]); expect(cache.audio(files, paths, roots)).not.toBe(a);
    expect(cache.native(2, maps, paths, roots)).not.toBe(native);
  });
});
function fakeEventDb() {
  const rows = new Map<string, any>(); let serial = 0;
  return { rows, db: { from: () => {
    let mode = 'read', payload: any, filters: Record<string, unknown> = {};
    const chain: any = {
      upsert: async (value: any) => { if (!rows.has(value.id)) rows.set(value.id, { ...value, updated_at: new Date(++serial).toISOString() }); return { error: null }; },
      update: (value: any) => { mode = 'update'; payload = value; return chain; },
      select: () => chain, eq: (k: string, v: unknown) => { filters[k] = v; return chain; }, is: (k:string,v:unknown)=>{filters[k]=v;return chain;},
      maybeSingle: async () => { const row = rows.get(filters.id as string); if (!row || Object.entries(filters).some(([k,v]) => k.startsWith('inputs->>') ? row.inputs[EVENT_REVISION_FIELD]!==v : k.startsWith('inputs->') ? Object.hasOwn(row.inputs,EVENT_REVISION_FIELD) : row[k] !== v)) return { data: null, error: null };
        if (mode === 'update') Object.assign(row, payload, { updated_at: new Date(++serial).toISOString() }); return { data: { ...row }, error: null }; },
    }; return chain;
  } } };
}
describe('atomic existing-schema save contract', () => {
  it('stable create UUID deduplicates a lost creation response', async () => {
    const { db, rows } = fakeEventDb(); const request = { id: 'stable', create: true, expectedUpdatedAt: null, expectedRevision:null, writeRevision:crypto.randomUUID(), name: 'A', inputs: { nested: 1 }, lists: {} };
    const first = await writeEventConditionally(db, 'owner', request); const second = await writeEventConditionally(db, 'owner', request);
    expect(rows.size).toBe(1); expect(second).toEqual(first);
  });
  it('late timed-out same-version update cannot overwrite a newer committed snapshot', async () => {
    const { db, rows } = fakeEventDb(); const base = { id: 'A', create: true, expectedUpdatedAt: null, expectedRevision:null, writeRevision:crypto.randomUUID(), name: 'initial', inputs: {}, lists: {} };
    const first = await writeEventConditionally(db, 'owner', base);
    const fresh = { ...base, create: false, expectedUpdatedAt: first.updatedAt, expectedRevision:first.revision,writeRevision:crypto.randomUUID(), name: 'newer' };
    await writeEventConditionally(db, 'owner', fresh);
    await expect(writeEventConditionally(db, 'owner', { ...fresh, name: 'late older' })).rejects.toThrow('changed elsewhere');
    expect(rows.get('A').name).toBe('newer');
  });
  it('lost update response is acknowledged only if payload still matches', async () => {
    const { db } = fakeEventDb(); const base = { id: 'A', create: true, expectedUpdatedAt: null, expectedRevision:null,writeRevision:crypto.randomUUID(), name: 'initial', inputs: {}, lists: {} };
    const first = await writeEventConditionally(db, 'owner', base); const update = { ...base, create: false, expectedUpdatedAt: first.updatedAt, expectedRevision:first.revision,writeRevision:crypto.randomUUID(), name: 'latest' };
    const saved = await writeEventConditionally(db, 'owner', update);
    expect(await writeEventConditionally(db, 'owner', update)).toEqual(saved);
    await expect(writeEventConditionally(db, 'other-owner', update)).rejects.toThrow();
  });
});
function mockIdb(value: unknown, failWrite = false) {
  const puts = vi.fn(); const deletes = vi.fn();
  const db = { close: vi.fn(), transaction: (_store: string, mode: string) => {
    const tx: any = { objectStore: () => ({
      get: () => { const req: any = {}; queueMicrotask(() => { req.result = value; req.onsuccess(); }); return req; },
      put: (...args: any[]) => { puts(...args); if (failWrite) throw new Error('QuotaExceededError'); queueMicrotask(() => tx.oncomplete?.()); }, delete: deletes,
    }) }; return tx;
  } };
  vi.stubGlobal('indexedDB', { open: () => { const req: any = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } });
  return { puts, deletes };
}
describe('saved library storage failures preserve original', () => {
  it('corrupted account record fails closed without fallback/write/delete', async () => {
    const { puts, deletes } = mockIdb({ version: 1, savedAt: 1, sources: [null] });
    await expect(loadMusicLibrary('owner')).rejects.toThrow('preserved'); expect(puts).not.toHaveBeenCalled(); expect(deletes).not.toHaveBeenCalled();
  });
  it('quota write failure returns explicit failure without deleting old index', async () => {
    const { deletes } = mockIdb(undefined, true);
    expect(await saveMusicLibrary([{ label: 'Music', tracks: [track('Music/Song.mp3')] }], 'owner')).toBeNull(); expect(deletes).not.toHaveBeenCalled();
  });
});
