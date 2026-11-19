import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createEvidenceStorage, EvidenceReadError, READ_BATCH_CHARS } from '@/lib/songInformation/cache.server';
import { informationKey, type Entry } from '@/lib/songInformation/schema';
import { createEnrichCache } from '@/lib/enrichCache.server';
import { runEnrichment } from '@/lib/enrichPipeline.server';
const state = vi.hoisted(() => ({ client: null as any }));
vi.mock('@/integrations/supabase/client.server', () => ({ get supabaseAdmin() { return state.client; } }));
afterEach(() => vi.restoreAllMocks());

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