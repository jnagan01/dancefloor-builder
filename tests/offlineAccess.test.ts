import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { prepareOfflineAccess, reportOfflineSession } from "@/lib/offlineAccess";

const require = createRequire(import.meta.url);
const core = require("../desktop/offline/core.js");
const { createOfflineStore } = require("../desktop/offline-store.cjs");
// The store accepts a prepare only for the account most recently reported as signed in.
const seen = async <T extends { accountSeen(a: string): Promise<void> }>(s: T, account: string) => { await s.accountSeen(account); return s; };
const pkg = require("../desktop/package.json");

const owner = "synthetic-owner-a";
const tracks = [
  { filePath: "Music/a/Song.mp3", artist: "Artist", title: "Song", playCount: 3 },
  { filePath: "Music/b/Song.mp3", artist: "Artist", title: "Song (Remix)", playCount: 50 },
  { filePath: "/abs/Other.mp3", artist: "Secret Session", title: "Password Song" },
  { filePath: "Unknown/x.mp3", artist: "Lost", title: "Root" },
];
const lists = {
  warmUp: [{ artist: "Artist", song: "Song" }, { artist: "Lost", song: "Root" }],
  transition: [{ artist: "Secret Session", song: "Password Song" }],
  peak: [{ artist: "Nobody", song: "Nothing" }],
  selections: {
    "warmUp:0:artist|song": { paths: ["Music/a/Song.mp3"], confirmed: true },
    "warmUp:1:lost|root": { paths: ["Unknown/x.mp3"], confirmed: true },
    "transition:0:secret session|password song": { paths: ["/abs/Other.mp3"], confirmed: false },
  },
};
const backup = (account = owner, extra: Record<string, unknown> = {}) => ({ format: "setarchitect-backup", version: 1, account, createdAt: new Date().toISOString(), events: [{ id: "E1", snapshot: { name: "Synthetic Wedding", inputs: { songs: [] }, lists } }], sources: [{ label: "Music", tracks: tracks.slice(0, 2) }, { label: "Abs", tracks: [tracks[2]] }, { label: "Unknown", tracks: [tracks[3]] }], roots: { Music: "/Volumes/Synthetic Music" }, ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "offline-unit-"));

describe("offline export plan", () => {
  const event = { id: "E1", name: "x", lists };
  const index = core.buildIndex(tracks);
  const roots = { Music: "/Volumes/Synthetic Music" };
  it("exports only confirmed recordings at their exact identity, never same-basename siblings", () => {
    const plan = core.exportPlan(event, { selections: {} }, index, roots, { "/Volumes/Synthetic Music/a/Song.mp3": "available" });
    const paths = plan.sections.flatMap((s: { entries: { path: string }[] }) => s.entries.map(e => e.path));
    expect(paths).toEqual(["/Volumes/Synthetic Music/a/Song.mp3"]);
    expect(plan.problems.map((p: { reason: string }) => p.reason)).toEqual(["Unknown music folder location", "Recording not confirmed", "No confirmed recording"]);
    expect(plan.summary).toMatchObject({ requested: 4, approved: 1, omitted: 3, localChoices: 0 });
  });
  it("tentative candidates need explicit local approval; overlay must match the same song", () => {
    const overlay = { selections: { "transition:0": { paths: ["/abs/Other.mp3"], confirmed: true, song: { artist: "Secret Session", song: "Password Song" } }, "peak:0": { paths: ["Music/b/Song.mp3"], confirmed: true, song: { artist: "Different", song: "Song" } } } };
    const plan = core.exportPlan(event, overlay, index, roots, { "/Volumes/Synthetic Music/a/Song.mp3": "available", "/abs/Other.mp3": "available" });
    expect(plan.sections[1].entries[0].path).toBe("/abs/Other.mp3");
    expect(plan.sections[2].entries).toEqual([]);
    expect(plan.summary.localChoices).toBe(1);
  });
  it("missing files are reported, not written", () => {
    const plan = core.exportPlan(event, { selections: {} }, index, roots, {});
    expect(plan.sections[0].entries).toEqual([]);
    expect(plan.summary.unavailable).toBe(1);
  });
  it("m3u is VirtualDJ shaped and single-line safe", () => {
    const text = core.m3u([{ track: { artist: "A\nB", title: "T<1>", bpm: "120" }, path: "/x/y.mp3" }]);
    expect(text).toBe("#EXTM3U\r\n#EXTVDJ:<artist>A B</artist><title>T&lt;1&gt;</title><bpm>120</bpm>\r\n#EXTINF:-1,A B - T<1>\r\n/x/y.mp3\r\n");
    expect(() => core.m3u([{ track: { artist: "a", title: "b" }, path: "/x\n/y" }])).toThrow();
  });
  it("search is bounded and ranks by relevance then play count", () => {
    const big = Array.from({ length: 31000 }, (_, i) => ({ filePath: `/m/${i}.mp3`, artist: `Artist ${i % 7}`, title: `Track ${i}` }));
    const idx = core.buildIndex(big);
    const t = performance.now();
    const hits = core.search(idx, "artist 3", 25);
    expect(hits.length).toBe(25);
    expect(performance.now() - t).toBeLessThan(500);
    expect(core.search(core.buildIndex(tracks), "artist song", 5)[0].i).toBe(0);
  });
  it("unsafe file names are sanitized", () => { expect(core.safeFileName("../a/b:c")).toBe("__a_b_c"); });
});

describe("offline store", () => {
  it("prepare -> active-only load; another account or sign-out revokes availability", async () => {
    const dir = tmp(), store = createOfflineStore(dir);
    expect((await store.loadActive()).state).toBe("none");
    const r = await (await seen(store, owner)).prepare(JSON.stringify(backup()), owner);
    expect(r).toMatchObject({ ok: true, events: 1, tracks: 4 });
    expect((await store.status(owner)).prepared).toBe(true);
    expect((await store.status("someone-else")).prepared).toBe(false);
    await store.accountSeen(owner);
    expect((await store.loadActive()).state).toBe("ready");
    await store.accountSeen("synthetic-owner-b");
    expect((await store.loadActive()).state).toBe("none");
    await expect(store.prepare(JSON.stringify(backup()), owner)).rejects.toThrow("Account changed");
    await store.accountSeen(owner);
    await store.prepare(JSON.stringify(backup()), owner);
    await store.invalidate();
    expect((await store.loadActive()).state).toBe("none");
    expect(fs.readFileSync(path.join(dir, "offline/snapshots", fs.readdirSync(path.join(dir, "offline/snapshots"))[0]), "utf8")).not.toContain("access_token");
  });
  it("rejects a backup for a different account and credential fields", async () => {
    const store = createOfflineStore(tmp());
    await expect(store.prepare(JSON.stringify(backup("other")), owner)).rejects.toThrow();
    await expect(store.prepare(JSON.stringify(backup(owner, { access_token: "x" })), owner)).rejects.toThrow();
  });
  it("failed mid-write keeps the last-good offline copy", async () => {
    const dir = tmp();
    await (await seen(createOfflineStore(dir), owner)).prepare(JSON.stringify(backup()), owner);
    const before = (await createOfflineStore(dir).loadActive()).preparedAt;
    const faulty = { ...fs, promises: { ...fs.promises, open: async (...a: Parameters<typeof fs.promises.open>) => { const h = await fs.promises.open(...a); return { writeFile: async (raw: string) => { await h.writeFile(raw.slice(0, 10)); throw Object.assign(Error("ENOSPC"), { code: "ENOSPC" }); }, sync: () => h.sync(), close: () => h.close() }; } } };
    await expect((await seen(createOfflineStore(dir, faulty), owner)).prepare(JSON.stringify(backup()), owner)).rejects.toThrow("ENOSPC");
    const after = await createOfflineStore(dir).loadActive();
    expect(after.state).toBe("ready"); expect(after.preparedAt).toBe(before);
    expect(fs.readdirSync(path.join(dir, "offline/snapshots")).filter(n => n.endsWith(".tmp"))).toEqual([]);
  });
  it("corrupt current copy falls back to the labelled earlier copy, without rewriting it", async () => {
    const dir = tmp(), store = createOfflineStore(dir);
    await (await seen(store, owner)).prepare(JSON.stringify(backup()), owner);
    await (await seen(store, owner)).prepare(JSON.stringify(backup()), owner);
    const snaps = path.join(dir, "offline/snapshots"), current = fs.readdirSync(snaps).find(n => !n.includes("prev"))!;
    fs.writeFileSync(path.join(snaps, current), "{corrupt");
    const loaded = await store.loadActive();
    expect(loaded).toMatchObject({ state: "ready", fallback: true });
    expect(fs.readFileSync(path.join(snaps, current), "utf8")).toBe("{corrupt");
    fs.writeFileSync(path.join(snaps, fs.readdirSync(snaps).find(n => n.includes("prev"))!), "bad");
    expect((await store.loadActive()).state).toBe("corrupt");
  });
  it("local choices are explicit, version-scoped, durable and never alter the cached snapshot", async () => {
    const dir = tmp(), store = createOfflineStore(dir);
    await (await seen(store, owner)).prepare(JSON.stringify(backup()), owner);
    const a = await store.loadActive();
    const snapBytes = fs.readFileSync(path.join(dir, "offline/snapshots", fs.readdirSync(path.join(dir, "offline/snapshots"))[0]));
    await expect(store.setChoice(a.hash, a.backup, "E1", { section: "peak", index: 0, path: "/not/in/library.mp3" })).rejects.toThrow("not in the saved library");
    await store.setChoice(a.hash, a.backup, "E1", { section: "peak", index: 0, path: "Music/b/Song.mp3" });
    const reread = await createOfflineStore(dir).readOverlay(a.hash, "E1", store.eventVersion(a.backup.events[0]));
    expect(reread.selections["peak:0"]).toMatchObject({ paths: ["Music/b/Song.mp3"], confirmed: true });
    expect(fs.readFileSync(path.join(dir, "offline/snapshots", fs.readdirSync(path.join(dir, "offline/snapshots"))[0]))).toEqual(snapBytes);
    await store.setChoice(a.hash, a.backup, "E1", { section: "peak", index: 0, clear: true });
    expect((await store.readOverlay(a.hash, "E1", store.eventVersion(a.backup.events[0]))).selections).toEqual({});
  });
});

describe("web side", () => {
  const ok = { prepare: async () => ({ ok: true, preparedAt: "2026-11-02T00:00:00Z", events: 1, tracks: 4 }), status: async () => ({ prepared: false }), accountSeen: async () => ({ ok: true }), signedOut: async () => ({ ok: true }) };
  it("stops when the account changes during collection, without calling prepare", async () => {
    let calls = 0, live = owner;
    const bridge = { ...ok, prepare: async () => { calls++; return ok.prepare(); } };
    await expect(prepareOfflineAccess({ account: owner, check: () => { if (live !== owner) throw Error("Account/session changed"); } }, async () => { live = "b"; return backup() as never; }, bridge)).rejects.toThrow("changed");
    expect(calls).toBe(0);
  });
  it("revokes if the session changes while the native write is pending", async () => {
    let live = owner, revoked = 0;
    const bridge = { ...ok, prepare: async () => { live = "b"; return ok.prepare(); }, signedOut: async () => { revoked++; return { ok: true }; } };
    await expect(prepareOfflineAccess({ account: owner, check: () => { if (live !== owner) throw Error("changed"); } }, async () => backup() as never, bridge)).rejects.toThrow();
    expect(revoked).toBe(1);
  });
  it("sign-out revokes and sign-in reports the account", () => {
    const seen: string[] = [];
    const bridge = { ...ok, accountSeen: async (a: string) => { seen.push(a); return { ok: true }; }, signedOut: async () => { seen.push("OUT"); return { ok: true }; } };
    reportOfflineSession("SIGNED_OUT", null, bridge); reportOfflineSession("SIGNED_IN", "b", bridge);
    expect(seen).toEqual(["OUT", "b"]);
  });
});

describe("packaging", () => {
  it("includes every offline file and no remote assets", () => {
    for (const f of ["offline-store.cjs", "offline-window.cjs", "offline-preload.cjs", "offline/index.html", "offline/app.js", "offline/core.js", "offline/offline.css"]) {
      expect(pkg.build.files).toContain(f);
      const text = fs.readFileSync(path.join("desktop", f), "utf8");
      expect(text).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    }
    expect(fs.readFileSync("desktop/offline/app.js", "utf8")).not.toMatch(/innerHTML|insertAdjacentHTML|eval\(|new Function/);
  });
});
