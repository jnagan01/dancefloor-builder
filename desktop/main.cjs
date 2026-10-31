/* SetArchitect — macOS desktop shell (Electron main process) */
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// Keep the pre-rebrand data folder so window state, tag cache and tag backups carry over.
app.setPath("userData", path.join(app.getPath("appData"), "Dancefloor Builder"));

const { createBackupStore } = require("./backups.cjs");
const backups = createBackupStore(app.getPath("userData"));
const { checkForUpdates } = require("./updater.cjs");
const { createTagCache, writeTags } = require("./tags.cjs");

const APP_URL = process.env.DANCEFLOOR_URL || "https://dancefloor-builder.lovable.app";
const { createDesktopSecurity, parseWebUrl } = require("./security.cjs");
const { scanFolder } = require("./scan.cjs");
const security = createDesktopSecurity(APP_URL, () => mainWindow);

const stateFile = path.join(app.getPath("userData"), "window-state.json");

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (typeof raw.width === "number" && typeof raw.height === "number") return raw;
  } catch {
    /* first launch */
  }
  return { width: 1440, height: 940 };
}

function persistState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const b = win.getBounds();
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {
    /* non-fatal */
  }
}

let mainWindow = null;

function createWindow() {
  const state = readState();

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#0b0b0d",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const session = mainWindow.webContents.session;
  session.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(security.permissionRequest(wc, permission, details));
  });
  session.setPermissionCheckHandler((wc, permission, origin, details) =>
    security.permissionCheck(wc, permission, origin, details),
  );

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (state.maximized) mainWindow.maximize();
  });

  mainWindow.on("resize", () => persistState(mainWindow));
  mainWindow.on("move", () => persistState(mainWindow));
  mainWindow.on("close", () => persistState(mainWindow));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Only the app origin may navigate in this bridged window. Login and other
  // web links open in the system browser, never in a bridge-bearing child.
  const openExternal = url => {
    if (parseWebUrl(url)) shell.openExternal(url).catch(() => {});
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  const guardNavigation = (event, url) => {
    const target = event.url ?? url;
    const action = security.navigation(target);
    if (action !== "app") {
      event.preventDefault();
      if (action === "external" && event.isMainFrame !== false) openExternal(target);
    }
  };
  mainWindow.webContents.on("will-navigate", guardNavigation);
  mainWindow.webContents.on("will-redirect", guardNavigation);
  mainWindow.webContents.on("will-frame-navigate", event => {
    // Subframes may not navigate to untrusted content, even though IPC also
    // rejects all subframe senders. Do not launch browsers for iframe links.
    if (event.isMainFrame) guardNavigation(event, event.url);
    else if (!security.isAppUrl(event.url)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", event => event.preventDefault());

  mainWindow.webContents.on("did-fail-load", (_e, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    dialog
      .showMessageBox(mainWindow, {
        type: "warning",
        title: "Can't reach SetArchitect",
        message: "SetArchitect couldn't load.",
        detail: `Check your internet connection and try again.\n\n(${description} — ${failedUrl})`,
        buttons: ["Try again", "Quit"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) mainWindow.loadURL(APP_URL);
        else app.quit();
      });
  });

  mainWindow.loadURL(APP_URL);
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Check for Updates…",
          click: () => checkForUpdates({ silent: false }),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow && mainWindow.reload(),
        },
        {
          label: "Home",
          accelerator: "CmdOrCtrl+Shift+H",
          click: () => mainWindow && mainWindow.loadURL(APP_URL),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- VirtualDJ database (native disk access) ----
function defaultVdjRoot() {
  const lib = path.join(app.getPath("home"), "Library", "Application Support", "VirtualDJ");
  if (fs.existsSync(path.join(lib, "database.xml"))) return lib;
  const docs = path.join(app.getPath("documents"), "VirtualDJ");
  if (fs.existsSync(path.join(docs, "database.xml"))) return docs;
  return fs.existsSync(lib) ? lib : docs;
}
function defaultVdjPath() {
  return path.join(defaultVdjRoot(), "database.xml");
}

function registerVirtualDjHandlers() {
  const handle = (channel, handler) => ipcMain.handle(channel, security.guard(handler));
  handle("backup:save", async (_event, raw, account) => { try { await backups.save(raw, account); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
  handle("backup:latest", async (_event, account) => { try { return { ok: true, raw: await backups.latest(account) }; } catch (e) { return { ok: false, error: e.message }; } });
  handle("fs:availability", async (_event, paths) => {
    if (!Array.isArray(paths) || paths.length > 10000 || paths.some(p => typeof p !== "string" || !path.isAbsolute(p) || /[\r\n\0]/.test(p))) return { ok: false, error: "Invalid availability request." };
    const entries = await Promise.all(paths.map(async p => { try { const stat = await fs.promises.stat(p); await fs.promises.access(p, fs.constants.R_OK); return [p, stat.isFile() ? "available" : "unavailable"]; } catch { return [p, "unavailable"]; } }));
    return { ok: true, availability: Object.fromEntries(entries) };
  });
  handle("vdj:default-path", () => defaultVdjPath());
  handle("vdj:default-root", () => defaultVdjRoot());
  handle("vdj:choose-root", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose your VirtualDJ folder",
      defaultPath: defaultVdjRoot(),
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "showHiddenFiles"],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    const root = result.filePaths[0];
    const hasDatabase = fs.existsSync(path.join(root, "database.xml"));
    return { ok: true, path: root, hasDatabase };
  });

  handle("vdj:read-database", async (_event, customPath) => {
    const target = typeof customPath === "string" && customPath.trim() ? customPath : defaultVdjPath();
    try {
      const xml = await fs.promises.readFile(target, "utf8");
      return { ok: true, path: target, xml };
    } catch (error) {
      const code = error && error.code;
      const message =
        code === "ENOENT"
          ? "No VirtualDJ database found at that location."
          : code === "EPERM" || code === "EACCES"
            ? "macOS blocked access to that folder. Allow file access for SetArchitect in System Settings › Privacy & Security › Files and Folders."
            : `Couldn't read the VirtualDJ database (${String(code || error)}).`;
      return { ok: false, path: target, error: message };
    }
  });

  // Native folder picking / writing. The browser File System Access API is
  // unreliable inside Electron, so the desktop shell does this natively.
  handle("fs:choose-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose export folder",
      defaultPath: path.join(defaultVdjRoot(), "Playlists"),
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  // Pick a music folder (separate default from the export/VirtualDJ picker).
  handle("fs:choose-music-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose your music folder",
      defaultPath: app.getPath("music"),
      buttonLabel: "Use this folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  // Re-read a remembered music folder straight from disk, so the app never has
  // to ask the user to reconnect it after a restart.
  const tagCache = createTagCache(app.getPath("userData"));
  // Save edited tags straight into the music file (a backup of the old values is kept).
  handle("fs:write-tags", async (_event, payload) => {
    const result = await writeTags(app.getPath("userData"), payload && payload.filePath, payload && payload.tags);
    if (result.ok) {
      tagCache.forget(payload.filePath);
      await tagCache.flush();
    }
    return result;
  });
  handle("fs:scan-folder", async (_event, dirPath) =>
    scanFolder(dirPath, { fs, tagCache }),
  );

  // Read one audio file from disk so it can be played inside the app without
  // reconnecting the folder.
  handle("fs:read-audio", async (_event, filePath) => {
    if (typeof filePath !== "string" || !filePath.trim()) return { ok: false, error: "No file path." };
    try {
      const data = await fs.promises.readFile(filePath);
      return { ok: true, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    } catch (error) {
      return { ok: false, error: `Couldn't read that file (${String((error && error.code) || error)}).` };
    }
  });

  handle("fs:write-file", async (_event, payload) => {
    const dirPath = payload && payload.dirPath;
    const name = payload && payload.name;
    const contents = (payload && payload.contents) ?? "";
    if (typeof dirPath !== "string" || typeof name !== "string") {
      return { ok: false, error: "Missing folder or file name." };
    }
    try {
      await fs.promises.mkdir(dirPath, { recursive: true });
      await fs.promises.writeFile(path.join(dirPath, path.basename(name)), contents, "utf8");
      return { ok: true };
    } catch (error) {
      const code = error && error.code;
      return {
        ok: false,
        error:
          code === "EPERM" || code === "EACCES"
            ? "macOS blocked writing to that folder. Allow file access for SetArchitect in System Settings › Privacy & Security › Files and Folders."
            : `Couldn't write to that folder (${String(code || error)}).`,
      };
    }
  });

  handle("vdj:choose-database", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose your VirtualDJ database",
      defaultPath: defaultVdjPath(),
      properties: ["openFile"],
      filters: [{ name: "VirtualDJ database", extensions: ["xml"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    registerVirtualDjHandlers();
    createWindow();

    // Quietly look for a newer Mac build shortly after launch.
    setTimeout(() => {
      checkForUpdates({ silent: true }).catch(() => {});
    }, 4000);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
