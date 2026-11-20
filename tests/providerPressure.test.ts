import { afterEach, expect, it, vi } from 'vitest';
import { createProviderLane, retryAfterMs } from '@/lib/enrichScheduling.server';
import { capturePacing, remainingPacing, PROVIDER_INTERVAL_MS } from '@/lib/providerPacing';
import { runEnrichment, type CacheRow } from '@/lib/enrichPipeline.server';
import { enrichHandler } from './helpers/enrichHandler';
const json = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
const deps = { readRows: async () => [], upsert: vi.fn(async () => {}), estimate: async () => [] };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it.each([429,503])('%s zero/past hints retain exponential floor and old in-flight successes cannot erase pressure',async status=>{
 vi.useFakeTimers();const origin=Date.now(),lane=createProviderLane(Date.now,origin+90000,new AbortController().signal,100);
 const starts:number[]=[];await lane.ready();const oldStart=Date.now();
 lane.response(json({},status,{'retry-after':'0'}),oldStart);expect(lane.pausedUntil-origin).toBe(1000);
 for(let i=0;i<8;i++)lane.response(json({}),oldStart);expect(lane.snapshot().pressure).toBe(1);
 const workers=Promise.all(Array.from({length:4},async()=>{if(await lane.ready())starts.push(Date.now()-origin);}));
 await vi.advanceTimersByTimeAsync(500);lane.response(json({},status,{'retry-after':new Date(origin-60000).toUTCString()}),oldStart);
 expect(lane.pausedUntil-origin).toBe(2500);await vi.advanceTimersByTimeAsync(3500);await workers;expect(starts).toEqual([2500,3000,3500,4000]);
 for(let i=0;i<8;i++)lane.response(json({}),oldStart);expect(lane.snapshot().pressure).toBe(2);
 for(let i=0;i<8;i++)lane.response(json({}),Date.now());expect(lane.snapshot().pressure).toBe(0);
});
it.each([[false, false], [true, false], [true, true]])('paced acoustic misses form one useful bounded batch (slow=%s, initial hit=%s)', async (slow, initialHit) => {
  vi.useFakeTimers(); const origin = Date.now(), starts: number[] = [], groups: Array<{ at: number; songs: string[] }> = []; let firstGap = -1;
  const songs = Array.from({ length: initialHit ? 9 : 8 }, (_, i) => ({ artist: `Fixture ${i}`, song: `Synthetic ${i}` }));
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input);
    if (url.hostname === 'musicbrainz.org') return new Promise<Response>(() => {});
    starts.push(Date.now() - origin);
    if (initialHit && url.pathname.endsWith('/audio-features')) return json({ energy: 0.8, danceability: 0.8 });
    if (initialHit && url.searchParams.get('searchText') === 'Synthetic 0') return json({ content: [{ id: 'hit', trackTitle: 'Synthetic 0', artists: [{ name: 'Fixture 0' }] }] });
    if (slow && url.searchParams.get('searchText') === songs.at(-1)?.song) return new Promise<Response>(() => {});
    // Let the first exact hit finish (including its separately paced feature request) before misses settle.
    if (initialHit && url.searchParams.get('page') === '0') await new Promise(r => setTimeout(r, 250));
    if (url.searchParams.get('page') === '1' && firstGap < 0) firstGap = Date.now() - origin;
    return json({ content: [] });
  });
  const pending = runEnrichment(songs, { ...deps, estimate: async (group, _signal, emit) => {
    groups.push({ at: Date.now() - origin, songs: group.map(s => s.song) });
    await new Promise(r => setTimeout(r, 6000));
    const values = group.map(() => ({ energy: 8, danceability: 8 })); values.forEach((v, i) => emit?.(i, v)); return values;
  } });
  await vi.advanceTimersByTimeAsync(16_000); const out = await pending;
  expect(firstGap).toBeGreaterThanOrEqual(100);
  expect(groups).toEqual([{ at: firstGap + 250, songs: songs.slice(initialHit ? 1 : 0).map(s => s.song) }]);
  expect(starts.every((at, i) => i === 0 || at - starts[i - 1] >= 50)).toBe(true);
  expect(out.results).toHaveLength(songs.length); expect(out.results.slice(initialHit ? 1 : 0).every(r => r.energy === 8 && r.danceability === 8 && r.prov?.energy === 'ai')).toBe(true);
  if (initialHit) expect(out.results[0].prov?.energy).toBe('provider');
  expect(out.status.timedOut).not.toContain('ai');
  const frozen = JSON.stringify(out); await vi.advanceTimersByTimeAsync(20_000); expect(JSON.stringify(out)).toBe(frozen);
});
it('coordinates all four workers with 50ms healthy dispatch spacing', async () => {
  vi.useFakeTimers(); const origin = Date.now(), starts: number[] = [];
  const lane = createProviderLane(Date.now, origin + 16_000, new AbortController().signal, PROVIDER_INTERVAL_MS);
  const workers = Promise.all(Array.from({ length: 4 }, async () => { for (let i = 0; i < 2; i++) if (await lane.ready()) starts.push(Date.now() - origin); }));
  await vi.advanceTimersByTimeAsync(1000); await workers;
  expect(starts).toEqual([0, 50, 100, 150, 200, 250, 300, 350]);
});
it.each([429, 503])('%s missing/invalid hints back off 1/2/4 seconds, dates and valid seconds honored', async status => {
  vi.useFakeTimers(); const origin = Date.now(); const lane = createProviderLane(Date.now, origin + 90_000, new AbortController().signal);
  for (const [hint, wait] of [[null, 1000], ['invalid', 2000], ['', 4000]] as const) {
    const at = Date.now(); lane.response(json({}, status, hint === null ? {} : { 'retry-after': hint }));
    expect(lane.pausedUntil - at).toBe(wait); const ready = lane.ready(); await vi.advanceTimersByTimeAsync(wait); expect(await ready).toBe(true);
  }
  const date = new Date(Date.now() + 10_000).toUTCString(); lane.response(json({}, status, { 'retry-after': date }));
  expect(lane.pausedUntil).toBe(Math.max(Date.parse(date),Date.now()+8000));
  lane.response(json({}, status, { 'retry-after': '30' })); expect(lane.pausedUntil).toBe(Date.now() + 30_000);
  expect(retryAfterMs('-1', Date.now())).toBeUndefined(); expect(retryAfterMs('nonsense', Date.now())).toBeUndefined();
  expect(retryAfterMs('0', Date.now())).toBe(0);
});
it('network pressure grows, cooldown rechecked after wake, abort leaves no late reservation', async () => {
  vi.useFakeTimers(); const origin = Date.now(), ctrl = new AbortController(); const lane = createProviderLane(Date.now, origin + 16_000, ctrl.signal, 50);
  lane.networkFailure(); const ready = lane.ready(); await vi.advanceTimersByTimeAsync(500); lane.networkFailure();
  await vi.advanceTimersByTimeAsync(500); expect(lane.pausedUntil).toBe(origin + 2500);
  ctrl.abort(); expect(await ready).toBe(false); await vi.advanceTimersByTimeAsync(20_000); expect(await lane.ready()).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
it('serial chunk pressure persists, expires by elapsed time, and healthy replies decay to ordinary speed', async () => {
  vi.useFakeTimers(); const ctrl = new AbortController(), end = Date.now() + 90_000;
  const first = createProviderLane(Date.now, end, ctrl.signal, 50); first.response(json({}, 429)); first.response(json({}, 503));
  const captured = capturePacing({ reccobeats: first.snapshot() }, Date.now()); await vi.advanceTimersByTimeAsync(500);
  const next = createProviderLane(Date.now, end, ctrl.signal, 50, remainingPacing(captured, Date.now()).reccobeats);
  expect(next.snapshot()).toEqual({ pressure: 2, cooldownMs: 1500 });
  const pending = next.ready(); await vi.advanceTimersByTimeAsync(1500); expect(await pending).toBe(true);
  for (let i = 0; i < 8; i++) next.response(json({})); expect(next.snapshot().pressure).toBe(0);
  await vi.advanceTimersByTimeAsync(500); expect(await next.ready()).toBe(true);
  expect(remainingPacing(captured, Date.now()).reccobeats?.cooldownMs).toBe(0);
});
it('long valid Retry-After closes work within the existing hard ceiling rather than shortening to fallback', async () => {
  vi.useFakeTimers(); const origin = Date.now(); const lane = createProviderLane(Date.now, origin + 16000, new AbortController().signal);
  lane.response(json({}, 429, { 'retry-after': '120' })); const captured = capturePacing({ reccobeats: lane.snapshot() }, origin);
  expect(lane.snapshot().cooldownMs).toBe(120000); expect(await lane.ready()).toBe(false);
  await vi.advanceTimersByTimeAsync(16000); const next = createProviderLane(Date.now, Date.now() + 16000, new AbortController().signal, 50, remainingPacing(captured, Date.now()).reccobeats);
  expect(next.snapshot().cooldownMs).toBe(104000); expect(await next.ready()).toBe(false);
});
it('cache read time consumes carried cooldown rather than extending it, healthy lane remains independent', async () => {
  vi.useFakeTimers(); const origin = Date.now(), reco: number[] = [], mb: number[] = [];
  vi.stubGlobal('fetch', async (input: string) => { const url = new URL(input); (url.hostname === 'musicbrainz.org' ? mb : reco).push(Date.now() - origin); return json({ content: [], recordings: [] }); });
  const pending = runEnrichment([{ artist: 'Fixture', song: 'Synthetic' }], { ...deps, readRows: async () => { await new Promise(r => setTimeout(r, 500)); return []; } }, { pacing: { reccobeats: { pressure: 2, cooldownMs: 2000 } } });
  await vi.advanceTimersByTimeAsync(16000); const out = await pending;
  expect(reco[0]).toBe(2000); expect(mb[0]).toBe(500); expect(out.status.complete).toBe(true);
});
it('actual in-flight deadline remains visible beside rate pressure, without late cause mutation', async () => {
  vi.useFakeTimers(); let mbResolve: (r: Response) => void = () => {};
  vi.stubGlobal('fetch', async (input: string) => new URL(input).hostname === 'musicbrainz.org' ? new Promise<Response>(resolve => { mbResolve = resolve; }) : json({}, 429, { 'retry-after': '120' }));
  const pending = runEnrichment([{ artist: 'Fixture', song: 'Synthetic' }], { ...deps, limits: { requestMs: 16000 } });
  await vi.advanceTimersByTimeAsync(16000); const out = await pending;
  expect(out.status.causes?.reccobeats?.rate).toBe(1); expect(out.status.causes?.musicbrainz?.deadline).toBe(1);
  const frozen = JSON.stringify(out); mbResolve(json({ recordings: [] })); await vi.advanceTimersByTimeAsync(1000); expect(JSON.stringify(out)).toBe(frozen);
});
it('actual authenticated chunks carry pressure without replay, keep partial facts, and warm cache bypasses cooldown', async () => {
  vi.useFakeTimers(); const starts: number[] = [], writes: unknown[] = []; let attempt = 0;
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input); if (url.hostname === 'musicbrainz.org') return json({ recordings: [{ title: 'Synthetic', 'artist-credit': [{ name: 'Fixture' }], 'first-release-date': '2004-01-01' }] });
    starts.push(Date.now()); attempt++; return json({}, attempt === 1 ? 429 : 503);
  });
  const handler = enrichHandler({ ...deps, upsert: async rows => { writes.push(...rows); } });
  const song = { artist: 'Fixture', song: 'Synthetic' };
  const a = await handler({ songs: [song] });
  expect(a.results[0]).toMatchObject({ year: 2004, incomplete: true }); expect(starts).toHaveLength(1);
  const at = Date.now(); const b = handler({ songs: [{ ...song, song: 'Second' }], pacing: a.status.pacing });
  await vi.advanceTimersByTimeAsync(16_000); const out = await b;
  expect(starts[1] - at).toBeGreaterThanOrEqual(a.status.pacing?.reccobeats?.cooldownMs ?? 0);
  expect(out.status.pacing?.reccobeats?.pressure).toBe(2); expect(starts).toHaveLength(2);
  expect(writes).toHaveLength(1); // only genuine year facts, never negative-cache transient failures
  const cache: CacheRow = { artist_key: 'fixture', song_key: 'synthetic', energy: 8, danceability: 8, valence: null, popularity: 8, bpm: 120, camelot: null, genre: 'Pop', year: 2004, source: 'ReccoBeats', fetched_at: new Date().toISOString() };
  const began = Date.now(); const warm = await runEnrichment([song], { ...deps, readRows: async () => [cache] }, { pacing: { reccobeats: { pressure: 6, cooldownMs: 60_000 }, musicbrainz: { pressure: 6, cooldownMs: 60_000 } } });
  expect(Date.now()).toBe(began); expect(warm.results[0].energy).toBe(8); expect(starts).toHaveLength(2);
});import { weeklyCheck, weeklyEvidence } from './helpers/weeklyEvidence';
it('weekly structured provider pacing', async () => {
  await weeklyEvidence('provider-pacing', 'pacing', async e => {
    vi.useFakeTimers(); const origin = Date.now(), lane = createProviderLane(Date.now, origin + 90000, new AbortController().signal, 100), starts: number[] = [];
    await lane.ready(); const oldStart = Date.now();
    lane.response(json({}, 429, { 'retry-after': '0' }), oldStart);
    weeklyCheck(e, 'pacing-zero-floor-ms', lane.pausedUntil - origin, 1000);
    for (let i = 0; i < 8; i++) lane.response(json({}), oldStart);
    const workers = Promise.all(Array.from({ length: 4 }, async () => { if (await lane.ready()) starts.push(Date.now() - origin); }));
    await vi.advanceTimersByTimeAsync(500); lane.response(json({}, 503, { 'retry-after': new Date(origin - 60000).toUTCString() }), oldStart);
    weeklyCheck(e, 'pacing-past-floor-ms', lane.pausedUntil - origin, 2500);
    await vi.advanceTimersByTimeAsync(3500); await workers;
    weeklyCheck(e, 'pacing-first-recovery-start-ms', starts[0] ?? 0, 2500);
    for (let i = 0; i < 8; i++) lane.response(json({}), oldStart);
    weeklyCheck(e, 'pacing-stale-success-pressure', lane.snapshot().pressure, 2);
    for (let i = 0; i < 8; i++) lane.response(json({}), Date.now());
    weeklyCheck(e, 'pacing-fresh-success-pressure', lane.snapshot().pressure, 0);
  });
});
