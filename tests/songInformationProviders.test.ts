import { afterEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({rows:new Map<string,any>(),reads:0,writes:0}));
vi.mock('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:()=>({select:()=>({in:async(_c:string,keys:string[])=>{state.reads++;return {data:keys.flatMap(k=>state.rows.has(k)?[state.rows.get(k)]:[]),error:null};}}),upsert:async(row:any)=>{state.writes++;state.rows.set(row.cache_key,row);return {error:null};}})}}));
import { similarEvidence, communityEvidence } from '@/lib/songInformation/lastfm.server';
afterEach(()=>{vi.unstubAllGlobals();state.rows.clear();});
it('canonical similarity and exact community survive adapter recreation with no external work on repeat',async()=>{
 const fetcher=vi.fn(async(input:any)=>{const method=new URL(String(input)).searchParams.get('method');return new Response(JSON.stringify(method==='track.getsimilar'?{similartracks:{track:[{name:'Related',artist:{name:'TEST Neighbor'},match:'0.8'}]}}:{track:{name:'Exact (Live)',artist:{name:'TEST Full & Guest'},listeners:'6000',toptags:{tag:[{name:'dance'}]}}}));});
 const a=await similarEvidence('synthetic','TEST Full & Guest','Exact (Live)',Date.now()+1000,fetcher);
 const b=await communityEvidence('synthetic','TEST Full & Guest','Exact (Live)',Date.now()+1000,fetcher);
 expect(a.value.similar).toHaveLength(1);expect(b.value.upbeatTags).toEqual(['dance']);expect(fetcher).toHaveBeenCalledTimes(2);
 const aa=await similarEvidence('synthetic','TEST Full & Guest','Exact (Live)',Date.now()+1000,fetcher);
 const bb=await communityEvidence('synthetic','TEST Full & Guest','Exact (Live)',Date.now()+1000,fetcher);
 expect(fetcher).toHaveBeenCalledTimes(2);expect(aa.counts.database).toBe(1);expect(bb.counts.database).toBe(1);
 expect([...state.rows.values()].every(v=>!JSON.stringify(v).includes('synthetic'))).toBe(true);
 console.info('SYNTHETIC canonical external requests: 2 -> 0 across recreated adapters');
});
it('wrong remix/credit responses are never reusable evidence',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({track:{name:'Exact (Remix)',artist:{name:'TEST Other'},listeners:'6000',toptags:{tag:[{name:'dance'}]}}})));
 await expect(communityEvidence('synthetic','TEST Full & Guest','Exact (Live)',Date.now()+1000,fetcher)).rejects.toThrow();expect(state.rows.size).toBe(0);
});

import { runCommunityBatch } from '@/lib/prep/community.functions';
import { createEvidenceStorage } from '@/lib/songInformation/cache.server';
it('actual durable community batch keeps error6/no-data distinct from service and per-call timeouts',async()=>{
 const songs=[{artist:'TEST Durable',song:'Exact (Live)'}],storage=createEvidenceStorage();
 for(const body of [{error:6}, {track:{name:'Other',artist:{name:'Wrong'}}}]){
  const f=vi.fn(async()=>new Response(JSON.stringify(body)));
  const rows=await runCommunityBatch(songs,'synthetic',f,1000,500,storage);
  expect(rows[0].status).toBe('none');expect(rows[0].reuse).toMatchObject({external:1,refreshFailed:0});expect(state.rows.size).toBe(0);
 }
 const failed=await runCommunityBatch(songs,'synthetic',async()=>new Response('{}',{status:503}),1000,500,storage);
 expect(failed[0]).toMatchObject({status:'failed',reuse:{external:1,refreshFailed:1}});
 vi.useFakeTimers();try{
  const pending=runCommunityBatch(songs,'synthetic',()=>new Promise(()=>{}),1000,100,storage);
  await vi.advanceTimersByTimeAsync(101);const timed=await pending;
  expect(timed[0]).toMatchObject({status:'timeout',reuse:{external:1}});expect(state.rows.size).toBe(0);
 }finally{vi.useRealTimers();}
});

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { z } from 'zod';
import * as reuse from '@/lib/songInformation/reuse';
import * as schema from '@/lib/songInformation/schema';
import * as parsers from '@/lib/prep/lookupParse';
import * as lastfm from '@/lib/songInformation/lastfm.server';
import * as cacheModule from '@/lib/songInformation/cache.server';
function actualDetails(){
 const ts=createRequire(import.meta.url)('typescript'),m={exports:{} as any};
 const builder=()=>{let validator:(d:any)=>any;const b={middleware:()=>b,inputValidator:(v:any)=>{validator=v;return b;},handler:(h:any)=>(data:any)=>h({data:validator(data)})};return b;};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/prep/lookup.functions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,URL,AbortSignal,console,Date,process:{env:{LASTFM_API_KEY:'synthetic'}},fetch:(...args:any[])=>globalThis.fetch(...args as Parameters<typeof fetch>),require:(k:string)=>({'@tanstack/react-start':{createServerFn:builder},zod:{z},'@/integrations/supabase/auth-middleware':{requireSupabaseAuth:{}},'./lookupParse':parsers,'../songInformation/schema':schema,'../songInformation/reuse':reuse,'../songInformation/lastfm.server':lastfm,'../songInformation/cache.server':cacheModule} as any)[k]});return m.exports;
}
it('actual details handler dispatches three HTTP checks, shares compatible durable evidence, repeat dispatches zero',async()=>{
 const artist='TEST Details',title='Exact (Live)',f=vi.fn(async(input:any)=>{
  const method=new URL(String(input)).searchParams.get('method');
  return new Response(JSON.stringify(method==='track.gettoptags'?{toptags:{tag:[{name:'dance'}]}}:method==='track.getsimilar'?{similartracks:{track:[{name:'Related',artist:{name:'TEST Neighbor'},match:'0.8'}]}}:{track:{name:title,artist:{name:artist},listeners:'6000',toptags:{tag:[{name:'dance'}]}}}));
 });vi.stubGlobal('fetch',f);
 const details=actualDetails();const first=await details.lookupLastfmTrack({artist,title});
 expect(first.ok).toBe(true);expect(f).toHaveBeenCalledTimes(3);expect(first.reuse.external).toBe(3);expect(first.compatible).toHaveLength(2);
 const second=await actualDetails().lookupLastfmTrack({artist,title});expect(second.reuse.database).toBe(1);expect(second.reuse.external).toBe(0);expect(f).toHaveBeenCalledTimes(3);
 const generation=await similarEvidence('synthetic',artist,title,Date.now()+1000,f);expect(generation.counts.external).toBe(0);expect(generation.at).toBe(first.compatible[0].at);
});
