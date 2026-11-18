import { validatedEntry, MAX_LOCAL_ENTRIES, freshMetadata, FRESH_MS, type Entry, type Kind } from './schema';
import { bounded, createSharedWork } from './reuse';
export interface LocalStorage { read(account:string,key:string):Promise<unknown>; write(account:string,entry:Entry):Promise<void> }
export function indexedInformationStorage():LocalStorage {
  let opening:Promise<IDBDatabase>|undefined;
  const open=()=>opening??=new Promise((resolve,reject)=>{
    const r=indexedDB.open('setarchitect-track-information-v1',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('evidence');
    r.onsuccess=()=>resolve(r.result);r.onerror=r.onblocked=()=>{opening=undefined;reject(new Error('Track information storage unavailable'));};
  });
  return {
    async read(account,key) { const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('evidence','readonly'),r=tx.objectStore('evidence').get([account,key]);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Track information read failed'));}); },
    async write(account,entry) {
      const e=validatedEntry(entry);if(!e)throw new Error('Invalid track information');const db=await open();
      await new Promise<void>((resolve,reject)=>{const tx=db.transaction('evidence','readwrite'),s=tx.objectStore('evidence');
        tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new Error('Track information write failed'));
        s.put(e,[account,e.key]);const all=s.getAll(IDBKeyRange.bound([account,''],[account,'\uffff']));
        all.onsuccess=()=>{const rows=(all.result as Entry[]).filter(r=>r&&typeof r.key==='string'&&Number.isFinite(r.at)).sort((a,b)=>b.at-a.at);for(const r of rows.slice(MAX_LOCAL_ENTRIES))s.delete([account,r.key]);};
      });
    },
  };
}
export function createLocalInformation(storage:LocalStorage) {
  let owner:string|null=null, epoch=0;const shared=createSharedWork();
  const activate=(account:string|null)=>{if(owner!==account){owner=account;epoch++;}};
  const session=(account:string)=>{activate(account);const fence=epoch;return ()=>owner===account&&epoch===fence;};
  return {activate,session,
    async read(account:string,key:string,kind:Kind,current:()=>boolean,end:number,needPopularity=false) {
      if(!current())return {entry:null,failed:false};
      try {const raw=await bounded(storage.read(account,key),Math.min(end,Date.now()+250));const e=current()?validatedEntry(raw):null;return {entry:e&&e.kind===kind&&(kind==='metadata'?freshMetadata(e.value,e.at,needPopularity):Date.now()-e.at<FRESH_MS[kind])?e:null,retained:e,failed:false};}
      catch {return {entry:null,failed:true};}
    },
    async write(account:string,entry:Entry,current:()=>boolean,end:number) {
      if(!current()||Date.now()>=end)return false;
      try {await bounded(storage.write(account,entry),Math.min(end,Date.now()+250));return current();}catch{return false;}
    },
    shared,
  };
}
let singleton:ReturnType<typeof createLocalInformation>|undefined;
export const localInformation=()=>singleton??=createLocalInformation(indexedInformationStorage());
