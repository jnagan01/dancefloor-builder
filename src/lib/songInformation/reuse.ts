import { emptyCounts, FRESH_MS, validatedEntry, type Entry, type Kind, type ReuseCounts } from './schema';
export interface Storage { read(keys:string[]):Promise<Entry[]>; write(e:Entry):Promise<void> }
export async function bounded<T>(work:Promise<T>, end:number):Promise<T> {
  work.catch(()=>{}); let timer:ReturnType<typeof setTimeout>|undefined;
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Information time limit')),Math.max(0,end-Date.now()));})]); }
  finally {clearTimeout(timer);}
}
/** One producer per semantic key; unresolved work remains gated after consumer deadlines. */
export function createSharedWork(max=200) {
  type Consumer={current:()=>boolean;end:number;send:()=>Promise<unknown>};
  const work=new Map<string,{promise:Promise<unknown>;consumers:Set<Consumer>}>();
  return async function run<T>(key:string, send:()=>Promise<T>, end:number, current=()=>true):Promise<T> {
    if(!current()||Date.now()>=end) throw new Error('Information cancelled');
    const consumer:Consumer={current,end,send};
    let slot=work.get(key);
    if(!slot) {
      if(work.size>=max) throw new Error('Information busy');
      const consumers=new Set<Consumer>();
      const promise=Promise.resolve().then(()=>{
        const viable=[...consumers].filter(c=>c.current()&&Date.now()<c.end).sort((a,b)=>b.end-a.end)[0];
        if(!viable)throw new Error('Information cancelled');
        return viable.send();
      });
      slot={promise,consumers};work.set(key,slot);const owned=slot;
      void promise.then(()=>{if(work.get(key)===owned)work.delete(key);},()=>{if(work.get(key)===owned)work.delete(key);});
    }
    slot.consumers.add(consumer);
    try {
      const reply=await bounded(slot.promise as Promise<T>,end);
      if(!current()||Date.now()>=end) throw new Error('Information cancelled');
      return reply;
    }finally{slot.consumers.delete(consumer);}
  };
}

export function createEvidenceReuse(storage:Storage, shared=createSharedWork(), now=()=>Date.now()) {
  return async function reuse<T>(kind:Kind,key:string,load:(dispatch:(count?:number)=>void)=>Promise<T>,end:number,current=()=>true):Promise<{value:T;at:number;counts:ReuseCounts;stale:boolean}> {
    const counts=emptyCounts(); let old:Entry|undefined;
    try { const rows=await bounded(storage.read([key]),Math.min(end,now()+500)); old=rows.map(e=>validatedEntry(e,now())).find(e=>e?.key===key&&e.kind===kind)??undefined; }
    catch {counts.readFailed++;}
    if(!current()||now()>=end)throw new Error('Information cancelled');
    if(old&&now()-old.at<FRESH_MS[kind]) {counts.database++;return {value:old.value as T,at:old.at,counts:{...counts},stale:false};}
    try {
      const value=await shared(key,async()=>load((n=1)=>{counts.external+=n;}),end,current);
      const at=now(), e=validatedEntry({kind,key,value,at},at);
      if(!e)throw new Error('Invalid information');
      if(current()&&now()<end) {
        try {await bounded(storage.write(e),Math.min(end,now()+500));} catch {counts.writeFailed++;}
      }
      return {value:e.value as T,at,counts:{...counts},stale:false};
    } catch(error) {
      if((error as {category?:string})?.category!=='none')counts.refreshFailed++;
      if(old&&current()&&now()<end)return {value:old.value as T,at:old.at,counts:{...counts},stale:true};
      throw Object.assign(error instanceof Error ? error : new Error('Information unavailable'), { reuse: {...counts} });
    }
  };
}
