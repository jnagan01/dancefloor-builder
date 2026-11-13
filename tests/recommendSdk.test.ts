import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { recommendHandlerSdk } from './helpers/recommendHandler';
import { gatewayStream, type GatewayRequest } from './helpers/gatewayStream';
import * as lanes from '@/lib/prep/suggestionLanes';
import * as oldLanes from './fit/archived/suggestionLanes.376d12b';
import { suggestionFailure } from '@/lib/workflowIsolation';

/*
 * Actual recommendation handler + REAL AI SDK `streamObject` + real gateway provider; only the HTTP transport is
 * synthetic. Stream pacing is the live measurement of 2026-11-13 with the production prompt shape (≈8.7k input tokens,
 * 2000s / BPM 90–130 hard limits, 500-entry context): first item 0.86–1.58 s, then 0.69–0.74 s per item (≈155 output
 * tokens each); 39 items finished in 27.9–29.0 s, i.e. at the edge of the 30 s server deadline.
 */
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
beforeAll(async () => { await import('ai'); await import('@ai-sdk/openai-compatible'); await import('@/lib/ai-gateway.server'); });

const ITEM_CHARS = 600, CHUNK = 40;
function suggestionText(count: number, tag: string) {
  const items = Array.from({ length: count }, (_, i) => {
    const base = { artist: `TEST SDK ${tag} ${i}`, song: `Synthetic ${tag} ${i}`, genre: 'Pop', decade: '2000s', year: 2005, energy: 8, danceability: 8, popularity: 8, valence: 7, bpm: 120, camelot: '8A', mood: 'groovy', explicit: false, reason: '' };
    const pad = Math.max(10, ITEM_CHARS - JSON.stringify(base).length);
    return JSON.stringify({ ...base, reason: `E8 D8 ${'x'.repeat(pad)}` });
  });
  return `{"suggestions":[${items.join(',')}]}`;
}
function stubGateway(o: { firstMs: number; perItemMs: number; stall?: boolean; requests: GatewayRequest[] }) {
  const g = gatewayStream({ startupMs: () => o.stall ? 10 * 60_000 : o.firstMs, chunkMs: Math.round(o.perItemMs * CHUNK / ITEM_CHARS), chunkChars: CHUNK, requests: o.requests,
    content: req => suggestionText(Number(/Suggest (\d+) real/.exec(req.prompt)?.[1] ?? 0), /portion/.test(req.prompt) ? 'Peak' : 'X') });
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => g(init));
}
const data = (count: number, deadlineMs = 30000) => ({ section: 'Peak', count, deadlineMs, prefs: { decades: ['2000s'], bpmRange: [90, 130], danceRange: [6, 10] }, existing: [] });

it('actual handler request contract and real streaming: supported model, output budget, no hidden retries or temperature', async () => {
  vi.useFakeTimers(); const requests: GatewayRequest[] = [];
  stubGateway({ firstMs: 1100, perItemMs: 690, requests });
  const h = await recommendHandlerSdk();
  const p = h.call({ data: data(20) }); await vi.advanceTimersByTimeAsync(20000); const out = await p;
  expect(requests).toHaveLength(1); // maxRetries 0: one transport attempt
  expect(requests[0]).toMatchObject({ model: 'google/gemini-3-flash-preview', max_tokens: 8192, stream: true, authorized: true });
  expect(requests[0].temperature).toBeUndefined();
  expect(out.suggestions).toHaveLength(20); expect(out.partial).toBeUndefined();
});

it('real streamed partial retention at the server deadline keeps every complete item, never the cut-off one', async () => {
  vi.useFakeTimers(); stubGateway({ firstMs: 1580, perItemMs: 740, requests: [] });
  const h = await recommendHandlerSdk();
  const p = h.call({ data: data(40, 20000) }); await vi.advanceTimersByTimeAsync(21000); const out = await p;
  expect(out.partial).toBe(true);
  expect(out.suggestions.length).toBeGreaterThanOrEqual(20); expect(out.suggestions.length).toBeLessThan(40);
  for (const s of out.suggestions) expect(s).toMatchObject({ energy: 8, danceability: 8, popularity: 8, genre: 'Pop' });
});

it('stalled start and no-complete-item deadlines report a safe numeric stage, classified lane-local', async () => {
  vi.useFakeTimers(); stubGateway({ firstMs: 0, perItemMs: 690, stall: true, requests: [] });
  const h = await recommendHandlerSdk();
  const p = h.call({ data: data(39) }); p.catch(() => {}); await vi.advanceTimersByTimeAsync(30500);
  const err: any = await p.then(() => null, e => e);
  expect(err.message).toMatch(/no model output within 30000ms/); expect(err.message).not.toMatch(/TEST|synthetic-not-a-key|https?:/);
  expect(suggestionFailure(err).kind).toBe('timeout');
});

it('proactive sizing under the measured pace: baseline sends one 40-item request at the deadline edge; repair streams smaller continued requests and lands first songs ~14 s earlier', async () => {
  // Same fixture for both: measured slow-end start-up (1.58 s) and pace (0.74 s/item), one section lane, 64 s window.
  const run = async (mod: typeof lanes) => {
    vi.useFakeTimers(); const requests: GatewayRequest[] = [];
    stubGateway({ firstMs: 1580, perItemMs: 740, requests });
    const h = await recommendHandlerSdk('src/lib/recommend.functions.ts', mod);
    const origin = Date.now(), replies: Array<{ at: number; count: number; got: number; partial: boolean }> = [];
    const l = mod.createSuggestionLanes<any, any>({ send: (req: any) => h.call({ data: req }), classify: suggestionFailure, isCurrent: () => true, end: origin + 64000, maxCount: 40 });
    const loop = (async () => {
      while (Date.now() < origin + 64000 && l.open('Peak')) {
        let count = 0;
        const r = await l.request('Peak', 40, (c: number, deadlineMs: number) => { count = c; return data(c, deadlineMs); });
        if (!r) break;
        replies.push({ at: Date.now() - origin, count, got: r.suggestions.length, partial: !!r.partial });
      }
    })();
    for (let t = 0; t < 70 && replies.length < 6; t++) await vi.advanceTimersByTimeAsync(1000);
    l.close(); await vi.advanceTimersByTimeAsync(40000); await loop; vi.useRealTimers(); vi.unstubAllGlobals();
    const by30 = replies.filter(r => r.at <= 30500).reduce((n, r) => n + r.got, 0);
    return { replies, by30, first: replies[0] };
  };
  const before = await run(oldLanes as unknown as typeof lanes);
  const after = await run(lanes);
  console.info(`SYNTHETIC suggestion sizing: baseline ${JSON.stringify(before.replies)}; repaired ${JSON.stringify(after.replies)}`);
  expect(before.first.count).toBe(40);
  expect(before.first.at).toBeGreaterThan(29000); // edge of the 30 s window
  expect(before.first.partial).toBe(true); expect(before.first.got).toBeLessThan(40); // lost tail at the deadline
  expect(after.first.count).toBe(lanes.pacedCount(30000)); expect(after.first.partial).toBe(false);
  expect(after.first.at).toBeLessThan(before.first.at - 12000);
  expect(after.replies.every(r => !r.partial && r.got === r.count)).toBe(true);
  expect(after.by30).toBeGreaterThanOrEqual(before.by30 - 4); // smaller requests cost little start-up
}, 30000);
