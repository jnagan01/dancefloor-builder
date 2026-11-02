// Offline workspace release gate: drives the REAL desktop/main.cjs, offline
// window, protocol, preload and IPC in fenced synthetic Electron profiles.
// Network is denied at the Chromium level before launch for every offline phase.
import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import http from "node:http"; import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const core = createRequire(import.meta.url)("../../desktop/offline/core.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "setarchitect-offline-"));
fs.writeFileSync(path.join(temp, "ISOLATED"), "synthetic only");
const diagnostics = path.join(root, "test-results/native-offline"); fs.mkdirSync(diagnostics, { recursive: true });
const bin = process.env.ELECTRON_BIN || path.join(root, "desktop/node_modules/electron/dist", process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron");
const DENY = ["--host-resolver-rules=MAP * ~NOTFOUND", "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>"];
const ACCOUNT = "synthetic-owner";

// Synthetic library: duplicate basenames in different folders, one listed file missing on disk.
const lib = path.join(temp, "library"); for (const d of ["a", "b"]) fs.mkdirSync(path.join(lib, d), { recursive: true });
for (const f of ["a/Song.mp3", "b/Song.mp3", "a/Other.mp3"]) fs.writeFileSync(path.join(lib, f), "synthetic bytes, never played");
const tracks = [
  { filePath: "Music/a/Song.mp3", artist: "Test Artist", title: "Song", playCount: 2 },
  { filePath: "Music/b/Song.mp3", artist: "Test Artist", title: "Song", remix: "Extended", playCount: 40 },
  { filePath: "Music/a/Other.mp3", artist: "<img src=x onerror=window.__xss=1>", title: "Other", playCount: 1 },
  { filePath: "Music/a/Gone.mp3", artist: "Gone Artist", title: "Gone", playCount: 1 },
  { filePath: "Lost/x.mp3", artist: "Lost Artist", title: "Lost", playCount: 1 },
  ...Array.from({ length: 31000 }, (_, i) => ({ filePath: `Music/bulk/${i}.mp3`, artist: `Bulk ${i % 50}`, title: `Filler ${i}` })),
];
const song = (artist, title) => ({ artist, song: title });
const W = [song("Test Artist", "Song"), song("Gone Artist", "Gone"), song("New Artist", "Replaced Song")];
const T = [song("<img src=x onerror=window.__xss=1>", "Other"), song("Lost Artist", "Lost")];
const P = [song("Test Artist", "Song")];
const lists = {
  warmUp: W, transition: T, peak: P,
  selections: {
    [core.songKey("warmUp", 0, W[0])]: { paths: ["Music/a/Song.mp3"], confirmed: true },
    [core.songKey("warmUp", 1, W[1])]: { paths: ["Music/a/Gone.mp3"], confirmed: true },
    // Stale: confirmed for a DIFFERENT song that used to be at warmUp #3. Must never export.
    "warmUp:2:old artist|old song": { paths: ["Music/b/Song.mp3"], confirmed: true },
    [core.songKey("transition", 0, T[0])]: { paths: ["Music/a/Other.mp3"], confirmed: false },
    [core.songKey("transition", 1, T[1])]: { paths: ["Lost/x.mp3"], confirmed: true },
  },
};
const backup = (account = ACCOUNT) => JSON.stringify({ format: "setarchitect-backup", version: 1, account, createdAt: new Date().toISOString(), events: [{ id: "E1", snapshot: { name: "Synthetic <b>Wedding</b>", inputs: { songs: [] }, lists } }], sources: [{ label: "Music", tracks: tracks.filter(t => t.filePath.startsWith("Music/")) }, { label: "Lost", tracks: tracks.filter(t => t.filePath.startsWith("Lost/")) }], roots: { Music: lib } });

// Local stand-in for the trusted web origin; counts every request so offline phases can assert none.
let requests = 0;
const server = http.createServer((req, res) => { requests++; if (req.url.startsWith("/stall")) { res.writeHead(200, { "Content-Type": "text/html" }); res.write("<!doctype html><p>loading"); return; } /* body never finishes */ res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>Synthetic online origin</title><p>stub</p>"); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

let app, count = 0;
async function launch({ deny, online, url, timeout = 30000 }) {
  const env = { ...process.env, SETARCHITECT_TEST_USERDATA: temp};
  if (online) env.DANCEFLOOR_URL = url || ORIGIN; else delete env.DANCEFLOOR_URL; // offline phases try the real published URL, blocked
  app = await electron.launch({ timeout, executablePath: bin, args: [path.join(root, "tests/native/fixtures/offline-entry.cjs"), "--no-sandbox", ...(deny ? DENY : [])], env });
  const proc = app.process(); const log = fs.createWriteStream(path.join(diagnostics, `offline-main-${proc.pid}.log`));
  proc.stdout?.pipe(log); proc.stderr?.pipe(log);
  return app;
}
async function offlineWindow(tries = 200) {
  for (let i = 0; i < tries; i++) {
    const w = app.windows().find(p => p.url().startsWith("setarchitect-offline://app/"));
    if (w) { await w.waitForLoadState("domcontentloaded"); return w; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error("Offline workspace did not open.");
}
// Each relaunch reuses the profile, so the previous main process must be fully gone first. On macOS a
// lingering instance keeps the single-instance lock; the relaunched process then quits before Playwright
// releases "ready" and hangs until the launch timeout. Verify exit and the lock release explicitly.
async function close() {
  if (!app) return; const proc = app.process(); const current = app; app = null;
  const exited = proc.exitCode !== null || proc.signalCode ? Promise.resolve() : new Promise(r => proc.once("exit", r));
  await Promise.race([current.close().catch(e => console.log(`close: ${e.message}`)), new Promise(r => setTimeout(r, 15000))]);
  if (!await Promise.race([exited.then(() => true), new Promise(r => setTimeout(() => r(false), 10000))])) {
    console.log(`main ${proc.pid} still running after close; killing`); proc.kill("SIGKILL"); await exited;
  }
  for (let i = 0; i < 100 && ["SingletonLock", "SingletonSocket"].some(n => { try { fs.lstatSync(path.join(temp, n)); return true; } catch { return false; } }); i++) await new Promise(r => setTimeout(r, 100));
}
async function check(name, page, fn) { await fn(); count++; if (page) await page.screenshot({ path: path.join(diagnostics, `offline-${count}.png`) }).catch(() => {}); console.log(`PASS ${name}`); }
const snapshotDir = path.join(temp, "offline", "snapshots");
const hashDir = () => fs.readdirSync(snapshotDir).filter(n => !n.includes(".prev.") && n.endsWith(".json")).map(n => path.join(snapshotDir, n));
const digest = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

try {
  await check("clean profile, network denied: failed start offers offline workspace that explains preparation", null, async () => {
    await launch({ deny: true });
    const w = await offlineWindow();
    await expect(w.getByText("Offline access isn't prepared on this Mac yet")).toBeVisible();
    expect(fs.readFileSync(path.join(temp, "dialogs.log"), "utf8")).toContain("Open Offline Workspace");
    await w.screenshot({ path: path.join(diagnostics, "offline-clean.png") });
    await close();
  });

  let snapDigest;
  await check("trusted signed-in origin prepares offline access; mismatched account rejected without replacing last-good", null, async () => {
    await launch({ deny: false, online: true });
    const page = await app.firstWindow(); await page.waitForLoadState("domcontentloaded");
    const r = await page.evaluate(async ([raw, a]) => { await window.electronOffline.accountSeen(a); return window.electronOffline.prepare(raw, a); }, [backup(), ACCOUNT]);
    expect(r).toMatchObject({ ok: true, events: 1, tracks: tracks.length });
    expect(await page.evaluate(a => window.electronOffline.status(a), ACCOUNT)).toMatchObject({ prepared: true, events: 1 });
    expect(await page.evaluate(() => window.electronOffline.status("someone-else"))).toMatchObject({ prepared: false });
    snapDigest = digest(hashDir()[0]);
    const bad = await page.evaluate(async ([raw, a]) => { await window.electronOffline.accountSeen(a); return window.electronOffline.prepare(raw, a); }, [backup("someone-else"), ACCOUNT]);
    expect(bad.ok).toBe(false);
    expect(digest(hashDir()[0])).toBe(snapDigest);
    expect(await page.evaluate(() => typeof window.setarchitectOffline)).toBe("undefined");
    expect(JSON.stringify(fs.readFileSync(hashDir()[0], "utf8"))).not.toMatch(/access_token|refresh_token|password"/i);
    await close();
  });

  const before = requests;
  let w;
  await check("warm restart with network denied opens cached event, counts and online-only labels", null, async () => {
    await launch({ deny: true });
    w = await offlineWindow();
    await expect(w.locator("#cached")).toContainText(`1 events · ${tracks.length.toLocaleString("en-US")} tracks`);
    await expect(w.locator("#online-only")).toContainText("need the internet");
    await expect(w.getByRole("heading", { name: "Synthetic <b>Wedding</b>" })).toBeVisible();
    expect(await w.evaluate(() => [window.__xss, document.querySelectorAll("img, b").length])).toEqual([undefined, 0]);
    await expect(w.locator("#song-warmUp-0")).toContainText("Confirmed recording (saved)");
    await expect(w.locator("#song-transition-0")).toContainText("Suggested, not confirmed");
    await expect(w.locator("#song-warmUp-1")).toContainText("file missing on this Mac");
    await expect(w.locator("#song-transition-1")).toContainText("unknown music folder location");
    await expect(w.locator("#song-warmUp-2")).toContainText("Saved choice doesn't match this song");
  });

  await check("bounded search and explicit keyboard confirmation of a duplicate-basename recording", w, async () => {
    await w.locator("#song-peak-0").getByRole("button", { name: /Choose recording/ }).click();
    await expect(w.locator("#song-peak-0 .results li")).toHaveCount(2);
    const big = await w.evaluate(() => { const t = performance.now(); const n = window.OfflineCore.search(window.OfflineCore.buildIndex(Array.from({ length: 31000 }, (_, i) => ({ filePath: `/x/${i}`, artist: "Bulk", title: `F ${i}` }))), "bulk", 25).length; return [n, performance.now() - t]; });
    expect(big[0]).toBe(25); expect(big[1]).toBeLessThan(1500);
    const use = w.locator("#song-peak-0").getByRole("button", { name: "Use Test Artist — Song" }).filter({ hasNot: w.locator("x") });
    // Pick the Extended remix in folder b — same basename as the warm-up file in folder a.
    const row = w.locator("#song-peak-0 .results li", { hasText: "Music/b/Song.mp3" });
    await row.getByRole("button").focus(); await w.keyboard.press("Enter");
    await expect(w.locator("#song-peak-0")).toContainText("Chosen offline — this Mac only");
    expect(await use.count()).toBe(0);
    await w.locator("#song-transition-0").getByRole("button", { name: /Choose recording/ }).click();
    await w.locator("#song-transition-0 .results li", { hasText: "Music/a/Other.mp3" }).getByRole("button").click();
    await expect(w.locator("#song-transition-0")).toContainText("Chosen offline");
    expect(digest(hashDir()[0])).toBe(snapDigest);
  });

  const exportDir = path.join(temp, "exports"); fs.mkdirSync(exportDir);
  await check("export writes exact approved identities in section order with readiness report", w, async () => {
    fs.writeFileSync(path.join(temp, "export-dir"), exportDir);
    await w.getByRole("button", { name: "Export VirtualDJ playlists" }).click();
    await expect(w.locator(".report")).toContainText("Export complete");
    const names = fs.readdirSync(exportDir).sort();
    expect(names).toEqual(["Synthetic _b_Wedding__b_ - 1 Warm Up.m3u", "Synthetic _b_Wedding__b_ - 2 Transition.m3u", "Synthetic _b_Wedding__b_ - 3 Peak.m3u", "Synthetic _b_Wedding__b_ - offline readiness.txt"]);
    const read = n => fs.readFileSync(path.join(exportDir, n), "utf8");
    const pathsIn = n => read(n).split("\r\n").filter(l => l && !l.startsWith("#"));
    expect(pathsIn(names[0])).toEqual([path.join(lib, "a/Song.mp3")]);
    expect(pathsIn(names[1])).toEqual([path.join(lib, "a/Other.mp3")]);
    expect(pathsIn(names[2])).toEqual([path.join(lib, "b/Song.mp3")]);
    const report = read(names[3]);
    expect(report).toContain("Requested songs: 6");
    expect(report).toContain("warmUp #3. New Artist — Replaced Song — Saved choice belongs to a different song at this position"); expect(report).toContain("Local offline choices used (not synced): 2");
    expect(report).toContain("warmUp #2. Gone Artist — Gone — File missing on this Mac");
    expect(report).toContain("transition #2. Lost Artist — Lost — Unknown music folder location");
    await w.locator(".report").getByRole("button", { name: "warmUp #2" }).click();
    expect(await w.evaluate(() => document.activeElement?.closest(".song")?.id)).toBe("song-warmUp-1");
    for (const theme of ["dark", "light"]) { await w.locator("#theme").selectOption(theme); await w.screenshot({ path: path.join(diagnostics, `offline-theme-${theme}.png`) }); }
  });

  await check("failed export and failed choice writes keep last-good state and never report success", w, async () => {
    const blocked = path.join(temp, "not-a-folder"); fs.writeFileSync(blocked, "file");
    fs.writeFileSync(path.join(temp, "export-dir"), blocked);
    await w.getByRole("button", { name: "Export VirtualDJ playlists" }).click();
    await expect(w.locator(".report")).toContainText("The files this export started were removed");
    const overlays = path.join(temp, "offline", "overlays"), [hash] = fs.readdirSync(overlays);
    const saved = fs.readFileSync(path.join(overlays, hash, fs.readdirSync(path.join(overlays, hash))[0]), "utf8");
    fs.renameSync(path.join(overlays, hash), path.join(overlays, "moved")); fs.writeFileSync(path.join(overlays, hash), "blocker");
    await w.locator("#song-warmUp-0").getByRole("button", { name: /Choose recording/ }).click();
    await w.locator("#song-warmUp-0 .results li", { hasText: "Music/b/Song.mp3" }).getByRole("button").click();
    await expect(w.locator("#status")).toHaveClass(/error/);
    fs.unlinkSync(path.join(overlays, hash)); fs.renameSync(path.join(overlays, "moved"), path.join(overlays, hash));
    expect(fs.readFileSync(path.join(overlays, hash, fs.readdirSync(path.join(overlays, hash))[0]), "utf8")).toBe(saved);
  });

  await check("hostile navigation, iframe, popup and remote script are blocked in the offline window", w, async () => {
    await w.evaluate(o => { const f = document.createElement("iframe"); f.src = o; document.body.append(f); const s = document.createElement("script"); s.src = o + "/x.js"; document.body.append(s); window.open(o); }, ORIGIN);
    await w.evaluate(o => { location.href = o; }, ORIGIN).catch(() => {});
    await new Promise(r => setTimeout(r, 800));
    expect(w.url()).toBe("setarchitect-offline://app/index.html");
    expect(app.windows().filter(p => p.url().startsWith("http")).length).toBe(0);
    expect(requests).toBe(before);
    await close();
  });

  await check("restart offline keeps local choices; saved snapshot and cloud untouched", null, async () => {
    await launch({ deny: true });
    const w2 = await offlineWindow();
    await expect(w2.locator("#song-peak-0")).toContainText("Chosen offline — this Mac only");
    await expect(w2.locator("#song-warmUp-0")).toContainText("Confirmed recording (saved)");
    expect(digest(hashDir()[0])).toBe(snapDigest);
    expect(requests).toBe(before);
    await close();
  });

  await check("different signed-in account revokes offline access; cached copy is not exposed", null, async () => {
    await launch({ deny: false, online: true });
    const page = await app.firstWindow(); await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => window.electronOffline.accountSeen("synthetic-owner-b"));
    await close();
    await launch({ deny: true });
    const w3 = await offlineWindow();
    await expect(w3.getByText("Offline access isn't prepared on this Mac yet")).toBeVisible();
    expect(await w3.evaluate(() => document.body.innerText)).not.toContain("Wedding");
    await close();
  });

  await check("sign-out revokes; corrupt cache explains without blank screen or rewrite", null, async () => {
    await launch({ deny: false, online: true });
    const page = await app.firstWindow(); await page.waitForLoadState("domcontentloaded");
    expect((await page.evaluate(async ([raw, a]) => { await window.electronOffline.accountSeen(a); return window.electronOffline.prepare(raw, a); }, [backup(), ACCOUNT])).ok).toBe(true);
    await page.evaluate(() => window.electronOffline.signedOut());
    expect(await page.evaluate(a => window.electronOffline.status(a), ACCOUNT)).toMatchObject({ prepared: false });
    expect((await page.evaluate(async ([raw, a]) => { await window.electronOffline.accountSeen(a); return window.electronOffline.prepare(raw, a); }, [backup(), ACCOUNT])).ok).toBe(true);
    await close();
    for (const f of fs.readdirSync(snapshotDir)) fs.writeFileSync(path.join(snapshotDir, f), "{corrupt");
    await launch({ deny: true });
    const w4 = await offlineWindow();
    await expect(w4.getByText("Offline copy can't be read")).toBeVisible();
    for (const f of fs.readdirSync(snapshotDir)) expect(fs.readFileSync(path.join(snapshotDir, f), "utf8")).toBe("{corrupt");
    await close();
  });
  await check("open offline window closes immediately when another account signs in", null, async () => {
    await launch({ deny: false, online: true });
    const page = await app.firstWindow(); await page.waitForLoadState("domcontentloaded");
    expect((await page.evaluate(async ([raw, a]) => { await window.electronOffline.accountSeen(a); return window.electronOffline.prepare(raw, a); }, [backup(), ACCOUNT])).ok).toBe(true);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("open-offline").click());
    const ow = await offlineWindow();
    await expect(ow.getByRole("heading", { name: "Synthetic <b>Wedding</b>" })).toBeVisible();
    const closed = ow.waitForEvent("close");
    await page.evaluate(() => window.electronOffline.accountSeen("synthetic-owner-b"));
    await closed;
    expect(app.windows().some(p => p.url().startsWith("setarchitect-offline://"))).toBe(false);
    await close();
  });

  await check("real 20-second stalled online start offers the offline workspace", null, async () => {
    fs.rmSync(path.join(temp, "dialogs.log"), { force: true });
    const started = Date.now();
    await launch({ deny: false, online: true, url: `${ORIGIN}/stall`, timeout: 90000 });
    const ow = await offlineWindow(400);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThan(19000);
    expect(fs.readFileSync(path.join(temp, "dialogs.log"), "utf8")).toContain("taking too long");
    await expect(ow.locator("#detail")).toBeVisible();
    await close();
  });
  console.log(`${count}/12 offline Electron flows passed`);
} catch (e) {
  console.error(e);
  if (app) for (const p of app.windows()) await p.screenshot({ path: path.join(diagnostics, `failure-${p.url().startsWith("setarchitect") ? "offline" : "main"}.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  await close(); server.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
