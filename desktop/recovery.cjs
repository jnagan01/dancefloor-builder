// Small synchronous crash journal. Account/event keys are hashed, never paths.
const path=require('node:path'),crypto=require('node:crypto');
function createRecoveryStore(userData,fs=require('node:fs')){
 const folder=path.join(userData,'event-recovery');
 const location=key=>{if(typeof key!=='string'||!/^setarchitect:recovery:[^:]+:.+/.test(key)||key.length>1500)throw Error('Invalid recovery key.');return path.join(folder,crypto.createHash('sha256').update(key).digest('hex')+'.json');};
 const validate=(raw)=>{if(typeof raw!=='string'||Buffer.byteLength(raw)>32*1024*1024)throw Error('Recovery too large.');JSON.parse(raw);};
 return {
 get(key){const file=location(key);try{const raw=fs.readFileSync(file,'utf8');validate(raw);return raw;}catch(e){if(e.code==='ENOENT')return null;throw e;}},
 set(key,raw){const file=location(key);validate(raw);fs.mkdirSync(folder,{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';let fd;
 try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,raw,'utf8');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);const dir=fs.openSync(folder,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}catch(e){if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}throw e;}},
 remove(key){try{fs.unlinkSync(location(key));}catch(e){if(e.code!=='ENOENT')throw e;}}
 };
}
module.exports={createRecoveryStore};
