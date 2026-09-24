/* Dancefloor Builder — macOS desktop shell (Electron main process) */
const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
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
    },
  });

  // The app reads local music folders and writes playlists back to VirtualDJ,
  // so grant the file-system / media permissions it asks for without prompting.
  const session = mainWindow.webContents.session;
  session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const from = details && details.requestingUrl ? details.requestingUrl : "";
    callback(from.startsWith(APP_ORIGIN));
  });
  session.setPermissionCheckHandler((_wc, _permission, origin) => origin === APP_ORIGIN);

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
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
