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
  chooseMusicFolder: () => ipcRenderer.invoke("fs:choose-music-folder"),
  scanFolder: (dirPath) => ipcRenderer.invoke("fs:scan-folder", dirPath),
  writeTags: (filePath, tags) => ipcRenderer.invoke("fs:write-tags", { filePath, tags }),
  readAudio: (filePath) => ipcRenderer.invoke("fs:read-audio", filePath),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ""; } catch { return ""; }
  },
  writeFile: (dirPath, name, contents) => ipcRenderer.invoke("fs:write-file", { dirPath, name, contents }),
});

contextBridge.exposeInMainWorld("electronBackups", {
  save: (raw, account) => ipcRenderer.invoke("backup:save", raw, account),
  latest: account => ipcRenderer.invoke("backup:latest", account),
});
contextBridge.exposeInMainWorld("electronAvailability", { check: paths => ipcRenderer.invoke("fs:availability", paths) });

const journal = (action, key, raw) => { const result = ipcRenderer.sendSync("recovery:journal", action, key, raw); if (!result?.ok) throw Error(result?.error || "Recovery journal unavailable."); return result.value ?? null; };
contextBridge.exposeInMainWorld("electronRecovery", { get: key => journal("get", key), set: (key, raw) => journal("set", key, raw), remove: key => journal("remove", key) });

contextBridge.exposeInMainWorld("electronUpdates", {
  status: () => ipcRenderer.invoke("update:status"),
  check: () => ipcRenderer.invoke("update:check"),
  install: () => ipcRenderer.invoke("update:install"),
  cancel: () => ipcRenderer.invoke("update:cancel"),
  subscribe: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on("update:status", listener); return () => ipcRenderer.removeListener("update:status", listener); },
});
