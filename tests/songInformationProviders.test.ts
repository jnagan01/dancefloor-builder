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
