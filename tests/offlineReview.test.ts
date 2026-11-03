import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as vdj from "@/lib/virtualDj"; import * as bridge from "@/lib/desktopBridge"; import * as audio from "@/lib/audioMatch"; import * as identity from "@/lib/fileIdentity"; import * as metadata from "@/lib/trackMetadataIdentity"; import * as cache from "@/lib/workspaceFileCache"; import * as safety from "@/lib/nativeScanSafety"; import * as workspaceIndexes from "@/lib/workspaceIndexes"; import * as trackRevisions from "@/lib/trackRevisions"; import * as backups from "@/lib/backups";
import * as offlineAccess from "@/lib/offlineAccess";
import { dedupeKey } from "@/lib/danceFloor";

const require = createRequire(import.meta.url);
const core = require("../desktop/offline/core.js");
const { createOfflineStore } = require("../desktop/offline-store.cjs");
// The store accepts a prepare only for the account most recently reported as signed in.
const seen = async <T extends { accountSeen(a: string): Promise<void> }>(s: T, account: string) => { await s.accountSeen(account); return s; };
const { createOfflineWorkspace, ENTRY } = require("../desktop/offline-window.cjs");
const { harness, deferred } = require("./helpers/workspaceHarness.cjs").createHarnessModules({ vdj, bridge, audio, identity, metadata, cache, safety, workspaceIndexes, trackRevisions, backups });

const A = "synthetic-owner-a";
const songs = [{ artist: "Test Artist", song: "Song" }];
const raw = (account = A, lists: Record<string, unknown> = { warmUp: songs, transition: [], peak: [], selections: { [core.songKey("warmUp", 0, songs[0])]: { paths: ["M/a/Song.mp3"], confirmed: true } } }, inputs: Record<string, unknown> = { songs: [] }) =>
  JSON.stringify({ format: "setarchitect-backup", version: 1, account, createdAt: new Date().toISOString(), events: [{ id: "E1", snapshot: { name: "Synthetic", inputs, lists } }], sources: [{ label: "M", tracks: [{ filePath: "M/a/Song.mp3", artist: "Test Artist", title: "Song" }, { filePath: "M/b/Song.mp3", artist: "Test Artist", title: "Song" }] }], roots: { M: "/synthetic/music" } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "offline-review-"));
const marker = (dir: string) => fs.existsSync(path.join(dir, "offline", "active.json"));

/** fs whose N-th open() waits on a latch, so revocations can land mid-prepare. */
function delayedFs(hold: number) {
  let n = 0; const latch = deferred(), reached = deferred();
  const f = { ...fs, promises: { ...fs.promises, open: async (...a: Parameters<typeof fs.promises.open>) => { if (++n === hold) { reached.resolve(); await latch.promise; } return fs.promises.open(...a); } } };
  return { f, latch, reached };
}

describe("finding 1: prepare is fenced and serialized in the main process", () => {
  // The marker itself is committed synchronously after the last await, so the latest interleaving point
  // is the final snapshot write (hold 3 = replacement copy after a baseline prepare: snapshot, prev, snapshot).
  for (const [label, hold] of [["while writing the snapshot", 1], ["while writing the replacement copy just before the marker", 3]] as const) {
    it(`sign-out ${label} prevents the marker, also after cold restart`, async () => {
      const dir = tmp(), d = delayedFs(hold), store = createOfflineStore(dir, d.f);
      if (hold === 3) { await (await seen(store, A)).prepare(raw(), A); }
      const p = (await seen(store, A)).prepare(raw(), A);
      await d.reached.promise;
      const out = store.invalidate();
      d.latch.resolve();
      await expect(p).rejects.toThrow("changed");
      await out;
      expect(marker(dir)).toBe(false);
      expect((await createOfflineStore(dir).loadActive()).state).toBe("none");
    });
  }
  it("a different account seen mid-prepare revokes; a stale prepare cannot recreate access", async () => {
    const dir = tmp(), d = delayedFs(1), store = createOfflineStore(dir, d.f);
    const p = (await seen(store, A)).prepare(raw(), A);
    await d.reached.promise;
    const seenB = store.accountSeen("synthetic-owner-b");
    d.latch.resolve();
    await expect(p).rejects.toThrow();
    await seenB;
    expect(marker(dir)).toBe(false);
    await expect(store.prepare(raw(), A)).rejects.toThrow("Account changed");
  });
  it("revocation is synchronous at entry and token refresh for the same account does not revoke", async () => {
    const store = createOfflineStore(tmp()); const fired = vi.fn(); store.onRevoke(fired);
    await store.accountSeen(A); await store.prepare(raw(), A); await store.accountSeen(A);
    expect(fired).not.toHaveBeenCalled();
    const g = store.generation(); void store.invalidate();
    expect(store.generation()).toBe(g + 1); expect(fired).toHaveBeenCalledTimes(1);
  });
});

function fakeElectron(dir: string) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => Promise<any>>();
  let destroyed = false; const frame = { url: ENTRY };
  const wc: any = { getURL: () => ENTRY, mainFrame: frame, on: () => {}, setWindowOpenHandler: () => {}, isDestroyed: () => destroyed };
  class BrowserWindow { webContents = wc; isDestroyed() { return destroyed; } destroy() { destroyed = true; } on() {} loadURL() {} show() {} focus() {} }
  const ses = { protocol: { handle: () => {} }, webRequest: { onBeforeRequest: () => {} }, setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} };
  const electron = { BrowserWindow, session: { fromPartition: () => ses }, ipcMain: { handle: (n: string, f: any) => handlers.set(n, f) }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [dir] }) }, shell: {} };
  const call = (n: string, ...a: unknown[]) => handlers.get(n)!({ sender: wc, senderFrame: frame }, ...a);
  return { electron, call, isDestroyed: () => destroyed };
}

describe("finding 2: open offline window is closed and in-flight responses denied on revocation", () => {
  it("load in flight when another account signs in returns no data and closes the window", async () => {
    const dir = tmp(), store = createOfflineStore(dir); await (await seen(store, A)).prepare(raw(), A);
    const gate = deferred(), realLoad = store.loadActive;
    store.loadActive = async () => { await gate.promise; return realLoad(); };
    const fe = fakeElectron(dir), ws = createOfflineWorkspace({ electron: fe.electron, store }); ws.register(); ws.open();
    const pending = fe.call("offline:load");
    await store.accountSeen("synthetic-owner-b");
    gate.resolve();
    const res = await pending;
    expect(res.ok).toBe(false); expect(res.events).toBeUndefined(); expect(fe.isDestroyed()).toBe(true);
  });
  it("choose in flight during sign-out is denied", async () => {
    const dir = tmp(), store = createOfflineStore(dir); await (await seen(store, A)).prepare(raw(), A);
    const fe = fakeElectron(dir), ws = createOfflineWorkspace({ electron: fe.electron, store }); ws.register(); ws.open();
    expect((await fe.call("offline:load")).state).toBe("ready");
    const gate = deferred(), realRead = store.readOverlay;
    store.readOverlay = async (...a: unknown[]) => { await gate.promise; return realRead(...a); };
    const pending = fe.call("offline:choose", "E1", { section: "warmUp", index: 0, path: "M/b/Song.mp3" });
    void store.invalidate(); gate.resolve();
    expect((await pending).ok).toBe(false);
  });
});

describe("finding 3: saved choices match exact canonical song identity", () => {
  it("core dedupeKey is identical to the online dedupeKey", () => {
    const samples = [["The Weeknd", "Blinding Lights (Radio Edit)"], ["Earth, Wind & Fire", "Earth, Wind & Fire - September"], ["Beyoncé feat. Jay-Z", "Crazy In Love - 2003 Remaster"], ["A Tribe", "Can I Kick It?"], ["X & Y", "Song - From \"Film\""], ["", ""], ["Ke$ha", "TiK ToK [Explicit]"], ["Daft Punk", "One More Time - Single Version"]];
    for (const [a, s] of samples) expect(core.dedupeKey(a, s)).toBe(dedupeKey(a, s));
  });
  it("a confirmed key for a different song at the same position is stale and never exported", () => {
    const event = { lists: { warmUp: [{ artist: "New", song: "Replacement" }], transition: [], peak: [], selections: { "warmUp:0:old|song": { paths: ["M/a/Song.mp3"], confirmed: true } } } };
    const plan = core.exportPlan(event, { selections: {} }, core.buildIndex([{ filePath: "M/a/Song.mp3", artist: "Old", title: "Song" }]), { M: "/m" }, { "/m/a/Song.mp3": "available" });
    expect(plan.sections[0].entries).toEqual([]);
    expect(plan.problems[0].reason).toBe("Saved choice belongs to a different song at this position");
  });
  it("exact key wins even when stale same-position keys also exist", () => {
    const song = { artist: "Test Artist", song: "Song" };
    const sel = { "warmUp:0:zzz|other": { paths: ["M/b/Song.mp3"], confirmed: true }, [core.songKey("warmUp", 0, song)]: { paths: ["M/a/Song.mp3"], confirmed: true } };
    expect(core.cachedSelection(sel, "warmUp", 0, song).paths).toEqual(["M/a/Song.mp3"]);
  });
  it("cocktail/dinner lists are labelled, other saved lists are reported not silently dropped", async () => {
    expect(core.sectionLabel({ listType: "dinner" }, "warmUp", "Warm Up")).toBe("Dinner list");
    const dir = tmp(), store = createOfflineStore(dir);
    await (await seen(store, A)).prepare(raw(A, { warmUp: songs, transition: [], peak: [], extraList: [{ artist: "x", song: "y" }] }, { songs: [], listType: "cocktail" }), A);
    const fe = fakeElectron(dir), ws = createOfflineWorkspace({ electron: fe.electron, store }); ws.register(); ws.open();
    const res = await fe.call("offline:load");
    expect(res.events[0]).toMatchObject({ listType: "cocktail", otherLists: ["extraList"] });
  });
});

describe("finding 4: portable exclusive all-or-nothing export publication", () => {
  async function exportWith(patch: (f: typeof fs) => any) {
    const dir = tmp(), out = tmp(), store = createOfflineStore(dir); await (await seen(store, A)).prepare(raw(A, { warmUp: songs, transition: songs, peak: [], selections: { [core.songKey("warmUp", 0, songs[0])]: { paths: ["/abs/a.mp3"], confirmed: true }, [core.songKey("transition", 0, songs[0])]: { paths: ["/abs/a.mp3"], confirmed: true } } }), A);
    const s2 = JSON.parse(raw()); s2.sources[0].tracks.push({ filePath: "/abs/a.mp3", artist: "Test Artist", title: "Song" });
    await createOfflineStore(dir).invalidate(); const st = createOfflineStore(dir);
    await (await seen(st, A)).prepare(JSON.stringify({ ...s2, events: JSON.parse(raw(A, { warmUp: songs, transition: songs, peak: [], selections: { [core.songKey("warmUp", 0, songs[0])]: { paths: ["/abs/a.mp3"], confirmed: true }, [core.songKey("transition", 0, songs[0])]: { paths: ["/abs/a.mp3"], confirmed: true } } })).events }), A);
    // Portability/rollback fixtures need two distinct recordings now that repeats block combined export.
    const snapshot=JSON.parse(JSON.stringify({ ...s2, events: JSON.parse(raw(A, { warmUp: songs, transition: songs, peak: [], selections: { [core.songKey("warmUp", 0, songs[0])]: { paths: ["/abs/a.mp3"], confirmed: true }, [core.songKey("transition", 0, songs[0])]: { paths: ["/abs/b.mp3"], confirmed: true } } })).events }));
    snapshot.sources[0].tracks.push({filePath:"/abs/b.mp3",artist:"Test Artist",title:"Song (Extended)"});
    await st.prepare(JSON.stringify(snapshot),A);
    const statFs = { ...fs, promises: { ...fs.promises, stat: async (p: string) => ["/abs/a.mp3","/abs/b.mp3"].includes(p) ? { isFile: () => true } : fs.promises.stat(p), access: async (p: string, m?: number) => ["/abs/a.mp3","/abs/b.mp3"].includes(p) ? undefined : fs.promises.access(p, m) } };
    const fe = fakeElectron(out), ws = createOfflineWorkspace({ electron: fe.electron, store: st, fs: patch(statFs as typeof fs) }); ws.register(); ws.open();
    await fe.call("offline:load");
    return { res: await fe.call("offline:export", "E1"), out };
  }
  it("succeeds without hard links (link unsupported, e.g. exFAT) and never overwrites", async () => {
    const { res, out } = await exportWith(f => ({ ...f, promises: { ...f.promises, link: async () => { throw Object.assign(Error("ENOTSUP"), { code: "ENOTSUP" }); } } }));
    expect(res.ok).toBe(true);
    expect(fs.readdirSync(out).sort()).toEqual(["Synthetic - 1 Warm Up.m3u", "Synthetic - 2 Transition.m3u", "Synthetic - offline readiness.txt"]);
  });
  it("publication failure on a later file removes every earlier file of this export", async () => {
    let opens = 0;
    const { res, out } = await exportWith(f => ({ ...f, promises: { ...f.promises, open: async (...a: Parameters<typeof fs.promises.open>) => { if (String(a[0]).endsWith(".txt") && ++opens) throw Object.assign(Error("ENOTSUP"), { code: "ENOTSUP" }); return f.promises.open(...a); } } }));
    expect(res.ok).toBe(false); expect(res.written).toEqual([]); expect(res.error).toContain("The files this export started were removed");
    expect(fs.readdirSync(out)).toEqual([]);
  });
  it("mid-write ENOSPC rolls back; undeletable partial files are reported exactly", async () => {
    const { res, out } = await exportWith(f => ({ ...f, promises: { ...f.promises,
      open: async (...a: Parameters<typeof fs.promises.open>) => { const h = await f.promises.open(...a); if (!String(a[0]).includes("2 Transition")) return h; return { writeFile: async (t: string) => { await h.writeFile(t.slice(0, 5)); throw Object.assign(Error("ENOSPC"), { code: "ENOSPC" }); }, sync: () => h.sync(), close: () => h.close() }; },
      unlink: async (p: string) => { if (p.includes("1 Warm Up")) throw Object.assign(Error("EACCES"), { code: "EACCES" }); return f.promises.unlink(p); } } }));
    expect(res.ok).toBe(false); expect(res.leftover).toEqual(["Synthetic - 1 Warm Up.m3u"]);
    expect(res.error).toContain("could not be removed");
    expect(fs.readdirSync(out)).toEqual(["Synthetic - 1 Warm Up.m3u"]);
  });
});

describe("finding 5: real frontend preparation and session integration", () => {
  afterEach(() => { delete (globalThis as any).window; });
  const source = { label: "Synthetic", tracks: [{ filePath: "Synthetic/song.mp3", artist: "A", title: "Original" }] };
  function setup(query?: () => Promise<unknown>) {
    const calls: string[] = [], prepared: { raw: string; account: string }[] = [];
    (globalThis as any).window = { electronOffline: { prepare: async (r: string, account: string) => { prepared.push({ raw: r, account }); calls.push("prepare"); return { ok: true, preparedAt: "2026-11-02T00:00:00Z", events: 0, tracks: 1 }; }, status: async () => ({ prepared: false }), accountSeen: async (a: string) => { calls.push(`seen:${a}`); return { ok: true }; }, signedOut: async () => { calls.push("out"); return { ok: true }; } } };
    const options: any = { offlineAccess, query, saved: [] };
    return { h: harness([source], false, options), calls, prepared, options };
  }
  it("actual workspace prepareOffline collects the owner backup and hands it to the Mac app", async () => {
    const { h, prepared } = setup();
    const s = await h.render().prepareOffline();
    expect(s).toMatchObject({ prepared: true, tracks: 1 });
    expect(prepared).toHaveLength(1); expect(prepared[0].account).toBe("synthetic");
    expect(JSON.parse(prepared[0].raw).sources).toEqual([source]);
  });
  it("account switch during the event query never reaches the Mac app", async () => {
    const d = deferred(), { h, prepared } = setup(() => d.promise);
    const p = h.render().prepareOffline(); h.switchAccount("other"); d.resolve({ data: [], error: null });
    await expect(p).rejects.toThrow("changed"); expect(prepared).toEqual([]);
  });
  it("actual workspace auth listener reports sign-in and revokes on sign-out", async () => {
    const { calls, options } = setup();
    options.authCallback("SIGNED_IN", { user: { id: "synthetic" } });
    options.authCallback("SIGNED_OUT", null);
    expect(calls).toEqual(["seen:synthetic", "out"]);
  });
});
