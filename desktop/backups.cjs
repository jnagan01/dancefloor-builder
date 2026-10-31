// Only controlled account-hashed files below userData; never accepts an import path.
const path=require('node:path'), crypto=require('node:crypto');
const MAX=32*1024*1024;
function validate(raw,account){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX)throw Error('Backup too large.');
 const b=JSON.parse(raw);
 if(!b||b.format!=='setarchitect-backup'||b.version!==1||b.account!==account||!Array.isArray(b.events)||b.events.length>500||!Array.isArray(b.sources)||!b.roots||typeof b.roots!=='object'||!Number.isFinite(Date.parse(b.createdAt)))throw Error('Invalid backup.');
 const visit=(v,depth=0)=>{if(depth>30)throw Error('Backup nesting too deep.');if(typeof v==='string'&&v.includes('\0'))throw Error('Unsafe value.');if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(/^(?:__proto__|constructor|prototype|.*password.*|.*credential.*|.*session.*|.*access.?token.*|.*refresh.?token.*|.*secret.*|.*api.?key.*)$/i.test(k))throw Error('Private field in backup.');visit(x,depth+1);}};visit(b);
 let total=0;for(const s of b.sources){if(!s||typeof s.label!=='string'||!Array.isArray(s.tracks))throw Error('Invalid source.');total+=s.tracks.length;for(const t of s.tracks)if(!t||typeof t.filePath!=='string'||typeof t.artist!=='string'||typeof t.title!=='string')throw Error('Invalid track.');}if(total>100000)throw Error('Too many tracks.');
 for(const[label,p]of Object.entries(b.roots))if(!label||/[\\/\r\n]/.test(label)||typeof p!=='string'||/[\r\n\0]/.test(p)||p.split(/[\\/]/).includes('..')||!(/^(?:\/|[A-Za-z]:[\\/])/.test(p)))throw Error('Unsafe mapping.');
 for(const e of b.events){if(!e||typeof e.id!=='string'||!e.snapshot||typeof e.snapshot.name!=='string'||!e.snapshot.inputs||!e.snapshot.lists)throw Error('Invalid event.');for(const section of ['warmUp','transition','peak']){const songs=e.snapshot.lists[section];if(songs!==undefined&&(!Array.isArray(songs)||songs.length>2000||songs.some(s=>!s||typeof s.artist!=='string'||typeof s.song!=='string')))throw Error('Invalid songs.');}}
 return b;
}
function createBackupStore(userData,fs=require('node:fs')){
 const dir=account=>{if(typeof account!=='string'||!account||account.length>200)throw Error('Invalid account.');return path.join(userData,'backups',crypto.createHash('sha256').update(account).digest('hex'));};
 async function list(account){let names;try{names=await fs.promises.readdir(dir(account));}catch(e){if(e.code==='ENOENT')return [];throw e;}return names.filter(n=>/^\d{13}-[a-f0-9-]{36}\.json$/.test(n)).sort();}
 return {
 async save(raw,account){validate(raw,account);const folder=dir(account);await fs.promises.mkdir(folder,{recursive:true});const name=`${Date.now()}-${crypto.randomUUID()}.json`,dest=path.join(folder,name),temp=dest+'.tmp';let handle;
 try{handle=await fs.promises.open(temp,'wx',0o600);await handle.writeFile(raw,'utf8');await handle.sync();await handle.close();handle=null;validate(await fs.promises.readFile(temp,'utf8'),account);await fs.promises.rename(temp,dest);}catch(e){if(handle)await handle.close().catch(()=>{});await fs.promises.unlink(temp).catch(()=>{});throw e;}
 // Retention only after a verified atomic new copy; retain the newest ten valid copies.
 const names=await list(account),valid=[];for(const n of names){try{validate(await fs.promises.readFile(path.join(folder,n),'utf8'),account);valid.push(n);}catch{}}
 for(const n of valid.slice(0,-10))await fs.promises.unlink(path.join(folder,n)).catch(()=>{});
 return name;
 },
 async latest(account){const names=(await list(account)).reverse();for(const n of names){try{const raw=await fs.promises.readFile(path.join(dir(account),n),'utf8');validate(raw,account);return raw;}catch{}}if(names.length)throw Error('No readable backup; originals preserved.');return null;},
 async verifyAll(){const base=path.join(userData,'backups');let accounts;try{accounts=await fs.promises.readdir(base);}catch(e){if(e.code==='ENOENT')throw Error('Make a backup in Settings before updating.');throw e;}
 let count=0;for(const hash of accounts.filter(n=>/^[a-f0-9]{64}$/.test(n))){const folder=path.join(base,hash);for(const n of(await fs.promises.readdir(folder)).filter(n=>/\.json$/.test(n)).sort().reverse()){try{const raw=await fs.promises.readFile(path.join(folder,n),'utf8'),b=JSON.parse(raw);validate(raw,b.account);if(crypto.createHash('sha256').update(b.account).digest('hex')!==hash)throw Error('Account mismatch');await this.save(raw,b.account);count++;break;}catch{}}}if(!count)throw Error('No valid backup; update stopped. Make a backup in Settings.');}
 };
}
module.exports={createBackupStore,validate};
