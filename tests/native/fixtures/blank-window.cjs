// Minimal synthetic Electron host for offline UI tests: no app code, no network, temp profile only.
const { app, BrowserWindow } = require("electron");
const os = require("node:os"), path = require("node:path"), fs = require("node:fs");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "setarchitect-uitest-")));
app.whenReady().then(() => new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true, contextIsolation: true } }).loadURL("about:blank"));
