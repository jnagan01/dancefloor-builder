/* Secure bridge between the macOS shell and the web app. */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronVirtualDJ", {
  isAvailable: true,
  getDefaultPath: () => ipcRenderer.invoke("vdj:default-path"),
  readDatabase: (customPath) => ipcRenderer.invoke("vdj:read-database", customPath ?? null),
  chooseDatabase: () => ipcRenderer.invoke("vdj:choose-database"),
  getDefaultRoot: () => ipcRenderer.invoke("vdj:default-root"),
  chooseRoot: () => ipcRenderer.invoke("vdj:choose-root"),
});

contextBridge.exposeInMainWorld("electronFiles", {
  isAvailable: true,
  chooseFolder: () => ipcRenderer.invoke("fs:choose-folder"),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ""; } catch { return ""; }
  },
  writeFile: (dirPath, name, contents) => ipcRenderer.invoke("fs:write-file", { dirPath, name, contents }),
});
