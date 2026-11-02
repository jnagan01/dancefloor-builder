const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('prepNative', {
  fixture: () => ipcRenderer.invoke('prep:fixture'),
  blocked: () => ipcRenderer.invoke('prep:blocked'),
  save: (raw, account) => ipcRenderer.invoke('prep:backup-save', raw, account),
  latest: account => ipcRenderer.invoke('prep:backup-latest', account),
});
