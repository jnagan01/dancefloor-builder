/* Dancefloor Builder — macOS desktop shell (Electron main process) */
const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const APP_URL = process.env.DANCEFLOOR_URL || "https://dancefloor-builder.lovable.app";
const APP_ORIGIN = new URL(APP_URL).origin;

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

  // The app reads local music folders and writes playlists back to VirtualDJ,
  // so grant the file-system / media permissions it asks for without prompting.
  const session = mainWindow.webContents.session;
  // Some requests (notably "fileSystem" from the folder picker) arrive without
  // requestingUrl, so fall back to the page's own URL before deciding.
  const isAppUrl = (u) => typeof u === "string" && u.startsWith(APP_ORIGIN);
  session.setPermissionRequestHandler((wc, _permission, callback, details) => {
    const from = (details && details.requestingUrl) || (wc && wc.getURL()) || "";
    callback(isAppUrl(from));
  });
  session.setPermissionCheckHandler((wc, _permission, origin) =>
    isAppUrl(origin) || isAppUrl(wc && wc.getURL()),
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

  // Keep the app inside its own window; send everything else to the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_ORIGIN)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    dialog
      .showMessageBox(mainWindow, {
        type: "warning",
        title: "Can't reach Dancefloor Builder",
        message: "Dancefloor Builder couldn't load.",
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
  ipcMain.handle("vdj:default-path", () => defaultVdjPath());
  ipcMain.handle("vdj:default-root", () => defaultVdjRoot());
  ipcMain.handle("vdj:choose-root", async () => {
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

  ipcMain.handle("vdj:read-database", async (_event, customPath) => {
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
            ? "macOS blocked access to that folder. Allow file access for Dancefloor Builder in System Settings › Privacy & Security › Files and Folders."
            : `Couldn't read the VirtualDJ database (${String(code || error)}).`;
      return { ok: false, path: target, error: message };
    }
  });

  // Native folder picking / writing. The browser File System Access API is
  // unreliable inside Electron, so the desktop shell does this natively.
  ipcMain.handle("fs:choose-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose export folder",
      defaultPath: path.join(defaultVdjRoot(), "Playlists"),
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle("fs:write-file", async (_event, payload) => {
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
            ? "macOS blocked writing to that folder. Allow file access for Dancefloor Builder in System Settings › Privacy & Security › Files and Folders."
            : `Couldn't write to that folder (${String(code || error)}).`,
      };
    }
  });

  ipcMain.handle("vdj:choose-database", async () => {
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

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
