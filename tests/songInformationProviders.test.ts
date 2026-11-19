import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { evidenceFilterKeys } from './helpers/postgrestEvidence';
const state=vi.hoisted(()=>({rows:new Map<string,any>(),reads:0,writes:0,delay:0,failReads:new Set<string>(),failWrites:new Set<string>()}));
vi.mock('@/integrations/supabase/client.server',()=>({get supabaseAdmin(){return createClient('http://127.0.0.1:9','synthetic-only',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
 const url=new URL(String(input));if(init?.method==='POST'){const row=JSON.parse(String(init.body));state.writes++;if(state.failWrites.has(row.kind))return new Response('{"message":"synthetic write failure"}',{status:400});state.rows.set(row.cache_key,row);return new Response(null,{status:201});}
 state.reads++;if(state.delay)await new Promise(r=>setTimeout(r,state.delay));const keys=evidenceFilterKeys(url.searchParams.get('cache_key')??'');if(keys.some(k=>state.failReads.has(JSON.parse(k)[0])))return new Response('{"message":"synthetic read failure"}',{status:400});return new Response(JSON.stringify(keys.flatMap(k=>state.rows.has(k)?[state.rows.get(k)]:[])),{headers:{'content-type':'application/json'}});
}}});}}));
import { similarEvidence, communityEvidence } from '@/lib/songInformation/lastfm.server';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();state.delay=0;state.rows.clear();state.failReads.clear();state.failWrites.clear();});
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
import * as similarModule from '@/lib/prep/similarTracks';
function actualDetails(){
 const ts=createRequire(import.meta.url)('typescript'),m={exports:{} as any};
 const builder=()=>{let validator:(d:any)=>any;const b={middleware:()=>b,inputValidator:(v:any)=>{validator=v;return b;},handler:(h:any)=>(data:any)=>h({data:validator(data)})};return b;};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/prep/lookup.functions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,URL,AbortSignal,console,Date,process:{env:{LASTFM_API_KEY:'synthetic'}},fetch:(...args:any[])=>globalThis.fetch(...args as Parameters<typeof fetch>),require:(k:string)=>({'@tanstack/react-start':{createServerFn:builder},zod:{z},'@/integrations/supabase/auth-middleware':{requireSupabaseAuth:{}},'./lookupParse':parsers,'../songInformation/schema':schema,'../songInformation/reuse':reuse,'../songInformation/lastfm.server':lastfm,'../songInformation/cache.server':cacheModule} as any)[k]});return m.exports;
}
function actualCrowd(){
 const ts=createRequire(import.meta.url)('typescript'),m={exports:{} as any};
 const builder=()=>{let validator:(d:any)=>any;const b={middleware:()=>b,inputValidator:(v:any)=>{validator=v;return b;},handler:(h:any)=>(data:any)=>h({data:validator(data)})};return b;};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/lastfm.functions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,URL,AbortSignal,console,Date,process:{env:{LASTFM_API_KEY:'synthetic'}},fetch:(...args:any[])=>globalThis.fetch(...args as Parameters<typeof fetch>),require:(k:string)=>({'@tanstack/react-start':{createServerFn:builder},zod:{z},'@/integrations/supabase/auth-middleware':{requireSupabaseAuth:{}},'@/lib/prep/similarTracks':similarModule,'./songInformation/schema':schema,'./songInformation/reuse':reuse,'./songInformation/cache.server':cacheModule} as any)[k]});return m.exports;
}
it('actual artist handler reads fresh durable artist evidence after service recreation through the SDK',async()=>{
 const artist='TEST Artist "Quoted", \\ & Guest',f=vi.fn(async(input:any)=>new Response(JSON.stringify(new URL(String(input)).searchParams.get('method')==='artist.getinfo'?{artist:{name:artist,stats:{listeners:'5000',playcount:'9000'},tags:{tag:[{name:'dance'}]}}}:{similarartists:{artist:[{name:'TEST Peer',match:'0.8'}]}})));vi.stubGlobal('fetch',f);
 const a=await actualCrowd().getArtistCrowdData({artists:[artist],perArtistSimilar:10});
 const b=await actualCrowd().getArtistCrowdData({artists:[artist],perArtistSimilar:10});
 expect(a.reuse.external).toBe(2);expect(b.reuse).toMatchObject({external:0,database:1,readFailed:0});expect(f).toHaveBeenCalledTimes(2);expect(b.evidence[0].at).toBe(a.evidence[0].at);
});
it('actual artist handler batches a slow cold 800ms cache read, deduplicates and sends zero external requests',async()=>{
 vi.useFakeTimers();const artists=Array.from({length:20},(_,i)=>`TEST Cold ${i}`),at=Date.now()-60000;
 for(const name of artists){const key=schema.informationKey('artist',name,'','0');state.rows.set(key,{cache_key:key,kind:'artist',value:{name,listeners:50,playcount:100,tags:['dance'],similar:[]},fetched_at:new Date(at).toISOString()});}
 const f=vi.fn(async()=>{throw Error('External request forbidden');});vi.stubGlobal('fetch',f);state.delay=800;
 const before=state.reads,pending=actualCrowd().getArtistCrowdData({artists:[...artists,artists[0]],perArtistSimilar:0});
 await vi.advanceTimersByTimeAsync(801);const result=await pending;
 expect(result.artists).toHaveLength(20);expect(result.reuse).toMatchObject({database:20,external:0,readFailed:0});expect(result.evidence.every((e:any)=>e.at===at)).toBe(true);expect(state.reads-before).toBe(1);expect(f).not.toHaveBeenCalled();
 const warm=actualCrowd().getArtistCrowdData({artists,perArtistSimilar:0});await vi.advanceTimersByTimeAsync(801);expect((await warm).reuse.external).toBe(0);expect(f).not.toHaveBeenCalled();
});
it('actual failed artist batch reports one read transport failure without per-artist retries',async()=>{
 const artists=['TEST Failed 1','TEST Failed 2','TEST Failed 3'];state.failReads.add('artist');const before=state.reads;
 const f=vi.fn(async(input:any)=>{const name=new URL(String(input)).searchParams.get('artist');return new Response(JSON.stringify({artist:{name,stats:{listeners:'50',playcount:'100'},tags:{tag:[]}}}));});vi.stubGlobal('fetch',f);
 const result=await actualCrowd().getArtistCrowdData({artists,perArtistSimilar:0});expect(state.reads-before).toBe(1);expect(f).toHaveBeenCalledTimes(3);expect(result.reuse).toMatchObject({readFailed:1,readOther:1,database:0,external:3,missing:0});
});
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
it('actual MusicBrainz details handler refreshes a definitive miss after 24 hours, not every lookup',async()=>{
 vi.useFakeTimers();try{
  const f=vi.fn(async()=>new Response('{"recordings":[]}'));vi.stubGlobal('fetch',f);
  const details=actualDetails(),request={artist:'TEST Miss',title:'Exact (Live)'};
  const first=await details.lookupMusicBrainz(request);expect(f).toHaveBeenCalledTimes(1);expect(first.reuse.external).toBe(1);
  await actualDetails().lookupMusicBrainz(request);expect(f).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(86400001);
  await actualDetails().lookupMusicBrainz(request);expect(f).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers();}
});

const publicReply=(artist:string,title:string)=>(input:any)=>{
 const method=new URL(String(input)).searchParams.get('method');
 return new Response(JSON.stringify(method==='track.gettoptags'?{toptags:{tag:[{name:'dance'}]}}:method==='track.getsimilar'?{similartracks:{track:[{name:'Related',artist:{name:'TEST Neighbor'},match:'0.8'}]}}:{track:{name:title,artist:{name:artist},listeners:'6000',toptags:{tag:[{name:'dance'}]}}}));
};
it('fresh generation evidence is read by actual details through HTTP with original dates and only the tags check',async()=>{
 const artist='TEST Generation "Quote" \\ & Guest',title='Exact, (Live)',f=vi.fn(async(input:any)=>publicReply(artist,title)(input));vi.stubGlobal('fetch',f);
 const similarity=await similarEvidence('synthetic',artist,title,Date.now()+2000,f);
 const community=await communityEvidence('synthetic',artist,title,Date.now()+2000,f);
 const writes=state.writes;
 const result=await actualDetails().lookupLastfmTrack({artist,title});
 expect(result.ok).toBe(true);expect(f).toHaveBeenCalledTimes(3);
 expect(result.reuse).toMatchObject({database:2,external:1,readFailed:0,writeFailed:0,refreshFailed:0});
 expect(result.compatible.map((e:any)=>e.at)).toEqual([similarity.at,community.at]);
 expect(state.writes-writes).toBe(1);
 const repeat=await actualDetails().lookupLastfmTrack({artist,title});expect(repeat.reuse).toMatchObject({database:1,external:0});expect(f).toHaveBeenCalledTimes(3);
});
it('actual nested details propagates child storage and refresh failures without double provider counts',async()=>{
 const artist='TEST Nested Failures',title='Exact';state.failReads.add('similar');state.failWrites.add('similar');
 const f=vi.fn(async(input:any)=>new URL(String(input)).searchParams.get('method')==='track.getInfo'?new Response('{}',{status:503}):publicReply(artist,title)(input));vi.stubGlobal('fetch',f);
 const result=await actualDetails().lookupLastfmTrack({artist,title});
 expect(result.ok).toBe(true);expect(result.reuse).toMatchObject({external:3,database:0,readFailed:1,writeFailed:1,refreshFailed:1});expect(f).toHaveBeenCalledTimes(3);
});
it('overlapping actual generation/details coalesce exact similarity and keep distinct recording versions',async()=>{
 const artist='TEST Concurrent',title='Exact (Live)';let release:()=>void=()=>{};
 const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{
  const f=vi.fn(async(input:any)=>{if(new URL(String(input)).searchParams.get('method')==='track.getsimilar'){r();await gate;}return publicReply(artist,title)(input);});vi.stubGlobal('fetch',f);
 });
 const generation=similarEvidence('synthetic',artist,title,Date.now()+3000);
 await started;const details=actualDetails().lookupLastfmTrack({artist,title});
 // Let the compatible caller join before releasing the one active transport.
 await new Promise(r=>setTimeout(r,30));release();
 const [a,b]=await Promise.all([generation,details]);
 expect(b.ok).toBe(true);expect(a.at).toBe(b.compatible[0].at);
 expect(a.counts.external+b.reuse.external).toBe(3);
 expect([...state.rows.keys()].filter(k=>JSON.parse(k)[0]==='similar')).toHaveLength(1);
 const f=vi.fn(async(input:any)=>publicReply(artist,'Exact (Remix)')(input));
 const other=await similarEvidence('synthetic',artist,'Exact (Remix)',Date.now()+2000,f);
 expect(other.counts.external).toBe(1);expect(other.value.seed.title).toBe('Exact (Remix)');
});
