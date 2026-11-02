/* Narrow bridge for the bundled offline workspace only. No file paths can be written by the page. */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("setarchitectOffline", {
  load: () => ipcRenderer.invoke("offline:load"),
  event: id => ipcRenderer.invoke("offline:event", id),
  choose: (id, change) => ipcRenderer.invoke("offline:choose", id, change),
  exportPlaylists: id => ipcRenderer.invoke("offline:export", id),
  reveal: folder => ipcRenderer.invoke("offline:reveal", folder),
});
