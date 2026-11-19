import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createEvidenceStorage, EvidenceReadError, READ_BATCH_CHARS } from '@/lib/songInformation/cache.server';
import { informationKey, type Entry } from '@/lib/songInformation/schema';
import { createEnrichCache } from '@/lib/enrichCache.server';
import { runEnrichment } from '@/lib/enrichPipeline.server';
import {createRequestEvidenceStorage} from '@/lib/songInformation/reuse';
const state = vi.hoisted(() => ({ client: null as any }));
vi.mock('@/integrations/supabase/client.server', () => ({ get supabaseAdmin() { return state.client; } }));
afterEach(() => vi.restoreAllMocks());
it.each([[403,'42501','readDenied'],[404,'PGRST205','readSchema'],[503,'','readOther']] as const)('SDK HTTP %s retains partial rows and fixed cause %s',async(status,code,cause)=>{
 const entries=[entry(0,true),entry(1,true)];for(const e of entries){const v=e.value as {seed:{artist:string;title:string}};v.seed.title+=' 東京ü'.repeat(16);e.key=informationKey('similar',v.seed.artist,v.seed.title,'30:exact');}const requests:string[][]=[];
 state.client=createClient('http://127.0.0.1:9','synthetic-only',{auth:{persistSession:false},global:{fetch:async input=>{
  const keys=parseIn(new URL(String(input)).searchParams.get('cache_key')??'');requests.push(keys);
  if(keys.includes(entries[1].key))return new Response(JSON.stringify({code,message:'PRIVATE artist query path secret'}),{status});
  return new Response(JSON.stringify([{cache_key:entries[0].key,kind:entries[0].kind,value:entries[0].value,fetched_at:new Date(entries[0].at).toISOString()}]));
 }}});
 const request=await createRequestEvidenceStorage(createEvidenceStorage(),entries.map(e=>e.key),Date.now()+9000);
 expect(await request.storage.read(entries.map(e=>e.key))).toEqual([entries[0]]);expect(request.counts).toMatchObject({readFailed:1,[cause]:1});expect(requests).toHaveLength(2);expect(JSON.stringify(request.counts)).not.toMatch(/PRIVATE|artist|query|secret|path/);
});
it('real SDK passes the request abort signal and late transport cannot enter request memo',async()=>{
 vi.useFakeTimers();try{
  let signal:AbortSignal|null|undefined,release:(r:Response)=>void=()=>{};
  state.client=createClient('http://127.0.0.1:9','synthetic-only',{auth:{persistSession:false},global:{fetch:async(_input,init)=>{signal=init?.signal;return new Promise<Response>(r=>{release=r;});}}});
  const e=entry(0),pending=createRequestEvidenceStorage(createEvidenceStorage(),[e.key],Date.now()+9000);
  await vi.advanceTimersByTimeAsync(2000);const request=await pending;expect(signal?.aborted).toBe(true);expect(request.counts.readDeadline).toBe(1);
  release(new Response(JSON.stringify([{cache_key:e.key,kind:e.kind,value:e.value,fetched_at:new Date(e.at).toISOString()}])));await vi.advanceTimersByTimeAsync(0);
  expect(await request.storage.read([e.key])).toEqual([]);
 }finally{vi.useRealTimers();}
});

// Decode PostgREST's quoted IN grammar at the HTTP boundary, NOT the builder's raw arguments.
function parseIn(raw: string): string[] {
  if (!raw.startsWith('in.(') || !raw.endsWith(')')) throw Error('invalid filter');
  const text = raw.slice(4, -1), values: string[] = []; let i = 0;
  while (i < text.length) {
    if (text[i++] !== '"') throw Error('unquoted key');
    let value = '', closed = false;
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') { if (i >= text.length) throw Error('bad escape'); value += text[i++]; }
      else if (c === '"') { closed = true; break; }
      else value += c;
    }
    if (!closed) throw Error('unclosed key'); values.push(value);
    if (i < text.length && text[i++] !== ',') throw Error('invalid separator');
  }
  return values;
}
const entry = (i: number, long = false): Entry => {
  const artist = `TEST "Quote", Slash\\ Act ${i}` + (long ? ' 歌手é'.repeat(28) : '');
  const title = `Exact (Live), \\ "${i}"` + (long ? ' 東京ü'.repeat(28) : '');
  return { key: informationKey('similar', artist, title, '30:exact'), kind: 'similar', value: { seed: { artist, title }, status: 'ok', similar: [] }, at: Date.now() - 60000 };
};
function transport(entries: Entry[], fail = -1) {
  const urls: URL[] = [], read: string[][] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); urls.push(url);
    if(url.pathname.endsWith('/song_metadata_cache'))return new Response('[]',{headers:{'content-type':'application/json'}});
    try {
      const keys = parseIn(url.searchParams.get('cache_key') ?? ''); read.push(keys);
      if (fail >= 0 && keys.includes(entries[fail].key)) return new Response('{"message":"synthetic failure"}', { status: 400 });
      const rows = entries.filter(e => keys.includes(e.key)).map(e => ({ cache_key: e.key, kind: e.kind, value: e.value, fetched_at: new Date(e.at).toISOString() }));
      return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
    } catch { return new Response('{"message":"malformed IN grammar"}', { status: 400 }); }
  });
  state.client = createClient('http://127.0.0.1:9', 'synthetic-only', { auth: { persistSession: false }, global: { fetch: fetcher } });
  return { urls, read, fetcher };
}
it('real installed SDK HTTP boundary reads stored JSON-array keys with quotes, slashes, commas and versions', async () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry(i)), io = transport(entries);
  expect(await createEvidenceStorage().read([...entries.map(e => e.key), entries[0].key])).toEqual(entries);
  expect(io.read.flat()).toEqual(entries.map(e => e.key));
});
it('long Unicode keys are complete and bounded by actual serialized query size', async () => {
  const entries = Array.from({ length: 200 }, (_, i) => entry(i, true)), io = transport(entries);
  expect(await createEvidenceStorage().read(entries.map(e => e.key))).toHaveLength(200);
  expect(new Set(io.read.flat())).toEqual(new Set(entries.map(e => e.key)));
  expect(io.urls.length).toBeGreaterThan(1);
  for (const u of io.urls) expect(u.search.length).toBeLessThanOrEqual(READ_BATCH_CHARS);
});
it('a failed HTTP batch retains all other exact rows and reports partial failure', async () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry(i, true)), io = transport(entries, 1);
  const error = await createEvidenceStorage().read(entries.map(e => e.key)).catch(e => e);
  expect(error).toBeInstanceOf(EvidenceReadError);
  const failedKeys=io.read.find(keys=>keys.includes(entries[1].key));expect(failedKeys).toBeDefined();
  expect(error.entries.map((e: Entry) => e.key)).toEqual(entries.filter(e => !failedKeys?.includes(e.key)).map(e => e.key));
});
it('actual enrichment adapter and pipeline read all 20 stored exact pairs through the installed SDK with zero providers',async()=>{
 const now=Date.now(),prov={energy:'provider',danceability:'provider',valence:'provider',popularity:'provider',bpm:'provider',year:'provider',genre:'provider'};
 const songs=Array.from({length:20},(_,i)=>({artist:`TEST Artist ${i} "Credit", \\ & Guest`,song:`Exact ${i} (Live)`}));
 const entries:Entry[]=songs.map(s=>({kind:'metadata',key:informationKey('metadata',s.artist,s.song),at:now,value:{...s,source:'ReccoBeats+MusicBrainz',energy:8,danceability:7,valence:6,popularity:8,bpm:120,year:2005,genre:'Pop',prov,checked:Object.fromEntries(Object.keys(prov).map(k=>[k,now])),updated:Object.fromEntries(Object.keys(prov).map(k=>[k,now]))}}));
 const io=transport(entries),provider=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{throw Error('no provider allowed');});
 const result=await runEnrichment(songs,{...createEnrichCache(),estimate:async()=>{throw Error('no estimate allowed');}});
 expect(result.results.every(r=>r.energy===8&&r.bpm===120)).toBe(true);expect(result.status.reuse).toMatchObject({database:20,external:0,readFailed:0});expect(provider).not.toHaveBeenCalled();expect(new Set(io.read.flat())).toEqual(new Set(entries.map(e=>e.key)));
});
it('malformed or noncanonical keys are rejected without database traffic',async()=>{
 const io=transport([]);
 for(const key of ['not json','["toString","a","b",""]','["similar","A","b","30:exact"]'])await expect(createEvidenceStorage().read([key])).rejects.toThrow('Invalid evidence key');
 expect(io.fetcher).not.toHaveBeenCalled();
});