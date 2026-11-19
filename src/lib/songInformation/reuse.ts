import { emptyCounts, entryLifetime, validatedEntry, type Entry, type Kind, type ReuseCounts } from './schema';
export interface Storage { read(keys:string[]):Promise<Entry[]>; write(e:Entry):Promise<void> }
export async function bounded<T>(work:Promise<T>, end:number):Promise<T> {
  work.catch(()=>{}); let timer:ReturnType<typeof setTimeout>|undefined;
  try { return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Information time limit')),Math.max(0,end-Date.now()));})]); }
  finally {clearTimeout(timer);}
}
/** One producer per semantic key; unresolved work remains gated after consumer deadlines. */
export function createSharedWork(max=200) {
  type Consumer={current:()=>boolean;end:number;send:()=>Promise<unknown>};
  const work=new Map<string,{promise:Promise<unknown>;consumers:Set<Consumer>;state:object}>();
  return async function run<T>(key:string, send:()=>Promise<T>, end:number, current=()=>true, observe?:(state:object)=>void):Promise<T> {
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
      slot={promise,consumers,state:{}};work.set(key,slot);const owned=slot;
      void promise.then(()=>{if(work.get(key)===owned)work.delete(key);},()=>{if(work.get(key)===owned)work.delete(key);});
    }
    slot.consumers.add(consumer);
    observe?.(slot.state);
    try {
      const reply=await bounded(slot.promise as Promise<T>,end);
      if(!current()||Date.now()>=end) throw new Error('Information cancelled');
      return reply;
    }finally{slot.consumers.delete(consumer);}
  };
}

export function createEvidenceReuse(storage:Storage, shared=createSharedWork(), now=()=>Date.now()) {
  return async function reuse<T>(kind:Kind,key:string,load:(dispatch:(count?:number)=>void,aggregate:(counts?:ReuseCounts)=>void)=>Promise<T>,end:number,current=()=>true):Promise<{value:T;at:number;counts:ReuseCounts;stale:boolean}> {
    const counts=emptyCounts(); let old:Entry|undefined;
    try { const rows=await bounded(storage.read([key]),Math.min(end,now()+500)); old=rows.map(e=>validatedEntry(e,now())).find(e=>e?.key===key&&e.kind===kind)??undefined; }
    catch {counts.readFailed++;}
    if(!current()||now()>=end)throw new Error('Information cancelled');
    if(old&&now()-old.at<entryLifetime(old)) {counts.database++;return {value:old.value as T,at:old.at,counts:{...counts},stale:false};}
    let progress:{counts:ReuseCounts;reported:ReuseCounts}|undefined;
    const report=()=>{if(progress&&current())for(const k of Object.keys(counts) as Array<keyof ReuseCounts>){counts[k]+=progress.counts[k]-progress.reported[k];progress.reported[k]=progress.counts[k];}};
    try {
      const reply=await shared(key,async()=>{
        const workCounts=progress?.counts??emptyCounts();
        const aggregate=(c?:ReuseCounts)=>{if(c)for(const k of Object.keys(workCounts) as Array<keyof ReuseCounts>)workCounts[k]+=c[k]??0;};
        try {
          const value=await load((n=1)=>{workCounts.external+=n;},aggregate);
          const at=now(),e=validatedEntry({kind,key,value,at},at);
          if(!e)throw new Error('Invalid information');
          if(now()<end)try{await bounded(storage.write(e),Math.min(end,now()+500));}catch{workCounts.writeFailed++;}
          return {e,workCounts};
        }catch(error){throw Object.assign(error instanceof Error?error:Error('Information unavailable'),{workCounts});}
      },end,current,state=>{let p=workProgress.get(state);if(!p){p={counts:emptyCounts(),reported:emptyCounts()};workProgress.set(state,p);}progress=p;});
      report();
      return {value:reply.e.value as T,at:reply.e.at,counts:{...counts},stale:false};
    } catch(error) {
      report();
      if((error as {category?:string})?.category!=='none')counts.refreshFailed++;
      if(old&&current()&&now()<end){counts.database++;return {value:old.value as T,at:old.at,counts:{...counts},stale:true};}
      throw Object.assign(error instanceof Error ? error : new Error('Information unavailable'), { reuse: {...counts} });
    }
  };
}
// Shared producer work (including nested reads/failures/writes) is reported by one
// accepting consumer; cancelled peers cannot steal its transport counts.
const workProgress=new WeakMap<object,{counts:ReuseCounts;reported:ReuseCounts}>();
