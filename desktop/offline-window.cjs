/* Bundled offline workspace: its own in-memory session, private scheme,
 * restrictive CSP, separate preload and IPC that only this window's main
 * frame may call. The online web origin never gains file:// or offline access. */
const path = require("node:path"), crypto = require("node:crypto");
const core = require("./offline/core.js");

const SCHEME = "setarchitect-offline";
const ORIGIN = `${SCHEME}://app`;
const ENTRY = `${ORIGIN}/index.html`;
const PARTITION = "setarchitect-offline";
const ASSETS = { "/index.html": "text/html", "/app.js": "text/javascript", "/core.js": "text/javascript", "/policy.cjs": "text/javascript", "/offline.css": "text/css" };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; font-src 'none'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function registerOfflineScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
}

function createOfflineWorkspace({ electron, store, fs = require("node:fs"), assetsDir = path.join(__dirname, "offline") }) {
  const { BrowserWindow, session, ipcMain, dialog, shell } = electron;
  let win = null, protocolReady = false;
  let captured = null; // { hash, preparedAt } observed when this window loaded

  const isEntry = url => typeof url === "string" && (url === ENTRY || url.startsWith(`${ENTRY}#`));
  const trusted = event => Boolean(win && !win.isDestroyed() && event && event.sender === win.webContents &&
    event.senderFrame && event.senderFrame === event.sender.mainFrame && isEntry(event.senderFrame.url) && isEntry(event.sender.getURL()));
  // Window generation: bumped (and the window closed) the moment the store revokes access.
  let windowGeneration = 0;
  const REVOKED = "Offline access changed (signed out or another account). This window was closed.";
  store.onRevoke(() => {
    windowGeneration++; captured = null;
    if (win && !win.isDestroyed()) win.destroy();
  });
  const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
    if (!trusted(event)) throw new Error("Offline access denied: untrusted page or frame.");
    const gen = windowGeneration, storeGen = store.generation();
    const fence = () => { if (gen !== windowGeneration || storeGen !== store.generation() || !trusted(event)) throw Error(REVOKED); };
    try { const result = await fn(fence, ...args); fence(); return result; } catch (e) { return { ok: false, error: e.message }; }
  });

  function ses() {
    const s = session.fromPartition(PARTITION); // in-memory: no web storage persists
    if (!protocolReady) {
      s.protocol.handle(SCHEME, async request => {
        let url; try { url = new URL(request.url); } catch { return new Response("", { status: 400 }); }
        const type = url.host === "app" ? ASSETS[url.pathname] : undefined;
        if (!type) return new Response("", { status: 404 });
        const body = await fs.promises.readFile(path.join(assetsDir, url.pathname.slice(1)));
        return new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
      });
      // Nothing in this session may reach the network or any other scheme.
      s.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !details.url.startsWith(`${ORIGIN}/`) && !details.url.startsWith("devtools://") }));
      s.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
      s.setPermissionCheckHandler(() => false);
      protocolReady = true;
    }
    return s;
  }

  function open() {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return win; }
    win = new BrowserWindow({
      width: 1280, height: 860, minWidth: 900, minHeight: 600, title: "SetArchitect — Offline workspace",
      webPreferences: { session: ses(), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, webviewTag: false, preload: path.join(__dirname, "offline-preload.cjs") },
    });
    const wc = win.webContents;
    const block = e => { if (!isEntry(e.url)) e.preventDefault(); };
    wc.on("will-navigate", block);
    wc.on("will-redirect", block);
    wc.on("will-frame-navigate", e => { if (!e.isMainFrame || !isEntry(e.url)) e.preventDefault(); });
    wc.on("will-attach-webview", e => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    win.on("closed", () => { win = null; captured = null; });
    win.loadURL(ENTRY);
    return win;
  }

  async function activeOrThrow(fence) {
    const loaded = await store.loadActive();
    fence();
    if (loaded.state !== "ready") throw Error(loaded.error || "Offline access is not prepared on this Mac.");
    if (!captured || captured.hash !== loaded.hash || captured.preparedAt !== loaded.preparedAt) throw Error("The offline copy changed or was signed out. Reopen the offline workspace.");
    return loaded;
  }
  const findEvent = (backup, id) => { const e = backup.events.find(x => x.id === id); if (!e) throw Error("Event not in the offline copy."); return e; };
  const KNOWN = new Set(["warmUp", "transition", "peak", "selections"]);
  const view = e => ({ id: e.id, version: store.eventVersion(e), name: e.snapshot.name, inputs: e.snapshot.inputs, listType: e.snapshot.inputs && e.snapshot.inputs.listType, otherLists: Object.keys(e.snapshot.lists).filter(k => !KNOWN.has(k) && Array.isArray(e.snapshot.lists[k]) && e.snapshot.lists[k].length).slice(0, 20), lists: { warmUp: e.snapshot.lists.warmUp || [], transition: e.snapshot.lists.transition || [], peak: e.snapshot.lists.peak || [], selections: e.snapshot.lists.selections || {} } });

  async function availability(paths) {
    const out = {};
    await Promise.all([...new Set(paths)].map(async p => {
      try { const st = await fs.promises.stat(p); await fs.promises.access(p, fs.constants.R_OK); out[p] = st.isFile() ? "available" : "unavailable"; } catch { out[p] = "unavailable"; }
    }));
    return out;
  }
  function chosenPaths(event, overlay, roots) {
    const paths = [];
    for (const [section] of core.SECTIONS) (event.lists[section] || []).forEach((_s, i) => {
      const sel = core.effectiveSelection(event, overlay, section, i);
      for (const p of (sel && sel.paths) || []) { const full = core.fullPath(p, roots); if (full) paths.push(full); }
    });
    return paths;
  }

  async function uniqueName(dir, name, taken) {
    const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
    for (let n = 1; n < 1000; n++) {
      const candidate = n === 1 ? name : `${base} (${n})${ext}`;
      if (taken.has(candidate)) continue;
      try { await fs.promises.access(path.join(dir, candidate)); } catch (e) { if (e.code === "ENOENT") return candidate; throw e; }
    }
    throw Error("Too many existing playlists with this name.");
  }

  /** Portable (exFAT/FAT-safe, no hard links), best-effort all-or-nothing publication: each
   * file is created exclusively ("wx", never overwrites), written and fsynced. On failure every
   * file created by THIS export is removed, but cleanup itself can fail (e.g. a drive pulled
   * mid-export), so partial files may remain; those are named in the error, never hidden. */
  async function writeExport(dir, files, fence) {
    const created = [];
    try {
      const taken = new Set();
      for (const f of files) {
        const name = await uniqueName(dir, f.name, taken); taken.add(name);
        fence();
        const target = path.join(dir, name);
        const h = await fs.promises.open(target, "wx", 0o644);
        created.push({ name, target });
        try { await h.writeFile(f.contents, "utf8"); await h.sync(); } finally { await h.close(); }
      }
      fence();
      return { written: created.map(c => c.name), failed: [], leftover: [] };
    } catch (e) {
      const leftover = [];
      for (const c of created) { try { await fs.promises.unlink(c.target); } catch (u) { if (u.code !== "ENOENT") leftover.push(c.name); } }
      const reason = e.code || e.message;
      return { written: [], failed: [reason], leftover, error: leftover.length
        ? `Export failed (${reason}). These partial files could not be removed and should be deleted: ${leftover.join(", ")}`
        : `Export failed (${reason}). The files this export started were removed.` };
    }
  }

  function register() {
    handle("offline:load", async fence => {
      const loaded = await store.loadActive();
      fence();
      if (loaded.state !== "ready") { captured = null; return { ok: true, state: loaded.state, error: loaded.error }; }
      captured = { hash: loaded.hash, preparedAt: loaded.preparedAt };
      const b = loaded.backup;
      const tracks = [];
      for (const s of b.sources) for (const t of s.tracks) tracks.push({ filePath: t.filePath, artist: t.artist, title: t.title, remix: t.remix, bpm: t.bpm, key: t.key, playCount: t.playCount, comment: t.comment, explicit: t.explicit, source: s.label });
      const events = await Promise.all(b.events.map(async e => ({ ...view(e), staleOverlays: await store.staleOverlayCount(loaded.hash, e.id, store.eventVersion(e)) })));
      fence();
      return { ok: true, state: "ready", preparedAt: loaded.preparedAt, fallback: loaded.fallback, events, tracks, roots: { ...b.roots } };
    });
    handle("offline:event", async (fence, id) => {
      const loaded = await activeOrThrow(fence);
      const event = view(findEvent(loaded.backup, id));
      const overlay = await store.readOverlay(loaded.hash, event.id, event.version);
      return { ok: true, overlay: overlay.selections, availability: await availability(chosenPaths(event, overlay, loaded.backup.roots)) };
    });
    handle("offline:choose", async (fence, id, change) => {
      const loaded = await activeOrThrow(fence);
      const next = await store.setChoice(loaded.hash, loaded.backup, id, change, fence);
      const event = view(findEvent(loaded.backup, id));
      return { ok: true, overlay: next.selections, availability: await availability(chosenPaths(event, next, loaded.backup.roots)) };
    });
    handle("offline:export", async (fence, id) => {
      await activeOrThrow(fence);
      const pick = await dialog.showOpenDialog(win, { title: "Choose a folder for VirtualDJ playlists", buttonLabel: "Export here", properties: ["openDirectory", "createDirectory"] });
      if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
      const dir = pick.filePaths[0];
      const loaded = await activeOrThrow(fence); // re-check after the dialog await
      const raw = findEvent(loaded.backup, id), event = view(raw);
      const overlay = await store.readOverlay(loaded.hash, event.id, event.version);
      const index = core.buildIndex(loaded.backup.sources.flatMap(s => s.tracks));
      const plan = core.exportPlan(event, overlay, index, loaded.backup.roots, await availability(chosenPaths(event, overlay, loaded.backup.roots)));
      const name = core.safeFileName(event.name);
      const files = plan.sections.filter(s => s.entries.length).map((s, i) => ({ name: `${name} - ${i + 1} ${s.label}.m3u`, contents: core.m3u(s.entries) }));
      files.push({ name: `${name} - offline readiness.txt`, contents: core.readinessText(plan, { name: event.name, preparedAt: loaded.preparedAt, exportedAt: new Date().toISOString() }) });
      fence();
      const result = await writeExport(dir, files, fence);
      return { ok: result.failed.length === 0, folder: dir, written: result.written, failed: result.failed, leftover: result.leftover, summary: plan.summary, problems: plan.problems, error: result.error };
    });
    handle("offline:reveal", async (_fence, folder) => { if (typeof folder === "string" && path.isAbsolute(folder)) shell.showItemInFolder(folder); return { ok: true }; });
  }

  return { open, register, isEntry, get window() { return win; } };
}

module.exports = { registerOfflineScheme, createOfflineWorkspace, SCHEME, ENTRY, PARTITION, CSP };
