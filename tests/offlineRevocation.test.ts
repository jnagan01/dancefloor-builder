import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createOfflineStore } = require("../desktop/offline-store.cjs");

const owner = "synthetic-owner-a";
const backup = () => JSON.stringify({ format: "setarchitect-backup", version: 1, account: owner, createdAt: new Date().toISOString(), events: [{ id: "E1", snapshot: { name: "Synthetic", inputs: { songs: [] }, lists: { warmUp: [], transition: [], peak: [], selections: {} } } }], sources: [{ label: "Music", tracks: [{ filePath: "Music/a.mp3", artist: "A", title: "B" }] }], roots: { Music: "/Volumes/Synthetic" } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "offline-revoke-"));

/** fs whose async snapshot open for the given file pattern pauses until released. */
function pausable(match: RegExp) {
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const atGate = new Promise<void>(r => { reached = r; });
  let armed = false;
  const fsx = { ...fs, promises: { ...fs.promises, readFile: async (...a: Parameters<typeof fs.promises.readFile>) => {
    if (armed && match.test(String(a[0]))) { armed = false; reached(); await gate; }
    return fs.promises.readFile(...a);
  } } };
  return { fsx, arm: () => { armed = true; }, release, atGate };
}
const snapshots = (dir: string) => fs.readdirSync(path.join(dir, "offline/snapshots")).sort().map(n => [n, fs.readFileSync(path.join(dir, "offline/snapshots", n), "utf8")]);

describe("offline revocation fence", () => {
  it("revocation during a paused prepare denies immediately, including a newly reopened window, and the late prepare cannot resurrect it", async () => {
    const dir = tmp(), p = pausable(/snapshots[\\/][a-f0-9]{64}\.json$/);
    const store = createOfflineStore(dir, p.fsx);
    await store.accountSeen(owner); await store.prepare(backup(), owner); // baseline A
    p.arm();
    const second = store.prepare(backup(), owner);
    await p.atGate;
    void store.invalidate(); // not awaited
    expect((await store.loadActive()).state).toBe("none"); // a window opened now gets nothing
    expect((await store.status(owner)).prepared).toBe(false);
    expect((await createOfflineStore(dir).loadActive()).state).toBe("none"); // crash/restart before queued work
    p.release();
    await expect(second).rejects.toThrow(/changed/);
    expect((await store.loadActive()).state).toBe("none");
    expect((await createOfflineStore(dir).loadActive()).state).toBe("none");
    expect(snapshots(dir).length).toBeGreaterThan(0); // cache files kept; only availability revoked
  });

  it("an old marker left on disk (crash before cleanup) is not trusted after restart", async () => {
    const dir = tmp(), store = createOfflineStore(dir);
    await store.accountSeen(owner); await store.prepare(backup(), owner);
    const marker = fs.readFileSync(path.join(dir, "offline/active.json"), "utf8");
    await store.invalidate();
    fs.writeFileSync(path.join(dir, "offline/active.json"), marker); // simulate a stale publication surviving a crash
    expect((await createOfflineStore(dir).loadActive()).state).toBe("none");
    expect((await createOfflineStore(dir).status(owner)).prepared).toBe(false);
  });

  it("after sign-out, a prepare is refused until the same account is freshly seen", async () => {
    const dir = tmp(), store = createOfflineStore(dir);
    await store.accountSeen(owner); await store.prepare(backup(), owner);
    const before = snapshots(dir);
    await store.invalidate();
    await expect(store.prepare(backup(), owner)).rejects.toThrow(/Sign in again/);
    expect(snapshots(dir)).toEqual(before);
    expect((await store.loadActive()).state).toBe("none");
    await store.accountSeen(owner);
    expect((await store.loadActive()).state).toBe("none"); // seeing the account alone does not restore access
    await store.prepare(backup(), owner);
    expect((await store.loadActive()).state).toBe("ready");
    expect((await createOfflineStore(dir).loadActive()).state).toBe("ready");
  });

  it("legacy markers without an epoch stay readable until the first revocation", async () => {
    const dir = tmp(), store = createOfflineStore(dir);
    await store.accountSeen(owner); await store.prepare(backup(), owner);
    const file = path.join(dir, "offline/active.json"), m = JSON.parse(fs.readFileSync(file, "utf8"));
    delete m.epoch; fs.writeFileSync(file, JSON.stringify(m));
    expect((await createOfflineStore(dir).loadActive()).state).toBe("ready");
  });

  it("an unreadable revocation fence is repaired by the next trusted prepare, before the marker is committed", async () => {
    const dir = tmp(); fs.mkdirSync(path.join(dir, "offline"), { recursive: true });
    fs.writeFileSync(path.join(dir, "offline/epoch.json"), "{corrupt");
    const store = createOfflineStore(dir);
    await store.accountSeen(owner);
    expect((await store.loadActive()).state).toBe("none");
    await store.prepare(backup(), owner);
    expect((await store.loadActive()).state).toBe("ready");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "offline/epoch.json"), "utf8")).epoch).toBe(1);
    expect((await createOfflineStore(dir).loadActive()).state).toBe("ready");
  });

  it("revocation whose epoch write fails still wins over a paused prepare; nothing resurrects after restart", async () => {
    const dir = tmp(), p = pausable(/snapshots[\\/][a-f0-9]{64}\.json$/);
    let failEpoch = false;
    const fsx = { ...p.fsx, openSync: (f: fs.PathLike, ...rest: unknown[]) => { if (failEpoch && String(f).includes("epoch.json")) throw Object.assign(Error("EIO"), { code: "EIO" }); return (fs.openSync as (...a: unknown[]) => number)(f, ...rest); } };
    const store = createOfflineStore(dir, fsx);
    await store.accountSeen(owner); await store.prepare(backup(), owner);
    p.arm();
    const late = store.prepare(backup(), owner);
    await p.atGate;
    failEpoch = true;
    await store.invalidate(); // epoch write fails, marker unlink succeeds
    expect(fs.existsSync(path.join(dir, "offline/active.json"))).toBe(false);
    p.release();
    await expect(late).rejects.toThrow(/changed/);
    expect(fs.existsSync(path.join(dir, "offline/active.json"))).toBe(false);
    expect((await store.loadActive()).state).toBe("none");
    expect((await createOfflineStore(dir).loadActive()).state).toBe("none"); // abrupt restart
    expect(snapshots(dir).length).toBeGreaterThan(0);
  });
});
