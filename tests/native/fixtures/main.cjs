const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),fs=require('node:fs'),http=require('node:http');
const profile=process.env.SETARCHITECT_TEST_PROFILE;
if(!profile||!profile.includes('setarchitect-native-')||!fs.existsSync(path.join(profile,'ISOLATED')))throw Error('Separate synthetic profile required.');
app.setPath('userData',profile);app.disableHardwareAcceleration();
const backend=path.join(profile,'backend.json'),root=path.join(profile,'library'),exportsDir=path.join(profile,'exports');
const {createDesktopSecurity}=require('../../../desktop/security.cjs');
const {createBackupStore}=require('../../../desktop/backups.cjs');const backups=createBackupStore(profile);
let win,server;const fixture=JSON.parse(fs.readFileSync(path.join(profile,'fixture.json'),'utf8'));
const fault=()=>{try{return fs.readFileSync(path.join(profile,'fault'),'utf8');}catch{return '';}};
const read=()=>JSON.parse(fs.readFileSync(backend,'utf8'));
const atomic=data=>{fs.writeFileSync(backend+'.tmp',JSON.stringify(data));fs.renameSync(backend+'.tmp',backend);};
app.whenReady().then(()=>{
server=http.createServer((req,res)=>{const asset=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js'].includes(asset)){res.writeHead(404).end();return;}res.setHeader('Content-Type',asset.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(process.env.SETARCHITECT_TEST_BUNDLE,asset)));});
server.listen(0,'127.0.0.1',()=>{
const origin=`http://127.0.0.1:${server.address().port}`;const security=createDesktopSecurity(origin,()=>win);
const handle=(name,fn)=>ipcMain.handle(name,security.guard(fn));
handle('test:fixture',()=>fixture);
handle('test:read',(_e,id)=>read()[id]);
handle('test:write',async(_e,r)=>{
 if(fault()==='offline')throw Error('Synthetic offline');if(fault()==='hang')return new Promise(()=>{});
 const rows=read(),old=rows[r.id],field='__setarchitect_write_revision_v1';
 if(r.create&&old){if(old.inputs[field]!==r.writeRevision)throw Error('Conflict');return {id:r.id,revision:r.writeRevision,updatedAt:old.updated_at};}
 if(!r.create&&(!old||((old.inputs[field]??null)!==r.expectedRevision)))throw Error('Synthetic conflict');
 rows[r.id]={id:r.id,name:r.name,inputs:{...r.inputs,[field]:r.writeRevision},lists:r.lists,updated_at:'2026-10-31T01:59:00Z'};atomic(rows);
 if(fault()==='late'){await new Promise(resolve=>setTimeout(resolve,1800));}
 return {id:r.id,revision:r.writeRevision,updatedAt:rows[r.id].updated_at};
});
handle('test:export',(_e,name,data)=>{if(typeof name!=='string'||name!==path.basename(name)||typeof data!=='string')throw Error('Unsafe export');if(['ENOSPC','EACCES'].includes(fault()))return {ok:false,error:fault()};fs.mkdirSync(exportsDir,{recursive:true});fs.writeFileSync(path.join(exportsDir,name),data);return {ok:true};});
handle('test:availability',(_e,paths)=>{const availability={};for(const p of paths){if(!p.startsWith(root+path.sep))throw Error('Real library unreachable');availability[p]=fs.existsSync(p)?'available':'unavailable';}return {ok:true,availability};});
handle('test:backup',async(_e,raw,account)=>{if(['ENOSPC','EACCES'].includes(fault()))return {ok:false,error:fault()};try{await backups.save(raw,account);return {ok:true};}catch(e){return {ok:false,error:e.message};}});
win=new BrowserWindow({show:false,width:1280,height:1800,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'preload.cjs')}});
win.webContents.on('will-navigate',(e,url)=>{if(!security.isAppUrl(url))e.preventDefault();});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
win.loadURL(origin);
});});app.on('window-all-closed',()=>{server?.close();app.quit();});
