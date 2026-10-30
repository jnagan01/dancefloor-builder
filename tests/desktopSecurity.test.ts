import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { createDesktopSecurity, parseWebUrl } = require("../desktop/security.cjs");
const APP = "https://dancefloor-builder.lovable.app";
function setup() {
  const mainFrame = { url: `${APP}/events/new` };
  const wc = { mainFrame, getURL: () => mainFrame.url, isDestroyed: () => false };
  const win = { webContents: wc, isDestroyed: () => false };
  const policy = createDesktopSecurity(APP, () => win);
  return { policy, wc, mainFrame, event: { sender: wc, senderFrame: mainFrame } };
}
const bad = [
  "https:dancefloor-builder.lovable.app", "https:///dancefloor-builder.lovable.app", "https://@dancefloor-builder.lovable.app/",
  `${APP}.evil.example/events`, `${APP}@evil.example`, "https://user:password@dancefloor-builder.lovable.app/",
  "https://dancefloor-builder.lovable.app:444/", "http://dancefloor-builder.lovable.app/", "https://dancefloor-builder.lovable.app.evil/",
  "https://dancefloor-builder.lovable.app\\@evil.example", `${APP}\n`, "not a url", "/events/new", "https://", 
  "javascript:alert(1)", "file:///music/song.mp3", "data:text/html,hi", "mailto:test@example.com", "spotify:track:123",
];
describe("desktop URL, sender and permission policy", () => {
  it.each(bad)("rejects trust trick %s", url => expect(setup().policy.isAppUrl(url)).toBe(false));
  it("allows exact parsed origin, including paths/query and explicit default port", () => {
    const { policy } = setup();
    expect(policy.isAppUrl(`${APP}/events/new?eventId=123`)).toBe(true);
    expect(policy.isAppUrl("https://dancefloor-builder.lovable.app:443/settings")).toBe(true);
  });
  it.each(["javascript:1", "file:///app", "https://name:secret@example.com", "garbage"])("fails closed for invalid configured URL %s", url => {
    expect(() => createDesktopSecurity(url, () => null)).toThrow();
  });
  it("only permits the owning trusted main frame before invoking native handlers", () => {
    const { policy, event, wc } = setup();
    const action = vi.fn(() => "native result");
    const guarded = policy.guard(action);
    expect(guarded(event)).toBe("native result");
    action.mockClear();
    for (const denied of [
      { sender: wc, senderFrame: { url: APP } }, // even a same-origin subframe is forbidden
      { sender: wc, senderFrame: { url: "https://evil.example" } },
      { sender: { ...wc }, senderFrame: wc.mainFrame },
      { sender: wc, senderFrame: null },
    ]) expect(() => guarded(denied)).toThrow("Native access denied");
    wc.mainFrame.url = "https://evil.example";
    expect(() => guarded(event)).toThrow();
    expect(action).not.toHaveBeenCalled();
  });
  it("uses actual permission request origin and denies iframe/missing requester fallback", () => {
    const { policy, wc } = setup();
    expect(policy.permissionRequest(wc, "fileSystem", { requestingUrl: APP, isMainFrame: true })).toBe(true);
    expect(policy.permissionRequest(wc, "fileSystem", { requestingUrl: "https://evil.example", isMainFrame: true })).toBe(false);
    expect(policy.permissionRequest(wc, "fileSystem", { requestingUrl: APP, isMainFrame: false })).toBe(false);
    expect(policy.permissionRequest(wc, "fileSystem", {})).toBe(false);
    expect(policy.permissionCheck(wc, "fileSystem", "https://evil.example", { isMainFrame: true })).toBe(false);
    expect(policy.permissionCheck(wc, "fileSystem", APP, { isMainFrame: false })).toBe(false);
    expect(policy.permissionCheck(wc, "fileSystem", APP, { isMainFrame: true, requestingUrl: "https://evil.example" })).toBe(false);
    expect(policy.permissionCheck(wc, "fileSystem", APP, { isMainFrame: true })).toBe(true);
    expect(policy.permissionCheck({ ...wc }, "fileSystem", APP, { isMainFrame: true })).toBe(false);
  });
  it.each(["media", "camera", "microphone", "geolocation", "notifications", "midi", "unknown"])("denies unnecessary permission %s", permission => {
    const { policy, wc } = setup();
    expect(policy.permissionRequest(wc, permission, { requestingUrl: APP, isMainFrame: true })).toBe(false);
    expect(policy.permissionCheck(wc, permission, APP, { isMainFrame: true })).toBe(false);
  });
  it("keeps same-origin navigation and safe external login links, denying arbitrary schemes", () => {
    const { policy } = setup();
    expect(policy.navigation(`${APP}/auth/callback`)).toBe("app");
    expect(policy.navigation("https://accounts.google.com/o/oauth2/auth")).toBe("external");
    expect(policy.navigation("https://accounts.spotify.com/authorize")).toBe("external");
    expect(policy.navigation("http://example.com/")).toBe("external");
    expect(policy.navigation("spotify:track:123")).toBe("deny");
    expect(parseWebUrl("https://user:pass@example.com")).toBeNull();
  });
});

/** Load the real main process with in-memory Electron/fs mocks; never access music. */
async function loadMain() {
  const handlers = new Map<string, Function>();
  const listeners = new Map<string, Function>();
  let windowOpen: Function = () => {};
  const external = vi.fn(async () => {});
  const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
  const fs = { existsSync: vi.fn(() => false), readFileSync: vi.fn(() => { throw new Error("mock missing state"); }), promises: { readFile: vi.fn(async () => "xml"), mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}) } };
  const scanFolder = vi.fn(async () => ({ ok: true, complete: true, files: [] }));
  const writeTags = vi.fn(async () => ({ ok: true }));
  const session: Record<string, Function> = { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() };
  const wc = { mainFrame: { url: APP }, getURL: () => wc.mainFrame.url, isDestroyed: () => false, session,
    setWindowOpenHandler: (fn: Function) => { windowOpen = fn; }, on: (name: string, fn: Function) => listeners.set(name, fn) };
  const win = { webContents: wc, isDestroyed: () => false, once: vi.fn(), on: vi.fn(), loadURL: vi.fn(), show: vi.fn() };
  const app = { setPath: vi.fn(), getPath: () => "/mock", requestSingleInstanceLock: () => true, on: vi.fn(), whenReady: async () => {}, quit: vi.fn() };
  const electron = { app, BrowserWindow: function () { return win; }, shell: { openExternal: external }, Menu: { buildFromTemplate: () => [], setApplicationMenu: vi.fn() }, dialog: { showOpenDialog }, ipcMain: { handle: (name: string, fn: Function) => handlers.set(name, fn) } };
  runInNewContext(readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8"), {
    require: (name: string) => name === "electron" ? electron : name === "node:fs" ? fs : name === "./security.cjs" ? require("../desktop/security.cjs") : name === "./scan.cjs" ? { scanFolder } : name === "./tags.cjs" ? { createTagCache: () => ({ forget: vi.fn(), flush: async () => {} }), writeTags } : name === "./updater.cjs" ? { checkForUpdates: async () => {} } : require(name),
    process: { env: {}, platform: "darwin" }, __dirname: "/mock/desktop", setTimeout: vi.fn(), console,
  });
  await Promise.resolve();
  return { handlers, listeners, windowOpen: (url: string) => windowOpen({ url }), external, showOpenDialog, fs, scanFolder, writeTags, wc };
}
describe("real main process wiring with mocks", () => {
  it("guards all native channels against untrusted contents and subframes before side effects", async () => {
    const { handlers, wc, showOpenDialog, fs, scanFolder, writeTags } = await loadMain();
    expect([...handlers.keys()].sort()).toEqual([
      "vdj:default-path", "vdj:default-root", "vdj:choose-root", "vdj:read-database", "vdj:choose-database",
      "fs:choose-folder", "fs:choose-music-folder", "fs:write-tags", "fs:scan-folder", "fs:read-audio", "fs:write-file",
    ].sort());
    for (const handler of handlers.values()) {
      expect(() => handler({ sender: wc, senderFrame: { url: APP } }, "/mock/music")).toThrow("Native access denied");
      expect(() => handler({ sender: { ...wc }, senderFrame: wc.mainFrame }, "/mock/music")).toThrow("Native access denied");
    }
    wc.mainFrame.url = `${APP}.evil.example`;
    for (const handler of handlers.values()) expect(() => handler({ sender: wc, senderFrame: wc.mainFrame })).toThrow();
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(fs.promises.readFile).not.toHaveBeenCalled();
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
    expect(scanFolder).not.toHaveBeenCalled();
    expect(writeTags).not.toHaveBeenCalled();
  });
  it("allows ordinary scans, dialogs, VirtualDJ reads, audio reads and exports from the trusted main frame", async () => {
    const { handlers, wc, scanFolder, showOpenDialog, fs } = await loadMain();
    const event = { sender: wc, senderFrame: wc.mainFrame };
    await handlers.get("fs:scan-folder")?.(event, "/mock/music");
    await handlers.get("fs:choose-music-folder")?.(event);
    await handlers.get("vdj:read-database")?.(event, "/mock/database.xml");
    await handlers.get("fs:write-file")?.(event, { dirPath: "/mock/export", name: "list.m3u", contents: "song" });
    fs.promises.readFile.mockResolvedValueOnce(Buffer.from("audio") as never);
    const audio = await handlers.get("fs:read-audio")?.(event, "/mock/song.mp3");
    expect(audio.ok).toBe(true);
    expect(scanFolder).toHaveBeenCalledTimes(1);
    expect(showOpenDialog).toHaveBeenCalledTimes(1);
    expect(fs.promises.writeFile).toHaveBeenCalledWith("/mock/export/list.m3u", "song", "utf8");
  });
  it("blocks unsafe navigation/redirects and all popup windows; only safe browser URLs open externally", async () => {
    const { listeners, windowOpen, external } = await loadMain();
    for (const name of ["will-navigate", "will-redirect"]) {
      const preventDefault = vi.fn();
      listeners.get(name)?.({ preventDefault }, `${APP}/events/new`);
      expect(preventDefault).not.toHaveBeenCalled();
      listeners.get(name)?.({ preventDefault }, "https://accounts.google.com/login");
      expect(preventDefault).toHaveBeenCalledTimes(1);
      external.mockClear();
      listeners.get(name)?.({ preventDefault }, "file:///etc/passwd");
      expect(external).not.toHaveBeenCalled();
    }
    expect(windowOpen("https://accounts.spotify.com/authorize")).toEqual({ action: "deny" });
    expect(external).toHaveBeenLastCalledWith("https://accounts.spotify.com/authorize");
    external.mockClear();
    expect(windowOpen("javascript:alert(1)")).toEqual({ action: "deny" });
    expect(external).not.toHaveBeenCalled();
    const preventDefault = vi.fn();
    listeners.get("will-frame-navigate")?.({ preventDefault, url: "https://evil.example", isMainFrame: false });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(external).not.toHaveBeenCalled();
    // Electron 33 passes navigation details on the event itself.
    listeners.get("will-frame-navigate")?.({ preventDefault, url: "https://accounts.google.com/login", isMainFrame: true });
    expect(external).toHaveBeenLastCalledWith("https://accounts.google.com/login");
    external.mockClear();
    listeners.get("will-redirect")?.({ preventDefault, url: "https://evil.example", isMainFrame: false });
    expect(external).not.toHaveBeenCalled();
    listeners.get("will-redirect")?.({ preventDefault, url: "https://accounts.spotify.com/authorize", isMainFrame: true });
    expect(external).toHaveBeenLastCalledWith("https://accounts.spotify.com/authorize");
  });
  it("includes extracted main-process helpers in installed desktop builds", () => {
    const pkg = require("../desktop/package.json");
    expect(pkg.build.files).toContain("security.cjs");
    expect(pkg.build.files).toContain("scan.cjs");
    expect(pkg.build.appId).toBe("com.exceptionalentertainment.dancefloorbuilder");
  });
});