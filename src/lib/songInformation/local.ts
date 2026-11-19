import { validatedEntry, mergeEntries, MAX_LOCAL_ENTRIES, freshMetadata, entryLifetime, type Entry, type Kind } from './schema';
import { bounded, createSharedWork } from './reuse';
export interface LocalStorage { read(account:string,key:string):Promise<unknown>; write(account:string,entry:Entry,current?:()=>boolean):Promise<void> }
export function indexedInformationStorage():LocalStorage {
  let opening:Promise<IDBDatabase>|undefined;
  const open=()=>opening??=new Promise((resolve,reject)=>{
    const r=indexedDB.open('setarchitect-track-information-v1',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('evidence');
    r.onsuccess=()=>resolve(r.result);r.onerror=r.onblocked=()=>{opening=undefined;reject(new Error('Track information storage unavailable'));};
  });
  return {
    async read(account,key) { const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('evidence','readonly'),r=tx.objectStore('evidence').get([account,key]);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Track information read failed'));}); },
    async write(account,entry,current=()=>true) {
      const e=validatedEntry(entry);if(!e)throw new Error('Invalid track information');const db=await open();if(!current())throw new Error('Information cancelled');
      await new Promise<void>((resolve,reject)=>{const tx=db.transaction('evidence','readwrite'),s=tx.objectStore('evidence');
        tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new Error('Track information write failed'));
        if(!current()){tx.abort();return;}
        const existing=s.get([account,e.key]);existing.onsuccess=()=>{if(!current()){tx.abort();return;}const old=validatedEntry(existing.result);
          // Same per-field provenance/date merge as the service trigger, inside this one readwrite transaction, so a
          // newer weaker/partial reply from another caller or window never replaces stronger saved fields.
          const merged=validatedEntry(mergeEntries(old,e));if(!merged){tx.abort();return;}s.put(merged,[account,e.key]);
          // Prune read queued after the put in this transaction, so it observes the refreshed row and its new timestamp.
          const all=s.getAll(IDBKeyRange.bound([account,''],[account,'\uffff']));
          all.onsuccess=()=>{if(!current()){tx.abort();return;}const rows=(all.result as Entry[]).filter(r=>r&&typeof r.key==='string'&&Number.isFinite(r.at)).sort((a,b)=>b.at-a.at);for(const r of rows.slice(MAX_LOCAL_ENTRIES))s.delete([account,r.key]);};};
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
      try {const raw=await bounded(storage.read(account,key),Math.min(end,Date.now()+250));const candidate=current()?validatedEntry(raw):null;const e=candidate?.key===key&&candidate.kind===kind?candidate:null;return {entry:e&&e.kind===kind&&(kind==='metadata'?freshMetadata(e.value,e.at,needPopularity):Date.now()-e.at<entryLifetime(e))?e:null,retained:e,failed:false};}
      catch {return {entry:null,failed:true};}
    },
    async write(account:string,entry:Entry,current:()=>boolean,end:number) {
      if(!current()||Date.now()>=end)return false;
      try {await bounded(storage.write(account,entry,()=>current()&&Date.now()<end),Math.min(end,Date.now()+250));return current();}catch{return false;}
    },
    shared,
  };
}
let singleton:ReturnType<typeof createLocalInformation>|undefined;
export const localInformation=()=>singleton??=createLocalInformation(indexedInformationStorage());
