import { emptyCounts, FRESH_MS, validatedEntry, type Entry, type Kind, type ReuseCounts } from './schema';
export interface Storage { read(keys:string[]):Promise<Entry[]>; write(e:Entry):Promise<void> }
export async function bounded<T>(work:Promise<T>, end:number):Promise<T> {
  work.catch(()=>{}); let timer:ReturnType<typeof setTimeout>|undefined;
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Information time limit')),Math.max(0,end-Date.now()));})]); }
  finally {clearTimeout(timer);}
}
/** One producer per semantic key; unresolved work remains gated after consumer deadlines. */
export function createSharedWork(max=200) {
  const work=new Map<string,Promise<unknown>>();
  return async function run<T>(key:string, send:()=>Promise<T>, end:number, current=()=>true):Promise<T> {
    if(!current()||Date.now()>=end) throw new Error('Information cancelled');
    let p=work.get(key);
    if(!p) {
      if(work.size>=max) throw new Error('Information busy');
      p=Promise.resolve().then(()=>{if(!current()||Date.now()>=end) throw new Error('Information cancelled');return send();});
      work.set(key,p); const owned=p;
      void p.then(()=>{if(work.get(key)===owned)work.delete(key);},()=>{if(work.get(key)===owned){work.delete(key);}});
    }
    const reply=await bounded(p as Promise<T>,end);
    if(!current()||Date.now()>=end) throw new Error('Information cancelled');
    return reply;
  };
}
export function createEvidenceReuse(storage:Storage, shared=createSharedWork(), now=()=>Date.now()) {
  return async function reuse<T>(kind:Kind,key:string,load:()=>Promise<T>,end:number,current=()=>true):Promise<{value:T;at:number;counts:ReuseCounts;stale:boolean}> {
    const counts=emptyCounts(); let old:Entry|undefined;
    try { const rows=await bounded(storage.read([key]),Math.min(end,now()+500)); old=rows.map(e=>validatedEntry(e,now())).find(e=>e?.key===key&&e.kind===kind)??undefined; }
    catch {counts.readFailed++;}
    if(!current()||now()>=end)throw new Error('Information cancelled');
    if(old&&now()-old.at<FRESH_MS[kind]) {counts.database++;return {value:old.value as T,at:old.at,counts,stale:false};}
    try {
      const value=await shared(key,async()=>{counts.external++;return load();},end,current);
      const at=now(), e=validatedEntry({kind,key,value,at},at);
      if(!e)throw new Error('Invalid information');
      if(current()&&now()<end) {
        try {await bounded(storage.write(e),Math.min(end,now()+500));} catch {counts.writeFailed++;}
      }
      return {value:e.value as T,at,counts,stale:false};
    } catch(error) {
      counts.refreshFailed++;
      if(old&&current()&&now()<end)return {value:old.value as T,at:old.at,counts,stale:true};
      throw Object.assign(error instanceof Error ? error : new Error('Information unavailable'), { reuse: counts });
    }
  };
}
