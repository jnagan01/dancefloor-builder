import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { ESTIMATE_MODEL, runEnrichment, type EnrichDeps } from '@/lib/enrichPipeline.server';
import { runEnrichment as baseline } from './fit/archived/enrichPipeline.376d12b';
import { decodeCacheSource } from '@/lib/prep/provenance';
import { estimateItems, gatewayStream, type GatewayRequest } from './helpers/gatewayStream';

/*
 * Real metadata pipeline + REAL AI SDK streaming (openai-compatible provider, gateway transport synthetic) under a
 * delayed-streaming fixture taken from live measurements on 2026-11-13 with the production estimate prompt (8 songs):
 *   openai/gpt-6-astra, reasoning low:      first delta 14,185 / 23,811 ms (236 / 397 reasoning tokens)
 *   google/gemini-3-flash-preview:          first delta 519–755 ms, complete 1.5–2.5 s (no reasoning tokens)
 * The faster astra measurement is used, so the baseline failure is not exaggerated. Provider misses: ReccoBeats
 * searches (two pages) ~0.9 s each and an empty MusicBrainz group ~1.2 s — the "(Clean)" edits find nothing there.
 */
const STARTUP: Record<string, number> = { 'openai/gpt-6-astra': 14185, 'google/gemini-3-flash-preview': 600 };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const stubborn = Array.from({ length: 8 }, (_, i) => ({ artist: `TEST Stubborn Artist ${i}`, song: `Night Song ${i} (Clean)` }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
// Load the real SDK modules before fake clocks run: module loading is real I/O, not model latency.
beforeAll(async () => { await import('ai'); await import('@ai-sdk/openai-compatible'); await import('@/lib/ai-gateway.server'); });

function network(o: { requests: GatewayRequest[]; reccoMs?: (title: string) => number; mb?: (url: URL) => Promise<Response>; recco?: (url: URL) => Promise<Response> | undefined }) {
  const gateway = gatewayStream({ startupMs: m => STARTUP[m] ?? 600, chunkMs: 60, requests: o.requests,
    content: req => estimateItems(req.prompt, () => ({ energy: 8, danceability: 7, valence: 7, bpm: 121, genre: 'Pop', year: 2006 })) });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.host === 'ai.gateway.lovable.dev') return gateway(init);
    if (u.host === 'musicbrainz.org') { if (o.mb) return o.mb(u); await sleep(1200); return json({ count: 0, recordings: [] }); }
    const custom = o.recco?.(u); if (custom) return custom;
    await sleep(o.reccoMs?.(u.searchParams.get('searchText') ?? '') ?? 900);
    return json({ content: [] });
  });
}
function storage(writes: any[] = []): EnrichDeps { return { readRows: async () => [], upsert: async rows => { writes.push(...rows); } }; }
async function settle<T>(p: Promise<T>, ms = 17000) { await vi.advanceTimersByTimeAsync(ms); return p; }

it('stubborn "(Clean)" edits: frozen 376d12b estimate times out (source none); repaired fast estimate returns AI-labelled gaps', async () => {
  vi.useFakeTimers(); vi.stubEnv('LOVABLE_API_KEY', 'synthetic-not-a-key');
  const oldReq: GatewayRequest[] = []; network({ requests: oldReq });
  const old = await settle(baseline(stubborn, storage()));
  expect(old.status.timedOut).toContain('ai');
  expect(old.results.every(r => r.source === 'none' && r.incomplete && r.energy === undefined)).toBe(true);
  expect(oldReq[0]).toMatchObject({ model: 'openai/gpt-6-astra', reasoning_effort: 'low', stream: true });

  const req: GatewayRequest[] = [], writes: any[] = []; network({ requests: req });
  const t0 = Date.now(); let doneAt = 0;
  const out = await settle(runEnrichment(stubborn, storage(writes)).finally(() => { doneAt = Date.now(); }));
  // Supported request contract: the zero-retention fast model, streamed, no reasoning/temperature options.
  expect(req.length).toBeGreaterThan(0); expect(req.length).toBeLessThanOrEqual(4); // early-gap groups, one lane
  for (const r of req) {
    expect(r).toMatchObject({ model: ESTIMATE_MODEL, stream: true, authorized: true });
    expect(r.reasoning_effort).toBeUndefined(); expect(r.temperature).toBeUndefined();
  }
  expect(out.status).toMatchObject({ complete: true, timedOut: [], unfinished: 0 });
  for (const r of out.results) {
    // Exact partial provenance: every fact is an AI estimate (nothing provider-verified was invented).
    expect(r).toMatchObject({ source: 'AI', energy: 8, danceability: 7, bpm: 121, year: 2006 });
    expect(r.prov).toEqual({ energy: 'ai', danceability: 'ai', valence: 'ai', bpm: 'ai', genre: 'ai', year: 'ai' });
    expect(r.incomplete).toBeUndefined();
  }
  // Warm cache next time: the AI-labelled rows are written back with their provenance.
  expect(writes).toHaveLength(8);
  for (const w of writes) expect(decodeCacheSource(w.source, w).prov).toMatchObject({ energy: 'ai', danceability: 'ai', year: 'ai' });
  console.info(`SYNTHETIC stubborn estimate: baseline AI timeout, 0/8 facts; repaired 8/8 AI-labelled in ${doneAt - t0} ms`);
  expect(doneAt - t0).toBeLessThan(6000);
}, 20000);

it('multiple serial estimate start-ups per chunk across three chunks: baseline retains 0/24, repaired retains 24/24', async () => {
  // Misses become known in three waves (0.9 s, 4.5 s, 8.0 s), so the single estimate lane pays several serial
  // model start-ups inside one 16 s request — the native "AI timeout batches ~14.8–15 s" shape.
  const wave = (title: string) => { const n = Number(/(\d+)/.exec(title)![1]) % 8; return n < 2 ? 450 : n < 5 ? 2250 : 4000; };
  const songsFor = (c: number) => stubborn.map((s, i) => ({ artist: `${s.artist} c${c}`, song: `Night Song ${i} (Clean)` }));
  const run = async (fn: typeof runEnrichment) => {
    const req: GatewayRequest[] = []; network({ requests: req, reccoMs: wave });
    let kept = 0, timeouts = 0;
    for (let c = 0; c < 3; c++) {
      const out = await settle(fn(songsFor(c), storage()));
      kept += out.results.filter(r => r.prov?.energy === 'ai' && r.prov?.danceability === 'ai').length;
      if (out.status.timedOut.includes('ai')) timeouts++;
    }
    return { kept, timeouts, calls: req.length };
  };
  vi.useFakeTimers(); vi.stubEnv('LOVABLE_API_KEY', 'synthetic-not-a-key');
  const before = await run(baseline), after = await run(runEnrichment);
  console.info(`SYNTHETIC serial start-ups: baseline ${before.kept}/24 kept, ${before.timeouts}/3 AI timeouts, ${before.calls} model calls; repaired ${after.kept}/24, ${after.timeouts}/3, ${after.calls} calls`);
  expect(before.kept).toBe(0); expect(before.timeouts).toBe(3);
  expect(after.kept).toBe(24); expect(after.timeouts).toBe(0);
  expect(after.calls).toBeGreaterThan(3); // several serial start-ups per chunk still fit
}, 30000);

it('provider status diagnostics: catalogue miss is not a failure; rate, server, malformed and network causes are counted without payloads', async () => {
  vi.useFakeTimers(); vi.stubEnv('LOVABLE_API_KEY', 'synthetic-not-a-key');
  const songs = ['Miss', 'Rate', 'Server', 'Malformed', 'Network'].map(k => ({ artist: `TEST Cause ${k}`, song: `Cause ${k}` }));
  const req: GatewayRequest[] = [];
  network({ requests: req, mb: async () => { await sleep(300); return json({ count: 5, recordings: songs.map(s => ({ title: s.song, 'artist-credit': [{ name: s.artist }], 'first-release-date': '2004-05-01' })) }); },
    recco: u => {
      const title = u.searchParams.get('searchText') ?? decodeURIComponent(u.pathname.split('/').at(-2) ?? '');
      const hit = (id: string) => json({ content: [{ id, trackTitle: `Cause ${id}`, artists: [{ name: `TEST Cause ${id}` }], popularity: 70 }] });
      if (u.pathname.endsWith('/search')) {
        if (title === 'Cause Rate') return Promise.resolve(json({}, 429, { 'retry-after': '2' }));
        if (title === 'Cause Server') return Promise.resolve(json({}, 503));
        if (title === 'Cause Network') return Promise.reject(new TypeError('fetch failed'));
        return Promise.resolve(hit(title.replace('Cause ', '')));
      }
      if (title === 'Miss') return Promise.resolve(json({ status: 4041 }, 404));
      if (title === 'Malformed') return Promise.resolve(new Response('{"energy": 0.8,', { status: 200 }));
      return undefined;
    } });
  const out = await settle(runEnrichment(songs, storage()));
  const by = Object.fromEntries(out.results.map(r => [r.artist.replace('TEST Cause ', ''), r]));
  // ReccoBeats has the track but no audio features (404): popularity and MusicBrainz year are kept, NOT unfinished.
  expect(by.Miss).toMatchObject({ popularity: 7, year: 2004 }); expect(by.Miss.incomplete).toBeUndefined();
  for (const k of ['Rate', 'Server', 'Malformed', 'Network']) expect(by[k].incomplete).toBe(true);
  expect(by.Malformed.popularity).toBe(7); // the search succeeded before the malformed feature body
  expect(out.status.causes?.reccobeats).toMatchObject({ missing: 1, rate: 1, server: 1, malformed: 1, network: 1 });
  expect(out.status.failed).toContain('fetch'); expect(out.status.unfinished).toBe(4);
  const wire = JSON.stringify(out.status);
  for (const s of songs) { expect(wire).not.toContain(s.song); expect(wire).not.toContain(s.artist); }
  expect(wire).not.toMatch(/https?:|synthetic-not-a-key/);
}, 20000);

it('crowded MusicBrainz group: truncated songs get one paced single-song search instead of being reported unfinished', async () => {
  vi.useFakeTimers(); vi.stubEnv('LOVABLE_API_KEY', 'synthetic-not-a-key');
  const songs = [{ artist: 'TEST Popular', song: 'Everywhere Song' }, { artist: 'TEST Quiet', song: 'Rare Song (Clean)' }];
  const run = async (fn: typeof runEnrichment) => {
    const mbQueries: string[] = [];
    network({ requests: [], mb: async u => {
      const q = u.searchParams.get('query') ?? ''; mbQueries.push(u.searchParams.get('limit') ?? '');
      await sleep(400);
      // Live shape (2026-11-13, 4-song group): count 185, the 100 returned recordings were dominated by two songs.
      if (q.includes('TEST Popular')) return json({ count: 185, recordings: Array.from({ length: 100 }, () => ({ title: 'Everywhere Song', 'artist-credit': [{ name: 'TEST Popular' }], 'first-release-date': '2003-01-01' })) });
      return json({ count: 3, recordings: [{ title: 'Rare Song', 'artist-credit': [{ name: 'TEST Quiet' }], 'first-release-date': '2005-06-01' }] });
    } });
    return { out: await settle(fn(songs, storage())), mbQueries };
  };
  const before = await run(baseline);
  expect(before.out.results[1].incomplete).toBe(true); expect(before.out.status.failed).toContain('fetch');
  const after = await run(runEnrichment);
  expect(after.mbQueries).toEqual(['100', '25']);
  // The clean edit is matched to its base recording only as an ESTIMATE (a different version is never verified).
  expect(after.out.results[1]).toMatchObject({ year: 2005 }); expect(after.out.results[1].prov?.year).toBe('estimate');
  expect(after.out.results[1].incomplete).toBeUndefined();
  expect(after.out.results[0]).toMatchObject({ year: 2003 }); expect(after.out.results[0].prov?.year).toBe('provider');
  expect(after.out.status.causes?.musicbrainz?.truncated).toBeUndefined();
}, 20000);

it('MusicBrainz rate pressure: no follow-up replays while the shared lane is cooling down; truncation is reported', async () => {
  vi.useFakeTimers(); vi.stubEnv('LOVABLE_API_KEY', 'synthetic-not-a-key');
  const songs = [{ artist: 'TEST Popular', song: 'Everywhere Song' }, { artist: 'TEST Quiet', song: 'Rare Song' }];
  let mbCalls = 0;
  // The grouped search itself meets a 503 with a 120 s cooldown: the paused lane never sends single-song follow-ups.
  network({ requests: [], mb: async () => { mbCalls++; await sleep(300); return json({}, 503, { 'retry-after': '120' }); } });
  const out = await settle(runEnrichment(songs, storage()));
  expect(mbCalls).toBe(1); // the group only; no single-song replay under the 120 s cooldown
  expect(out.status.causes?.musicbrainz).toMatchObject({ server: 1 });
  expect(out.results.every(r => r.incomplete)).toBe(true);
  expect(out.status.retryAfterMs).toBeGreaterThan(0);
}, 20000);

it('full outage (providers and model hang): bounded by the 16 s request end, honest incomplete status, no negative cache writes', async () => {
  vi.useFakeTimers(); vi.stubEnv('LOVABLE_API_KEY', 'synthetic-not-a-key');
  vi.stubGlobal('fetch', (_u: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  const writes: any[] = []; const t0 = Date.now(); let doneAt = 0;
  const out = await settle(runEnrichment(stubborn, storage(writes)).finally(() => { doneAt = Date.now(); }));
  expect(doneAt - t0).toBeLessThanOrEqual(16000);
  expect(out.status.complete).toBe(false); expect(out.status.unfinished).toBe(8);
  expect(out.status.timedOut).toEqual(expect.arrayContaining(['fetch', 'ai']));
  expect(out.status.causes?.ai).toMatchObject({ deadline: 1 });
  expect(out.results.every(r => r.source === 'none' && r.incomplete && r.energy === undefined)).toBe(true);
  expect(writes).toEqual([]);
}, 20000);

it('trickling and late misses: frozen 376d12b scheduling chains three serial start-ups and loses the last rows; repair needs two', async () => {
  // Live 2026-11-13 shape: ReccoBeats searches 1–5 s each (two pages per miss); estimate calls up to 4.1 s to headers.
  // The same 4.1 s start-up is applied to EVERY model so only scheduling differs between the two runs.
  const songs = Array.from({ length: 8 }, (_, i) => ({ artist: `TEST Late ${i}`, song: `Late Song ${i} (Clean)` }));
  const pageMs = (title: string) => { const n = Number(/(\d+)/.exec(title)![1]); return n < 4 ? 1500 : n < 7 ? 1000 : 4000; };
  const run = async (fn: typeof runEnrichment) => {
    const req: GatewayRequest[] = [];
    const gateway = gatewayStream({ startupMs: () => 4100, chunkMs: 60, requests: req,
      content: r => estimateItems(r.prompt, () => ({ energy: 8, danceability: 7 })) });
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      if (u.host === 'ai.gateway.lovable.dev') return gateway(init);
      if (u.host === 'musicbrainz.org') { await sleep(800); return json({ count: 0, recordings: [] }); }
      await sleep(pageMs(u.searchParams.get('searchText') ?? '0'));
      return json({ content: [] });
    });
    const out = await settle(fn(songs, storage()));
    return { out, calls: req.length };
  };
  vi.useFakeTimers(); vi.stubEnv('LOVABLE_API_KEY', 'synthetic-not-a-key');
  const before = await run(baseline), after = await run(runEnrichment);
  const kept = (o: typeof before) => o.out.results.filter(r => r.prov?.energy === 'ai').length;
  console.info(`SYNTHETIC trickling misses (4.1 s start-up): baseline ${kept(before)}/8 estimated, ${before.calls} serial calls, ai timeout=${before.out.status.timedOut.includes('ai')}; repaired ${kept(after)}/8, ${after.calls} calls`);
  expect(before.calls).toBeGreaterThanOrEqual(3); expect(kept(before)).toBeLessThan(8); expect(before.out.status.timedOut).toContain('ai');
  expect(after.calls).toBeLessThanOrEqual(2); expect(kept(after)).toBe(8); expect(after.out.status.timedOut).not.toContain('ai');
  // Every row estimated at most once; estimates only fill gaps (no provider facts existed here).
  expect(after.out.results.every(r => r.prov?.energy === 'ai' && r.prov?.danceability === 'ai')).toBe(true);
}, 20000);

it('speculative estimate never outranks provider evidence that arrives later', async () => {
  vi.useFakeTimers(); vi.stubEnv('LOVABLE_API_KEY', 'synthetic-not-a-key');
  const songs = [{ artist: 'TEST Fast', song: 'Fast Miss' }, { artist: 'TEST Slow Hit', song: 'Slow Hit' }, { artist: 'TEST Slow Miss', song: 'Slow Miss' }];
  const req: GatewayRequest[] = [];
  const gateway = gatewayStream({ startupMs: () => 600, chunkMs: 60, requests: req, content: r => estimateItems(r.prompt, () => ({ energy: 3, danceability: 3, bpm: 99 })) });
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.host === 'ai.gateway.lovable.dev') return gateway(init);
    if (u.host === 'musicbrainz.org') { await sleep(500); return json({ count: 0, recordings: [] }); }
    if (u.pathname.endsWith('/audio-features')) { await sleep(300); return json({ energy: 0.9, danceability: 0.8, tempo: 124 }); }
    const title = u.searchParams.get('searchText') ?? '';
    if (title === 'Fast Miss') { await sleep(200); return json({ content: [] }); }
    await sleep(3000);
    return json({ content: title === 'Slow Hit' ? [{ id: 'hit', trackTitle: 'Slow Hit', artists: [{ name: 'TEST Slow Hit' }], popularity: 80 }] : [] });
  });
  const out = await settle(runEnrichment(songs, storage()));
  const hit = out.results[1];
  // The second group speculatively estimated the pending rows, but the exact provider facts win per attribute.
  expect(req.length).toBeLessThanOrEqual(2);
  expect(hit).toMatchObject({ energy: 9, danceability: 8, bpm: 124 }); expect(hit.prov).toMatchObject({ energy: 'provider', danceability: 'provider', bpm: 'provider' });
  expect(out.results[2].prov).toMatchObject({ energy: 'ai', danceability: 'ai' });
}, 20000);
