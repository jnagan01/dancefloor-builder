const {contextBridge,ipcRenderer}=require('../../../desktop/node_modules/electron');
contextBridge.exposeInMainWorld('testBackend',{fixture:()=>ipcRenderer.invoke('test:fixture'),read:id=>ipcRenderer.invoke('test:read',id),write:r=>ipcRenderer.invoke('test:write',r),export:(n,d)=>ipcRenderer.invoke('test:export',n,d)});
contextBridge.exposeInMainWorld('electronAvailability',{check:paths=>ipcRenderer.invoke('test:availability',paths)});
contextBridge.exposeInMainWorld('electronBackups',{save:(raw,account)=>ipcRenderer.invoke('test:backup',raw,account)});
