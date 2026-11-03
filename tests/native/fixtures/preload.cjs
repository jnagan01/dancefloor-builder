const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('electronUpdates',{subscribe:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('update:status',listener);return ()=>ipcRenderer.removeListener('update:status',listener);}});
contextBridge.exposeInMainWorld('testBackend',{autoUpdate:action=>ipcRenderer.invoke('test:auto-update',action),fixture:()=>ipcRenderer.invoke('test:fixture'),read:id=>ipcRenderer.invoke('test:read',id),write:r=>ipcRenderer.invoke('test:write',r),export:(n,d)=>ipcRenderer.invoke('test:export',n,d),list:account=>ipcRenderer.invoke('test:list',account),library:(s,a)=>ipcRenderer.invoke('test:library',s,a),update:()=>ipcRenderer.invoke('test:update'),lateWrite:(action,id)=>ipcRenderer.invoke('test:late-write',action,id)});
contextBridge.exposeInMainWorld('electronAvailability',{check:paths=>ipcRenderer.invoke('test:availability',paths)});
contextBridge.exposeInMainWorld('electronBackups',{save:(raw,account)=>ipcRenderer.invoke('test:backup',raw,account),latest:account=>ipcRenderer.invoke('test:latest',account)});

contextBridge.exposeInMainWorld('electronVirtualDJ',{isAvailable:true,readDatabase:p=>ipcRenderer.invoke('test:vdj',p)});
contextBridge.exposeInMainWorld('electronFiles',{isAvailable:true,scanFolder:folder=>ipcRenderer.invoke('test:scan',folder),writeFile:(dir,name,data)=>ipcRenderer.invoke('test:native-export',dir,name,data)});
if(process.env.SETARCHITECT_TEST_OLD_SHELL!=='1')contextBridge.exposeInMainWorld('electronOffline',{preparationPolicyVersion:1});

const journal=(action,key,raw)=>{const r=ipcRenderer.sendSync('recovery:journal',action,key,raw);if(!r?.ok)throw Error(r?.error||'Journal unavailable');return r.value??null;};contextBridge.exposeInMainWorld('electronRecovery',{get:key=>journal('get',key),set:(key,raw)=>journal('set',key,raw),remove:key=>journal('remove',key)});
