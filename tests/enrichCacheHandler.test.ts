import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { z } from 'zod';
import { runEnrichment, ENRICH_LIMITS, type CacheRow } from '@/lib/enrichPipeline.server';
import { createEnrichCache } from '@/lib/enrichCache.server';
import { encodeCacheSource } from '@/lib/prep/provenance';

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
  source: encodeCacheSource('ReccoBeats+MusicBrainz', { energy: 'provider', danceability: 'provider', bpm: 'provider', year: 'provider' }),
  fetched_at: new Date().toISOString() });
function database(initial: CacheRow[] = []) {
  let rows = initial;
  const io = { reads: 0, writes: 0, readError: false, writeError: false, hangRead: false, hangWrite: false,
    filters: [] as unknown[], rows: () => rows };
  state.from.mockReset().mockImplementation((table: string) => {
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
    expect(second.results).toEqual(first.results); expect(fetch).toHaveBeenCalledTimes(count);
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

  it('stale rows still refetch, and partial verified facts survive failed providers', async () => {
    database([{ ...warm(), fetched_at: new Date(Date.now() - 91 * 86400000).toISOString() }]);
    const fetch = providers(); await handler().call({ songs: [song] }); expect(fetch).toHaveBeenCalledTimes(3);
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
    const start = Date.now(); const pending = handler().call({ songs: [song] });
    await vi.advanceTimersByTimeAsync(phase === 'read' ? ENRICH_LIMITS.cacheReadMs + 10 : ENRICH_LIMITS.upsertMs + 10);
    const out = await pending;
    expect(Date.now() - start).toBeLessThan(ENRICH_LIMITS.totalMs);
    expect(out.results[0]).toMatchObject({ energy: 8, bpm: 122, year: 2004 });
    expect(out.status.timedOut).toEqual([phase === 'read' ? 'cacheRead' : 'upsert']);
    expect(io.reads).toBe(1); expect(io.writes).toBe(1);
  });
});