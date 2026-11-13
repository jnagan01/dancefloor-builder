import { afterEach, expect, it, vi } from 'vitest';
import { runEnrichment, type EnrichDeps } from '@/lib/enrichPipeline.server';
import { runEnrichment as baseline } from './fit/archived/enrichPipeline.d8b597d';
import { createProviderLane } from '@/lib/enrichScheduling.server';
import { createFactsGatherer, factsKey } from '@/lib/prep/factsGather';
import { createSuggestionLanes } from '@/lib/prep/suggestionLanes';
import { suggestionFailure } from '@/lib/workflowIsolation';
import { recommendHandler } from './helpers/recommendHandler';

const songs = Array.from({ length: 8 }, (_, i) => ({ artist: `TEST Recovery ${i}`, song: `Recovery ${i}` }));
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const storage: EnrichDeps = { readRows: async () => [], upsert: async () => {} };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function earlyMissNetwork() {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url);
    if (u.host === 'musicbrainz.org') return json({ recordings: [] });
    const title = u.searchParams.get('searchText') ?? '';
    // Four early misses; one hung second-wave acoustic request keeps the whole group open.
    if (u.pathname.endsWith('/audio-features')) return new Promise<Response>(() => {});
    if (title === 'Recovery 7') { await sleep(5900); return json({ content: [{ id: 'slow', trackTitle: title, artists: [{ name: 'TEST Recovery 7' }] }] }); }
    await sleep(100);
    return json({ content: [] });
  });
}

it('early completed acoustic gaps get AI time before a slow group: frozen baseline loses facts, repair retains them', async () => {
  vi.useFakeTimers();
  const run = async (fn: typeof runEnrichment) => {
    earlyMissNetwork(); const starts: number[] = []; const origin = Date.now(); let concurrent = 0, peak = 0;
    const pending = fn(songs, { ...storage, estimate: async rows => {
      starts.push(Date.now() - origin); concurrent++; peak = Math.max(peak, concurrent);
      await sleep(5000); concurrent--; return rows.map(() => ({ energy: 7, danceability: 8 }));
    } });
    await vi.advanceTimersByTimeAsync(16000); const out = await pending;
    return { out, starts, peak };
  };
  const old = await run(baseline), fixed = await run(runEnrichment);
  expect(old.out.results.filter(s => s.energy !== undefined)).toHaveLength(0);
  expect(fixed.starts[0]).toBeLessThan(1000);
  expect(old.starts[0]).toBeGreaterThanOrEqual(6000);
  expect(fixed.out.results.filter(s => s.energy === 7)).toHaveLength(7);
  expect(fixed.out.results.slice(0, 7).every(s => s.energy === 7)).toBe(true);
  expect(fixed.peak).toBe(1);
  expect(fixed.out.results[0].prov?.energy).toBe('ai');
  expect(fixed.out.status.complete).toBe(false); // the hung external recording is not hidden
  console.info('SYNTHETIC early gaps before/after', { beforeAiStarts: old.starts, afterAiStarts: fixed.starts, beforeFacts: 0, afterFacts: 7 });
});

it.each(['headers', 'body', 'ai'] as const)('full %s stall returns within the unchanged 16s end and never negative-caches failures', async stall => {
  vi.useFakeTimers(); const writes: unknown[] = []; const signals: AbortSignal[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    if (init.signal) signals.push(init.signal);
    if (stall === 'headers') return new Promise<Response>(() => {});
    if (stall === 'body') return new Response(new ReadableStream({ start() {} }));
    return json({ content: [], recordings: [] });
  });
  const pending = runEnrichment(songs, { ...storage, upsert: async rows => { writes.push(...rows); }, estimate: async () => new Promise(() => {}) });
  await vi.advanceTimersByTimeAsync(16000); const out = await pending;
  expect(out.status.complete).toBe(false); expect(out.status.unfinished).toBe(8);
  expect(out.status.timedOut).toContain(stall === 'ai' ? 'ai' : 'fetch');
  expect(writes).toHaveLength(0); expect(out.results.every(r => r.source === 'none' && r.incomplete)).toBe(true);
  if (stall !== 'ai') expect(signals.every(s => s.aborted)).toBe(true);
});

it('a stalled feature body retains completed exact popularity and other provider facts', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url);
    if (u.host === 'musicbrainz.org') return json({ recordings: [{ title: songs[0].song, 'artist-credit': [{ name: songs[0].artist }], 'first-release-date': '2005-01-01' }] });
    if (u.pathname.endsWith('/search')) return json({ content: [{ id: 'x', trackTitle: songs[0].song, artists: [{ name: songs[0].artist }], popularity: 80 }] });
    return new Response(new ReadableStream({ start() {} }));
  });
  const pending = runEnrichment([songs[0]], { ...storage, estimate: async () => [null] });
  await vi.advanceTimersByTimeAsync(16000); const out = await pending;
  expect(out.results[0]).toMatchObject({ popularity: 8, year: 2005, incomplete: true, prov: { popularity: 'provider', year: 'provider' } });
  expect(out.status.timedOut).toContain('fetch');
});

it('shared cooldown extended by a later 429 cannot be bypassed by already-sleeping workers', async () => {
  vi.useFakeTimers(); const origin = Date.now(); const lane = createProviderLane(Date.now, origin + 16000, new AbortController().signal);
  lane.response(json({}, 429, { 'retry-after': '2' }));
  let readyAt = 0; const waiting = lane.ready().then(ready => { expect(ready).toBe(true); readyAt = Date.now() - origin; });
  await vi.advanceTimersByTimeAsync(1000);
  lane.response(json({}, 429, { 'retry-after': '5' }));
  await vi.advanceTimersByTimeAsync(1000); expect(readyAt).toBe(0);
  await vi.advanceTimersByTimeAsync(4000); await waiting; expect(readyAt).toBe(6000);
});

it.each([429, 503])('%s respects a 14s shared cooldown across chunks, no failed-recording replay, other facts survive', async status => {
  vi.useFakeTimers(); const origin = Date.now(); const starts: number[] = []; let count = 0, readyAt = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url);
    if (u.host === 'musicbrainz.org') return json({ recordings: [] });
    starts.push(Date.now() - origin);
    return count++ < 4 ? json({}, status, { 'retry-after': '14' }) : json({ content: [] });
  });
  const g = createFactsGatherer(async chunk => {
    const out = await runEnrichment(chunk, { ...storage, estimate: async rows => rows.map(() => ({ energy: 7, danceability: 8 })) });
    readyAt = Date.now() + (out.status.retryAfterMs ?? 0); return out.results;
  }, factsKey, { readyAt: () => readyAt, overallMs: 60000, isIncomplete: s => !!s.incomplete });
  const input = [...songs, ...songs.map(s => ({ artist: s.artist + ' second', song: s.song + ' second' }))];
  const pending = g.gather(input); await vi.advanceTimersByTimeAsync(60000); const report = await pending;
  expect(starts.slice(4).every(t => t >= 14000)).toBe(true);
  expect(report.requested).toBe(16); expect(report.incompleteSongs).toBe(8);
  expect(input.every(s => g.get(s)?.energy === 7)).toBe(true);
  expect((await g.gather(input)).alreadyAttempted).toBe(16);
});

it('actual recommendation handler deadline: lane retries smaller without hidden SDK retries and retains completed recovery', async () => {
  vi.useFakeTimers(); const sizes: number[] = []; let calls = 0;
  const server = recommendHandler(async options => {
    expect(options.maxRetries).toBe(0); expect(options.maxOutputTokens).toBe(8192);
    const count = Number(/Suggest (\d+) real/.exec(options.prompt)?.[1]); sizes.push(count);
    if (calls++ === 0) return new Promise(() => {});
    return { stream: Array.from({ length: count }, (_, i) => ({ artist: `TEST Suggest ${i}`, song: `Recovery ${i}`, genre: 'Pop', decade: '2000s', energy: 8, danceability: 8, popularity: 8, valence: 7, reason: 'synthetic' })), stepMs: 300 };
  });
  const lanes = createSuggestionLanes({ send: (data: any) => server.call({ data }), classify: suggestionFailure, isCurrent: () => true, end: Date.now() + 90000, maxCount: 40 });
  const build = (count: number, deadlineMs: number) => ({ section: 'Transition', count, deadlineMs, prefs: {}, existing: [] });
  const first = lanes.request('Transition', 40, build); await vi.advanceTimersByTimeAsync(30000); expect(await first).toBeNull();
  const next = lanes.request('Transition', 40, build); await vi.advanceTimersByTimeAsync(10000);
  expect((await next)?.suggestions).toHaveLength(20); expect(sizes).toEqual([40, 20]);
});

it.each([14000, 120000])('suggestion rate cooldown %ims is honored or stops without an out-of-window replay', async cooldown => {
  vi.useFakeTimers(); const starts: number[] = [], origin = Date.now();
  const lanes = createSuggestionLanes({ send: async () => {
    starts.push(Date.now() - origin);
    if (starts.length === 1) throw Object.assign(new Error('synthetic rate pressure'), { status: 429, responseHeaders: { 'retry-after': String(cooldown / 1000) } });
    return { suggestions: ['synthetic'] };
  }, classify: suggestionFailure, isCurrent: () => true, end: origin + 90000, maxCount: 40 });
  const pending = lanes.request('Peak', 40, () => ({}));
  await vi.advanceTimersByTimeAsync(13000); expect(starts).toEqual([0]);
  await vi.advanceTimersByTimeAsync(77000); const reply = await pending;
  expect(starts).toEqual(cooldown === 14000 ? [0, 14000] : [0]);
  expect(reply?.suggestions ?? []).toEqual(cooldown === 14000 ? ['synthetic'] : []);
});

it('provider and estimate work together never exceeds six lanes; fast gaps survive slower unrelated recordings', async () => {
  vi.useFakeTimers(); let active = 0, peak = 0;
  const busy = async <T,>(ms: number, value: T) => { active++; peak = Math.max(peak, active); await sleep(ms); active--; return value; };
  vi.stubGlobal('fetch', async (url: string) => {
    const u = new URL(url);
    if (u.host === 'musicbrainz.org') return busy(6000, json({ recordings: [] }));
    return busy(100, json({ content: [] }));
  });
  const pending = runEnrichment(songs, { ...storage, estimate: async rows => busy(5000, rows.map(() => ({ energy: 7, danceability: 8 }))) });
  await vi.advanceTimersByTimeAsync(16000); const out = await pending;
  expect(peak).toBeLessThanOrEqual(6); expect(peak).toBeGreaterThanOrEqual(5);
  expect(active).toBe(0); expect(out.results.every(r => r.energy === 7)).toBe(true);
});