// Only controlled account-hashed files below userData; never accepts an import path.
const path=require('node:path'), crypto=require('node:crypto');
const MAX=32*1024*1024;
const policy=require('./backup-policy.json');
const privateProperty=new RegExp(policy.privatePropertyPattern,'i');
function inspectBackupValues(value,parts=[],depth=0){
 if(depth>policy.maxDepth)throw Error('Backup nesting is too deep.');
 if(typeof value==='number'&&!Number.isFinite(value))throw Error('Unsafe numeric value.');
 if(typeof value==='string'&&(value.length>policy.maxStringLength||value.includes('\0')))throw Error('Unsafe backup value.');
 if(!value||typeof value!=='object')return;
 const dictionary=policy.dictionaryPaths.some(pattern=>{const expected=pattern.split('.');return expected.length===parts.length&&expected.every((part,i)=>part==='*'||part===parts[i]);})||(['events','sources'].includes(parts[0])&&policy.metadataDictionaryProperties.includes(parts.at(-1)));
 for(const[key,child]of Object.entries(value)){
  if(key.length>policy.maxStringLength||key.includes('\0')||policy.dangerousKeys.includes(key.toLowerCase())||(!dictionary&&privateProperty.test(key)))throw Error('Backup contains unsafe or private fields.');
  inspectBackupValues(child,[...parts,key],depth+1);
 }
}
function validate(raw,account){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX)throw Error('Backup too large.');
 const b=JSON.parse(raw);
 if(!b||b.format!=='setarchitect-backup'||b.version!==1||b.account!==account||!Array.isArray(b.events)||b.events.length>500||!Array.isArray(b.sources)||!b.roots||typeof b.roots!=='object'||!Number.isFinite(Date.parse(b.createdAt)))throw Error('Invalid backup.');
 inspectBackupValues(b);
 const labels=new Set(),rootPaths=new Set(),ids=new Set();
 let total=0;for(const s of b.sources){if(!s||typeof s.label!=='string'||!Array.isArray(s.tracks))throw Error('Invalid source.');if(!s.label||labels.has(s.label)||/[\\/\r\n]/.test(s.label))throw Error('Duplicate or unsafe label.');labels.add(s.label);total+=s.tracks.length;const paths=new Set();for(const t of s.tracks)if(!t||typeof t.filePath!=='string'||typeof t.artist!=='string'||typeof t.title!=='string'||/[\r\n]/.test(t.filePath)||t.filePath.split(/[\\/]/).includes('..')||paths.has(t.filePath))throw Error('Invalid track.');else paths.add(t.filePath);}if(total>100000)throw Error('Too many tracks.');
 for(const[label,p]of Object.entries(b.roots))if(!label||/[\\/\r\n]/.test(label)||typeof p!=='string'||/[\r\n\0]/.test(p)||p.split(/[\\/]/).includes('..')||!(/^(?:\/|[A-Za-z]:[\\/])/.test(p)))throw Error('Unsafe mapping.');
 for(const root of Object.values(b.roots)){if(rootPaths.has(root))throw Error('Conflicting root labels.');rootPaths.add(root);}
 for(const e of b.events){if(!e||typeof e.id!=='string'||!e.snapshot||typeof e.snapshot.name!=='string'||!e.snapshot.inputs||!e.snapshot.lists)throw Error('Invalid event.');if(ids.has(e.id))throw Error('Duplicate event.');ids.add(e.id);for(const section of ['warmUp','transition','peak']){const songs=e.snapshot.lists[section];if(songs!==undefined&&(!Array.isArray(songs)||songs.length>2000||songs.some(s=>!s||typeof s.artist!=='string'||typeof s.song!=='string')))throw Error('Invalid songs.');}
  const selections=e.snapshot.lists.selections;
  if(selections!==undefined){if(!selections||typeof selections!=='object'||Array.isArray(selections))throw Error('Invalid selections.');for(const selection of Object.values(selections)){if(!selection||!Array.isArray(selection.paths)||['confirmed','excluded'].some(k=>selection[k]!==undefined&&typeof selection[k]!=='boolean')||selection.paths.some(p=>typeof p!=='string'||p.length>4000||/[\r\n\0]/.test(p)||p.split(/[\\/]/).includes('..')))throw Error('Unsafe selected recording path.');}}
 }
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
