import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { z } from 'zod';
import { runEnrichment, ENRICH_LIMITS, type CacheRow } from '@/lib/enrichPipeline.server';
import { createEnrichCache } from '@/lib/enrichCache.server';
import { encodeCacheSource } from '@/lib/prep/provenance';
import { evidenceFilterKeys } from './helpers/postgrestEvidence';

// Actual RPC handler + actual auth middleware + actual service adapter + actual pipeline.
// Only framework dispatch, claims transport, DB transport and public providers are synthetic.
const state = vi.hoisted(() => ({ from: vi.fn(), ai: vi.fn() }));
vi.mock('@/integrations/supabase/client.server', () => ({ supabaseAdmin: state }));
vi.mock('ai', () => ({ streamText: state.ai }));
vi.mock('@/lib/ai-gateway.server', () => ({ createLovableAiGatewayProvider: () => () => 'synthetic-model' }));
const require = createRequire(import.meta.url);
const ts = require('typescript');
const song = { artist: 'TEST ONLY Artist', song: 'Synthetic Recording' };
const warm = (): CacheRow => ({ artist_key: 'test only artist', song_key: 'synthetic recording', energy: 8,
  danceability: 7, valence: 6, popularity: 8, bpm: 122, camelot: null, genre: 'Pop', year: 2004,
  source: encodeCacheSource('ReccoBeats+MusicBrainz', { energy: 'provider', danceability: 'provider', valence:'provider',popularity:'provider',camelot:'provider',genre:'provider', bpm: 'provider', year: 'provider' }),
  fetched_at: new Date().toISOString() });
function database(initial: CacheRow[] = []) {
  let rows = initial;const evidence=new Map<string,any>();
  const io = { reads: 0, writes: 0, readError: false, writeError: false, hangRead: false, hangWrite: false,
    filters: [] as unknown[], rows: () => rows };
  state.from.mockReset().mockImplementation((table: string) => {
    if (table === 'track_evidence_cache') return {
      select: () => ({ filter: async (_:string,_op:string,raw:string) => ({data:evidenceFilterKeys(raw).flatMap(k=>evidence.has(k)?[evidence.get(k)]:[]),error:null}) }),
      upsert: async (row:any) => {io.writes++;if(io.hangWrite)return new Promise(()=>{});if(io.writeError)return {error:{}};evidence.set(row.cache_key,row);return {error:null};},
    };
    expect(table).toBe('song_metadata_cache');
    return {
      select: () => ({ in: (column: string, keys: string[]) => {
        io.filters.push([column, keys]);
        return { in: async (second: string, secondKeys: string[]) => {
          io.filters.push([second, secondKeys]); io.reads++;
          if (io.hangRead) return new Promise(() => {});
          // Include cross-pair/unrequested rows to exercise the pipeline's requested-key assembly.
          return { data: rows, error: io.readError ? { message: 'PRIVATE PAYLOAD artist query token' } : null };
        } };
      } }),
      upsert: async (next: CacheRow[], options: unknown) => {
        expect(options).toEqual({ onConflict: 'artist_key,song_key' }); io.writes++;
        if (io.hangWrite) return new Promise(() => {});
        if (io.writeError) return { error: { message: 'PRIVATE WRITE token' } };
        rows = next; return { error: null };
      },
    };
  });
  return io;
}
function handler(auth: 'valid' | 'absent' | 'invalid' = 'valid') {
  const userQuery = vi.fn(() => { throw new Error('authenticated SELECT denied'); });
  const claims = vi.fn(async () => auth === 'invalid' ? { error: {}, data: null } : { data: { claims: { sub: 'synthetic-owner' } }, error: null });
  function load(file: string, imports: Record<string, unknown>) {
    const m = { exports: {} };
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module: m, exports: m.exports, console,
      process: { env: { SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_PUBLISHABLE_KEY: 'synthetic-not-a-key' } },
      require: (name: string) => { if (!(name in imports)) throw new Error(`Unexpected import: ${name}`); return imports[name]; } });
    return m.exports as any;
  }
  const middleware = load('src/integrations/supabase/auth-middleware.ts', {
    '@tanstack/react-start': { createMiddleware: () => ({ server: (fn: unknown) => fn }) },
    '@tanstack/react-start/server': { getRequest: () => ({ headers: new Headers(auth === 'absent' ? {} : { authorization: 'Bearer synthetic-test-token' }) }) },
    '@supabase/supabase-js': { createClient: () => ({ from: userQuery, auth: { getClaims: claims } }) },
  });
  const module = load('src/lib/enrich.functions.ts', {
    '@tanstack/react-start': { createServerFn: () => {
      let chain: any[] = [], validate: (data: unknown) => unknown;
      const builder = {
        middleware: (next: any[]) => { chain = next; return builder; },
        inputValidator: (fn: typeof validate) => { validate = fn; return builder; },
        handler: (fn: any) => async (input: unknown) => {
          // Dispatch the actual authentication middleware before any privileged handler work.
          const invoke = (index: number, context: unknown): any => index === chain.length
            ? fn({ data: validate(input), context }) : chain[index]({ next: ({ context: next }: any) => invoke(index + 1, next) });
          return invoke(0, {});
        },
      }; return builder;
    } },
    zod: { z }, '@/integrations/supabase/auth-middleware': middleware,
    './enrichPipeline.server': { runEnrichment }, './enrichCache.server': { createEnrichCache },
  });
  return { call: module.enrichSongs as (data: unknown) => ReturnType<typeof runEnrichment>, userQuery, claims };
}
function providers() {
  const fetch = vi.fn(async (url: string) => {
    const u = new URL(url);
    const body = u.host === 'musicbrainz.org'
      ? { recordings: [{ title: song.song, 'artist-credit': [{ name: song.artist }], 'first-release-date': '2004-01-01', tags: [{ name: 'Pop' }] }] }
      : u.pathname.endsWith('/search')
        ? { content: [{ id: 'synthetic', trackTitle: song.song, artists: [{ name: song.artist }], popularity: 80 }] }
        : { energy: 0.8, danceability: 0.7, valence: 0.6, tempo: 122 };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
beforeEach(() => {
  // The actual pipeline's AI branch is fenced too: never use sandbox credentials or a real gateway.
  vi.stubEnv('LOVABLE_API_KEY', 'synthetic-not-a-key');
  state.ai.mockReset().mockReturnValue({ text: Promise.resolve('{"items":[]}') });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('authenticated handler service-only metadata cache', () => {
  // Policy: complete cached rows whose energy/danceability are generic heuristics stay warm cache hits (no provider
  // re-fetch, which would re-spend lookup time on every run); recording-aware AI may upgrade them opportunistically.
  // A provider re-fetch that is already warranted (missing popularity under a familiarity choice) still upgrades them.
  it.each(['provider', 'ai', 'warm', 'outage'] as const)('cached heuristics: bounded %s path through authenticated adapter and real pipeline', async mode => {
    vi.useFakeTimers();
    const heuristic = { ...warm(), energy: 6, danceability: 7, ...(mode === 'provider' ? { popularity: null } : {}), source: encodeCacheSource('ReccoBeats+AI', { energy: 'estimate', danceability: 'estimate', bpm: 'provider', year: 'provider' }) };
    const io = database([heuristic]);
    const fetch = providers();
    if (mode === 'outage') state.ai.mockImplementation(() => { throw new Error('synthetic AI outage'); });
    else state.ai.mockReturnValue({ textStream: (async function* () { yield mode === 'ai' ? '{"items":[{"i":0,"energy":2,"danceability":3}]}' : '{"items":[]}'; })() });
    const pending = handler().call({ songs: [song], needPopularity: mode === 'provider' }); await vi.advanceTimersByTimeAsync(16000); const out = await pending;
    expect(out.results[0]).toMatchObject({ bpm: 122, year: 2004, prov: { bpm: 'provider', year: 'provider' } });
    if (mode === 'provider') { expect(fetch).toHaveBeenCalled(); expect(out.results[0]).toMatchObject({ energy: 8, danceability: 7, popularity: 8, prov: { energy: 'provider', danceability: 'provider' } }); expect(io.writes).toBe(1); return; }
    // Warm heuristic rows never trigger a provider re-fetch.
    expect(fetch).not.toHaveBeenCalled();
    if (mode === 'ai') { expect(out.results[0]).toMatchObject({ energy: 2, danceability: 3, prov: { energy: 'ai', danceability: 'ai' } }); expect(io.writes).toBe(1); }
    else {
      // No usable estimate (empty or unavailable AI): cached heuristics stay labelled heuristic, nothing is written or
      // invented, and nothing is reported missing; the automatic dance gate still withholds them.
      expect(out.results[0]).toMatchObject({ energy: 6, danceability: 7, prov: { energy: 'estimate', danceability: 'estimate' } });
      expect(out.results[0].incomplete).toBeUndefined(); expect(io.writes).toBe(0);
      if (mode === 'outage') expect(out.status.causes?.ai).toMatchObject({ unavailable: 1 });
    }
  });
  it('warm complete cache returns known facts without provider/AI calls or user SELECT', async () => {
    const io = database([warm(), { ...warm(), artist_key: 'unrequested', energy: 1 }]);
    const fetch = providers(); const h = handler();
    const out = await h.call({ songs: [song], needPopularity: true });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ energy: 8, bpm: 122, year: 2004, prov: { energy: 'provider', year: 'provider' } });
    expect(out.status.complete).toBe(true); expect(fetch).not.toHaveBeenCalled();
    expect(state.ai).not.toHaveBeenCalled();
    expect(h.userQuery).not.toHaveBeenCalled(); expect(io.writes).toBe(0);
    expect(io.filters).toEqual([['artist_key', ['test only artist']], ['song_key', ['synthetic recording']]]);
  });

  it('cold provider result is saved and reused on the second actual handler call', async () => {
    const io = database(); const fetch = providers(); const h = handler();
    const first = await h.call({ songs: [song] }); const count = fetch.mock.calls.length;
    expect(count).toBe(3); expect(io.writes).toBe(1);
    const second = await h.call({ songs: [song] });
    expect(second.results[0]).toMatchObject({energy:8,bpm:122,year:2004}); expect(fetch).toHaveBeenCalledTimes(count);
    expect(state.ai).not.toHaveBeenCalled();
    expect(io.reads).toBe(2); expect(io.writes).toBe(1); expect(h.userQuery).not.toHaveBeenCalled();
  });

  it('actual authenticated handler retains cached provenance and reports stalled-body timeout without negative writes', async () => {
    vi.useFakeTimers();
    const io = database([{ ...warm(), energy: null, danceability: null }]);
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start() {} })));
    state.ai.mockReturnValue({ textStream: (async function* () { yield '{"items":[]}'; })() });
    const h = handler(); const pending = h.call({ songs: [song] });
    await vi.advanceTimersByTimeAsync(16000); const out = await pending;
    expect(out.status.timedOut).toContain('fetch'); expect(out.status.complete).toBe(false);
    expect(out.results[0]).toMatchObject({ year: 2004, bpm: 122, incomplete: true, prov: { year: 'provider', bpm: 'provider' } });
    expect(io.writes).toBe(0); expect(h.userQuery).not.toHaveBeenCalled();
  });

  it.each(['absent', 'invalid'] as const)('rejects %s auth before privileged cache work', async auth => {
    database([warm()]); const fetch = providers();
    await expect(handler(auth).call({ songs: [song] })).rejects.toThrow(/Unauthorized/);
    expect(state.from).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it('validates 200 rows and 300-character fields before privileged work', async () => {
    database([warm()]); const h = handler();
    await expect(h.call({ songs: Array.from({ length: 201 }, () => song) })).rejects.toThrow();
    await expect(h.call({ songs: [{ ...song, artist: 'a'.repeat(301) }] })).rejects.toThrow();
    await expect(h.call({ songs: [{ ...song, song: 's'.repeat(301) }] })).rejects.toThrow();
    expect(state.from).not.toHaveBeenCalled();
    expect((await h.call({ songs: Array.from({ length: 200 }, () => song) })).results).toHaveLength(200);
  });

  it('91-day stable verified facts remain reusable, and partial verified facts survive failed providers', async () => {
    database([{ ...warm(), fetched_at: new Date(Date.now() - 91 * 86400000).toISOString() }]);
    const fetch = providers(); const reused = await handler().call({ songs: [song] }); expect(fetch).not.toHaveBeenCalled();
    expect(reused.results[0]).toMatchObject({ energy: 8, bpm: 122, year: 2004 });
    database([{ ...warm(), energy: null, danceability: null }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    // AI attempts are synthetic and supply no invented facts.
    const out = await handler().call({ songs: [song] });
    expect(out.results[0]).toMatchObject({ bpm: 122, year: 2004, prov: { bpm: 'provider', year: 'provider' } });
  });

  it('read errors are diagnosed safely, retain returned known facts, and fall back on real misses', async () => {
    const io = database([warm()]); io.readError = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); const fetch = providers();
    const out = await handler().call({ songs: [song] });
    expect(out.results[0]).toMatchObject({ energy: 8, bpm: 122, year: 2004 });
    expect(out.status).toMatchObject({ complete: false, failed: ['cacheRead'] }); expect(fetch).not.toHaveBeenCalled();
    database().readError = true;
    const fallback = await handler().call({ songs: [song] });
    expect(fallback.results[0]).toMatchObject({ energy: 8, bpm: 122, year: 2004 }); expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/PRIVATE|Artist|Recording|token/);
  });

  it('returned write errors retain fresh facts and report storage failure, not a cache miss', async () => {
    database().writeError = true; providers(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await handler().call({ songs: [song] });
    expect(out.results[0]).toMatchObject({ energy: 8, bpm: 122, year: 2004 });
    expect(out.status).toMatchObject({ complete: false, failed: ['upsert'] });
    expect(warn.mock.calls).toEqual([['[enrichSongs] metadata cache upsert failed; bounded fallback retained']]);
  });

  it.each(['read', 'write'] as const)('hung cache %s is bounded at the existing phase deadline', async phase => {
    vi.useFakeTimers(); const io = database(); io.hangRead = phase === 'read'; io.hangWrite = phase === 'write';
    providers(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    const start = Date.now(); let settled = false; const pending = handler().call({ songs: [song] }).finally(() => { settled = true; });
    // Drive to settlement inside the original hard end; healthy dispatch spacing precedes the bounded cache phase.
    for (let ms = 0; !settled && ms < ENRICH_LIMITS.totalMs; ms += 50) await vi.advanceTimersByTimeAsync(50);
    const out = await pending;
    expect(Date.now() - start).toBeLessThan(ENRICH_LIMITS.totalMs);
    expect(out.results[0]).toMatchObject({ energy: 8, bpm: 122, year: 2004 });
    expect(out.status.timedOut).toEqual([phase === 'read' ? 'cacheRead' : 'upsert']);
    expect(io.reads).toBe(1); expect(io.writes).toBe(1);
  });
});
it('actual pipeline rejects stripped legacy identity for credited live and remix requests',async()=>{
 const fetch=vi.fn(async()=>new Response('{}',{status:503}));vi.stubGlobal('fetch',fetch);
 const out=await runEnrichment([{artist:'TEST ONLY Artist & Guest',song:'Synthetic Recording (Live)'},{artist:song.artist,song:'Synthetic Recording (Remix)'}],{readRows:async()=>[warm()],upsert:async()=>{},estimate:async()=>[]});
 expect(fetch).toHaveBeenCalled();expect(out.results.every(r=>r.energy!==8 && r.bpm!==122 && r.year!==2004)).toBe(true);
});
it.each([['AI',40],['ReccoBeats',400]] as const)('actual pipeline refreshes aged %s fields at %i days',async(source,days)=>{
 const fetch=providers();const row={...warm(),source:encodeCacheSource(source,{energy:source==='AI'?'ai':'provider',danceability:source==='AI'?'ai':'provider'}),fetched_at:new Date(Date.now()-days*86400000).toISOString()};
 await runEnrichment([song],{readRows:async()=>[row],upsert:async()=>{},estimate:async()=>[]});expect(fetch).toHaveBeenCalled();
});

it('unchanged successful popularity check persists freshness without changing its provenance date',async()=>{
 const row={...warm(),fetched_at:new Date(Date.now()-8*86400000).toISOString()};database([row]);const f=providers(),h=handler();
 const first=await h.call({songs:[song],needPopularity:true});const checks=f.mock.calls.length;
 expect(checks).toBe(1);expect(first.status.reuse?.writeFailed??0).toBe(0);expect(first.results[0].updated?.popularity).toBe(Date.parse(row.fetched_at));
 expect(first.results[0].checked?.popularity).toBeGreaterThan(Date.parse(row.fetched_at));
 const second=await h.call({songs:[song],needPopularity:true});expect(f).toHaveBeenCalledTimes(checks);expect(second.results[0].popularity).toBe(8);
});

// Advisory refresh and definitive-miss cooldown through the actual service adapter and pipeline.
const DAYMS = 86400000;
const aiRow = (days: number): CacheRow => ({ ...warm(), energy: 8, danceability: 8, valence: 8, popularity: null, bpm: 120, camelot: null, genre: 'Pop', year: 2005,
  source: encodeCacheSource('AI', { energy: 'ai', danceability: 'ai', valence: 'ai', bpm: 'ai', genre: 'ai', year: 'ai' }), fetched_at: new Date(Date.now() - days * DAYMS).toISOString() });
function evidence(seed: CacheRow) {
  // Seed the exact evidence store through the actual adapter write path so the next read is the real exact identity.
  const io = database([]);
  return { io, ready: createEnrichCache().upsert([{ ...seed, fetched_at: seed.fetched_at! }]).then(() => { io.writes = 0; }) };
}
describe('advisory refresh and definitive-miss cooldown', () => {
  it('40-day AI row with definitive 404s and an estimate returning the same values refreshes once, then repeats zero', async () => {
    const seeded = aiRow(40), { io, ready } = evidence(seeded); await ready;
    const fetch = vi.fn(async () => new Response('{}', { status: 404 })); vi.stubGlobal('fetch', fetch);
    const estimate = vi.fn(async (songs: unknown[]) => songs.map(() => ({ energy: 8, danceability: 8, valence: 8, bpm: 120, genre: 'Pop', year: 2005 })));
    const deps = () => ({ ...createEnrichCache(), estimate });
    const first = await runEnrichment([song], deps());
    expect(fetch).toHaveBeenCalledTimes(3); expect(estimate).toHaveBeenCalledTimes(1); expect(io.writes).toBe(1);
    const r = first.results[0], old = Date.parse(seeded.fetched_at!);
    expect(r).toMatchObject({ energy: 8, danceability: 8, valence: 8, bpm: 120, genre: 'Pop', year: 2005, prov: { energy: 'ai', year: 'ai' } });
    // Same values: the value-change date is unchanged; only the successful check date advances.
    expect(r.updated?.energy).toBe(old); expect(r.checked?.energy).toBeGreaterThan(old);
    expect(first.status.reuse).toMatchObject({ external: 4, writeFailed: 0 });
    const second = await runEnrichment([song], deps());
    expect(fetch).toHaveBeenCalledTimes(3); expect(estimate).toHaveBeenCalledTimes(1); expect(io.writes).toBe(1);
    expect(second.results[0]).toMatchObject({ energy: 8, year: 2005, prov: { energy: 'ai' } }); expect(second.status.reuse).toMatchObject({ external: 0, database: 1 });
  });
  it('unavailable estimate: definitive miss cools providers down without renewing stale values; estimates retry', async () => {
    const seeded = aiRow(40), { io, ready } = evidence(seeded); await ready;
    const fetch = vi.fn(async () => new Response('{}', { status: 404 })); vi.stubGlobal('fetch', fetch);
    const estimate = vi.fn(async () => { throw new Error('synthetic estimate outage'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = await runEnrichment([song], { ...createEnrichCache(), estimate });
    expect(fetch).toHaveBeenCalledTimes(3); expect(estimate).toHaveBeenCalledTimes(1); expect(io.writes).toBe(1);
    const old = Date.parse(seeded.fetched_at!);
    expect(first.results[0]).toMatchObject({ energy: 8, year: 2005, prov: { energy: 'ai', year: 'ai' } });
    expect(first.results[0].checked?.energy).toBe(old); expect(first.results[0].updated?.energy).toBe(old);
    expect(first.results[0].missed?.energy).toBeGreaterThan(old);
    const second = await runEnrichment([song], { ...createEnrichCache(), estimate });
    // Providers are not re-asked inside the cooldown; the transient estimate failure is not negative-cached.
    expect(fetch).toHaveBeenCalledTimes(3); expect(estimate).toHaveBeenCalledTimes(2); expect(io.writes).toBe(1);
    expect(second.results[0]).toMatchObject({ energy: 8, year: 2005, prov: { energy: 'ai' } });
    expect(second.results[0].checked?.energy).toBe(old);
  });
  it('transient 503 is never a definitive miss: no cooldown is written and the next run asks again', async () => {
    const seeded = aiRow(40), { io, ready } = evidence(seeded); await ready;
    const fetch = vi.fn(async () => new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const estimate = vi.fn(async () => { throw new Error('synthetic estimate outage'); });
    const first = await runEnrichment([song], { ...createEnrichCache(), estimate });
    const calls = fetch.mock.calls.length; expect(calls).toBeGreaterThan(0);
    expect(first.results[0].missed).toBeUndefined(); expect(io.writes).toBe(0);
    await runEnrichment([song], { ...createEnrichCache(), estimate });
    expect(fetch.mock.calls.length).toBe(calls * 2);
  });
  it('fresh acoustic/popularity with stale provider year/BPM refreshes; failure retains strong fields and source dates', async () => {
    const at = Date.now(), old = at - 400 * DAYMS;
    const row: CacheRow = { ...warm(), fetched_at: new Date(at).toISOString(), checked: { energy: at, danceability: at, popularity: at, valence: at, camelot: at, genre: at, year: old, bpm: old }, updated: { energy: at - DAYMS, danceability: at - DAYMS, popularity: at - DAYMS, valence: at, genre: at, year: old - DAYMS, bpm: old - DAYMS } };
    const { io, ready } = evidence(row); await ready;
    const fetch = vi.fn(async () => new Response('{}', { status: 503 })); vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await runEnrichment([song], { ...createEnrichCache(), estimate: async () => [] }, { needPopularity: true });
    expect(fetch).toHaveBeenCalled(); expect(io.writes).toBe(0);
    expect(out.results[0]).toMatchObject({ energy: 8, danceability: 7, popularity: 8, bpm: 122, year: 2004, prov: { energy: 'provider', year: 'provider', bpm: 'provider' } });
    expect(out.results[0].updated).toMatchObject({ year: old - DAYMS, bpm: old - DAYMS, energy: at - DAYMS });
    expect(out.results[0].checked).toMatchObject({ year: old, bpm: old }); expect(out.results[0].missed).toBeUndefined();
  });
});
