import { EVENT_REVISION_FIELD } from '@/lib/eventRevision';
/** Mock the JSON-path filters and database-owned frozen timestamp, not the write algorithm. */
export function eventDbHarness(frozen = '2026-10-31T00:00:00.000Z') {
  const rows = new Map<string, any>();
  const filters: Array<Array<[string, unknown]>> = [];
  const bodies: any[] = [];
  let writes = 0;
  const db = { from: () => {
    let body:any; const predicates:Array<[string,unknown]> = [];
    const chain:any = {
      upsert: async (value:any, options:any) => {
        if (!options.ignoreDuplicates) throw Error('Blind upsert forbidden');
        bodies.push(value);if(!rows.has(value.id)){rows.set(value.id,{...value,updated_at:frozen});writes++;}return {error:null};
      },
      update: (value:any)=>{body=value;bodies.push(value);return chain;},
      eq:(key:string,value:unknown)=>{predicates.push([key,value]);return chain;},
      is:(key:string,value:unknown)=>{predicates.push([key,value]);return chain;},
      select:()=>chain,
      maybeSingle:async()=>{
        filters.push([...predicates]);const row=rows.get(predicates.find(([k])=>k==='id')?.[1] as string);
        if(!row || predicates.some(([k,v])=>k.startsWith('inputs->>')?row.inputs[EVENT_REVISION_FIELD]!==v:k.startsWith('inputs->')?Object.hasOwn(row.inputs,EVENT_REVISION_FIELD):row[k]!==v))return {data:null,error:null};
        if(body){Object.assign(row,body,{updated_at:frozen});writes++;}return {data:{...row},error:null};
      },
    };return chain;
  }};
  return {db,rows,filters,bodies,get writes(){return writes;}};
}