// Test-only: preloaded into the REAL desktop/main.cjs to answer native dialogs.
// Refuses to run outside a fenced synthetic profile.
const fs = require("node:fs"), path = require("node:path");
const p = process.env.SETARCHITECT_TEST_USERDATA;
if (process.type === "browser") {
  if (!p || !path.basename(p).startsWith("setarchitect-offline-") || !fs.existsSync(path.join(p, "ISOLATED"))) throw Error("Fenced synthetic profile required.");
  const { dialog } = require("electron");
  dialog.showMessageBox = async (_w, o) => {
    const options = o || _w;
    fs.appendFileSync(path.join(p, "dialogs.log"), JSON.stringify({ buttons: options.buttons, detail: options.detail }) + "\n");
    const i = options.buttons.indexOf("Open Offline Workspace");
    return { response: i >= 0 ? i : options.cancelId ?? 0 };
  };
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fs.readFileSync(path.join(p, "export-dir"), "utf8")] });
}

// Early startup telemetry (synthetic profile only). Written synchronously from process start, before
// Playwright's launch resolves, so a launch that never resolves still leaves evidence. A 1-second
// heartbeat exposes a blocked main thread as a gap.
if (process.type === "browser") {
  const { app, BrowserWindow } = require("electron");
  const file = path.join(p, "startup-telemetry.log"), t0 = Date.now();
  const log = (event, data) => { try { fs.appendFileSync(file, JSON.stringify({ ms: Date.now() - t0, pid: process.pid, event, ...(data || {}) }) + "\n"); } catch { /* telemetry never affects the app */ } };
  log("main-start", { argv: process.argv.slice(1).filter(a => !a.startsWith("--inspect")) });
  const beat = setInterval(() => log("heartbeat"), 1000); beat.unref();
  setTimeout(() => clearInterval(beat), 90000).unref();
  const realShow = dialog_showMessageBox_wrap();
  function dialog_showMessageBox_wrap() { const { dialog } = require("electron"); const orig = dialog.showMessageBox; dialog.showMessageBox = async (...a) => { log("dialog", { detail: (a[1] || a[0] || {}).detail }); return orig(...a); }; return orig; }
  void realShow;
  app.on("will-finish-launching", () => log("will-finish-launching"));
  app.whenReady().then(() => log("app-ready"));
  app.on("browser-window-created", (_e, w) => log("window-created", { id: w.id }));
  app.on("web-contents-created", (_e, wc) => {
    const id = wc.id; log("web-contents-created", { id, type: wc.getType() });
    wc.on("did-start-loading", () => log("did-start-loading", { id, url: wc.getURL() }));
    wc.on("did-fail-load", (_x, code, desc, url, main) => log("did-fail-load", { id, code, desc, url, main }));
    wc.on("did-finish-load", () => log("did-finish-load", { id, url: wc.getURL() }));
    wc.on("dom-ready", () => log("dom-ready", { id, url: wc.getURL() }));
    wc.on("render-process-gone", (_x, d) => log("render-process-gone", { id, ...d }));
    wc.on("unresponsive", () => log("unresponsive", { id }));
    wc.on("preload-error", (_x, pre, err) => log("preload-error", { id, pre, error: String(err) }));
    wc.on("console-message", (_x, level, message) => { if (level >= 2) log("console-error", { id, message }); });
    wc.on("destroyed", () => log("web-contents-destroyed", { id }));
  });
  app.on("child-process-gone", (_e, d) => log("child-process-gone", d));
  app.on("before-quit", () => log("before-quit"));
  app.on("will-quit", () => log("will-quit"));
  app.on("quit", (_e, code) => log("quit", { code, windows: BrowserWindow.getAllWindows().length }));
  process.on("uncaughtException", e => { log("uncaught-exception", { error: String(e && e.stack || e) }); });
  process.on("unhandledRejection", e => log("unhandled-rejection", { error: String(e && e.stack || e) }));
  process.on("exit", code => log("exit", { code }));
}
