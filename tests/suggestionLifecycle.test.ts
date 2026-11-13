import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj';
import * as dance from '@/lib/danceFloor';
import * as audio from '@/lib/audioMatch';
import * as snapshots from '@/lib/snapshotSafety';
import * as drafts from '@/lib/eventDrafts';
import * as input from '@/lib/inputSafety';
import * as autosave from '@/lib/eventAutosave';
import * as vibes from '@/lib/vibes';
import * as isolation from '@/lib/workflowIsolation';
import * as theory from '@/lib/musicTheory';
import * as revisions from '@/lib/eventRevision';
import { exportReadiness } from '@/lib/exportReadiness';
import { factsKey } from '@/lib/prep/factsGather';
import { AdditionKeySet } from '@/lib/additionIdentity';
import { SUGGESTION_SERVER_DEADLINE_MS } from '@/lib/prep/suggestionLanes';
import { recommendHandler } from './helpers/recommendHandler';

/*
 * Live-shaped suggestion lifecycle, all synthetic: actual event route + actual recommend handler (real validator,
 * deadline and partial retention; only the model stream is synthetic) + a 37,722-entry index of short 3–5 minute files
 * and 90/240/120-minute selected targets (45/120/60 at 2x). Healthy replies take 9–10 s (Warm Up, 14–15 songs) and
 * 21–25 s (Transition/Peak, 40 songs); the old 12 s client timeout discarded them and stopped Peak entirely.
 */
const require = createRequire(import.meta.url);
const createHarness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness;
const actual = { vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions };
const sections = ['warmUp', 'transition', 'peak'] as const;
const LABEL = { warmUp: 'Warm Up', transition: 'Transition', peak: 'Peak' } as const;
const TARGETS = [5400, 14400, 7200];
const clients = Array.from({ length: 34 }, (_, i) => ({ artist: `TEST Request ${i}`, song: `Client ${i}` }));
const base = { id: 'A', inputs: { songs: clients, hours: '3.75', buffer: 2, listType: 'dance', expand: true, split: { warmUp: 45, transition: 120, peak: 60 }, genresInput: 'Pop', decades: ['2000s'], bpmRange: [110, 130], danceRange: [6, 10], eventFit: { avoidSlow: true } }, lists: { warmUp: clients.map(s => ({ ...s, fromUpload: true })), transition: [], peak: [], selections: {} } };
const DESPERADO = { artist: 'TEST Eagle Trio', title: 'Desperado Ballad' };
const UNKNOWN_FIT = { artist: 'TEST Unknown Fit', title: 'No Dance Evidence' };
const LANE_FILES = { warmUp: 60, transition: 120, peak: 80 };
const laneTrack = (k: string, i: number) => ({ artist: `TEST Lane ${k} ${i}`, title: `Lane Song ${i}`, filePath: `/synthetic/lane/${k}/${i}.mp3`, genre: 'Pop', songLength: 180 + (i % 5) * 30 });

function library() {
  const lane = sections.flatMap(k => Array.from({ length: LANE_FILES[k] }, (_, i) => laneTrack(k, i)));
  const special = [{ ...DESPERADO, filePath: '/synthetic/special/desperado.mp3', year: '2005', bpm: '120', genre: 'Pop', songLength: 214 },
    { ...UNKNOWN_FIT, filePath: '/synthetic/special/unknown.mp3', genre: 'Pop', songLength: 200 }];
  const own = clients.map((c, i) => ({ artist: c.artist, title: c.song, filePath: `/synthetic/client/${i}.mp3`, year: '2005', bpm: '120', genre: 'Pop', songLength: 180 + (i % 5) * 30 }));
  const distractors = Array.from({ length: 37722 - lane.length - special.length - own.length }, (_, i) => ({ artist: `TEST Archive ${i % 5000}`, title: `Archive ${i}`, filePath: `/synthetic/archive/${i}.mp3`, year: '1985', bpm: '100', genre: 'Metal', songLength: 180 + (i % 5) * 30 }));
  const tracks = [...distractors, ...own, ...special, ...lane];
  expect(tracks).toHaveLength(37722);
  return vdj.buildLibrary(tracks);
}
type Call = { section: string; start: number; end: number; count: number; deadlineMs?: number; existing: number; returned: number };

function scenario(opts: { mode: 'cold' | 'mixed' | 'warm'; delay?: (section: string, n: number) => number; failure?: (section: string, n: number) => 'hang' | 'stream-hang' | 'transient' | undefined; neighborsHang?: boolean }) {
  const lib = library();
  const before = JSON.stringify(lib.tracks);
  const calls: Call[] = [], lookups: Array<{ at: number; songs: string[] }> = [];
  const cursor: Record<string, number> = { 'Warm Up': 0, Transition: 0, Peak: 0 };
  const sectionCalls: Record<string, number> = { 'Warm Up': 0, Transition: 0, Peak: 0 };
  const key = { 'Warm Up': 'warmUp', Transition: 'transition', Peak: 'peak' } as Record<string, keyof typeof LANE_FILES>;
  const item = (t: { artist: string; title: string }) => ({ artist: t.artist, song: t.title, genre: 'Pop', decade: '2000s', year: 2005, energy: 8, danceability: 8, popularity: 8, valence: 7, bpm: 120, reason: 'E8 D8 pop8 120BPM synthetic' });
  const server = recommendHandler(async (options: any) => {
    const section = /for the "([^"]+)" portion/.exec(options.prompt)![1];
    const count = Number(/Suggest (\d+) real/.exec(options.prompt)![1]);
    const n = sectionCalls[section]++;
    const mode = opts.failure?.(section, n);
    if (mode === 'transient') throw Object.assign(new Error('synthetic gateway busy'), { status: 503 });
    const k = key[section];
    const want = section === 'Warm Up' ? Math.min(count, n % 2 ? 15 : 14) : count;
    const rows = [] as any[];
    // Peak's first healthy reply carries a strongly slow owned track and a file with no dance evidence;
    // its second reply carries a credited variant of a Warm Up suggestion and a cross-lane duplicate.
    if (section === 'Peak' && n === 0) rows.push(item(DESPERADO), item(UNKNOWN_FIT));
    if (section === 'Peak' && n === 1) rows.push({ ...item(laneTrack('warmUp', 0)), artist: 'TEST Lane warmUp 0 feat. TEST Guest' }, item(laneTrack('transition', 0)));
    while (rows.length < want && cursor[section] < LANE_FILES[k]) rows.push(item(laneTrack(k, cursor[section]++)));
    if (mode === 'stream-hang') return { stream: rows, stepMs: 1000 }; // 40 items over 40 s: server deadline keeps the finished ones
    if (mode === 'hang') return new Promise(() => {});
    await new Promise(r => setTimeout(r, opts.delay?.(section, n) ?? (section === 'Warm Up' ? 8970 + n * 1220 : section === 'Transition' ? 22430 + (n % 2) * 190 : 21000 + (n % 2) * 3500)));
    return { object: { suggestions: rows } };
  });
  const latency = opts.mode === 'cold' ? 3000 : opts.mode === 'mixed' ? 1500 : 300;
  const facts = (s: { artist: string; song: string }) => {
    if (s.artist === UNKNOWN_FIT.artist) return { ...s, source: 'none' };
    if (s.artist === DESPERADO.artist) return { ...s, energy: 2, danceability: 2, source: 'ReccoBeats', prov: { energy: 'provider', danceability: 'provider' } };
    if (!s.artist.startsWith('TEST')) return { ...s, source: 'none' };
    return { ...s, energy: 8, danceability: 8, bpm: 120, year: 2005, genre: 'Pop', source: 'ReccoBeats', prov: { energy: 'provider', danceability: 'provider', bpm: 'provider', year: 'provider', genre: 'provider' } };
  };
  let deny = false;
  const h = createHarness(actual)({ rows: { A: structuredClone(base), B: { ...structuredClone(base), id: 'B' } }, contract: true, services: {
    enrich: async ({ data }: any) => { lookups.push({ at: Date.now(), songs: data.songs.map(factsKey) }); await new Promise(r => setTimeout(r, latency)); return { results: data.songs.map(facts) }; },
    neighbors: opts.neighborsHang ? () => new Promise(() => {}) : undefined,
    recommend: async (request: any) => {
      if (deny) throw new Error('stale request sent');
      const call: Call = { section: request.data.section, start: Date.now(), end: -1, count: request.data.count, deadlineMs: request.data.deadlineMs, existing: request.data.existing.length, returned: 0 };
      calls.push(call);
      try { const reply = await server.call({ data: request.data }); call.returned = reply.suggestions.length; return reply; } finally { call.end = Date.now(); }
    },
  } });
  const seconds = () => sections.map(k => exportReadiness(h.current.result[k].map((song: any, i: number) => ({ song, match: h.current.matches[`${k}:${i}:${dance.dedupeKey(song.artist, song.song)}`] })), lib).knownSec);
  return { h, lib, before, calls, lookups, seconds, denyLater: () => { deny = true; } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const mode of ['cold', 'mixed', 'warm'] as const) it(`healthy 20-25 s replies fill every section to 90/240/120 min (${mode} metadata, 37,722 files)`, async () => {
  vi.useFakeTimers();
  const s = scenario({ mode });
  await s.h.flush(); s.h.library(s.lib); await s.h.flush();
  const started = Date.now(); const pending = s.h.current.generate(); await vi.advanceTimersByTimeAsync(240000); await pending; await s.h.flush();
  const seconds = s.seconds();
  seconds.forEach((sec, i) => expect(sec).toBeGreaterThanOrEqual(TARGETS[i]));
  const all = sections.flatMap(k => s.h.current.result[k]);
  // Every client request retained; additions unique by intended identity (no credited/cross-lane duplicates).
  expect(all.filter((x: any) => x.fromUpload).map(factsKey).sort()).toEqual(clients.map(factsKey).sort());
  const intended = new AdditionKeySet(); for (const x of all.filter((y: any) => !y.fromUpload)) expect(intended.tryAdd(x.artist, x.song)).toBe(true);
  expect(all.some((x: any) => x.artist.includes('feat. TEST Guest'))).toBe(false);
  // Slow gate and supported-fit gate hold: the Desperado-like and no-evidence files never appear.
  expect(all.some((x: any) => x.artist === DESPERADO.artist || x.artist === UNKNOWN_FIT.artist)).toBe(false);
  // Healthy >12 s replies contributed: the first Transition/Peak replies took 21-25 s and their songs were placed.
  const first = (label: string) => s.calls.find(c => c.section === label)!;
  expect(first('Transition').end - first('Transition').start).toBeGreaterThanOrEqual(22000);
  expect(first('Peak').end - first('Peak').start).toBeGreaterThanOrEqual(21000);
  expect(first('Transition').returned).toBe(40);
  expect(all.some((x: any) => x.artist.startsWith('TEST Lane transition'))).toBe(true);
  expect(all.some((x: any) => x.artist.startsWith('TEST Lane peak'))).toBe(true);
  // Fair opportunity: Peak's first request is dispatched in the same round as Warm Up, not after Transition.
  expect(first('Peak').start - first('Warm Up').start).toBeLessThan(1000);
  // One in-flight request per section lane; coordinated deadlines; bounded wire context.
  for (const label of Object.values(LABEL)) {
    const mine = s.calls.filter(c => c.section === label);
    for (let i = 1; i < mine.length; i++) expect(mine[i].start).toBeGreaterThanOrEqual(mine[i - 1].end);
  }
  for (const c of s.calls) { expect(c.deadlineMs).toBeLessThanOrEqual(SUGGESTION_SERVER_DEADLINE_MS); expect(c.existing).toBeLessThanOrEqual(500); expect(c.end - started).toBeLessThanOrEqual(90000 + 60000); }
  expect(s.h.infos.some((m: string) => /ran out of time|could not complete|did not pass validation/.test(m))).toBe(false);
  // Each exact lookup sent once; originals untouched.
  const sent = s.lookups.flatMap(l => l.songs); expect(new Set(sent).size).toBe(sent.length);
  expect(JSON.stringify(s.lib.tracks)).toBe(s.before);
  expect(s.h.errors).toEqual([]);
  console.info(`SYNTHETIC lifecycle ${mode}: seconds=${seconds.join('/')} targets=${TARGETS.join('/')} calls=${s.calls.map(c => `${c.section}@${c.start - started}+${c.end - c.start}ms:${c.returned}`).join(', ')}`);
  s.h.unmount();
}, 60000);

it('a hung Transition stream keeps finished songs at the server deadline and never blocks Warm Up or Peak', async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'warm', failure: (section, n) => section === 'Transition' && n === 0 ? 'stream-hang' : undefined });
  await s.h.flush(); s.h.library(s.lib); await s.h.flush();
  const started = Date.now(); const pending = s.h.current.generate(); await vi.advanceTimersByTimeAsync(240000); await pending; await s.h.flush();
  const t = s.calls.filter(c => c.section === 'Transition');
  // Server deadline (≤30 s) returned the completed items; the client did not time out or discard them.
  expect(t[0].end - t[0].start).toBeLessThanOrEqual(SUGGESTION_SERVER_DEADLINE_MS + 1000);
  expect(t[0].returned).toBeGreaterThanOrEqual(25); expect(t[0].returned).toBeLessThan(40);
  // The lane resized its next request to what fit; other lanes were served in the same round.
  if (t[1]) expect(t[1].count).toBeLessThanOrEqual(t[0].returned);
  expect(s.calls.find(c => c.section === 'Peak')!.start - started).toBeLessThan(t[0].end - started);
  const seconds = s.seconds(); seconds.forEach((sec, i) => expect(sec).toBeGreaterThanOrEqual(TARGETS[i]));
  expect(s.h.infos.some((m: string) => m.includes('ran out of time'))).toBe(false);
  s.h.unmount();
}, 60000);

it('a Transition reply with no output ends only its own lane after bounded timeouts; honest shortage, no replay storm', async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'warm', failure: section => section === 'Transition' ? 'hang' : undefined });
  await s.h.flush(); s.h.library(s.lib); await s.h.flush();
  const pending = s.h.current.generate(); await vi.advanceTimersByTimeAsync(300000); await pending; await s.h.flush();
  const t = s.calls.filter(c => c.section === 'Transition');
  expect(t.length).toBeGreaterThanOrEqual(1); expect(t.length).toBeLessThanOrEqual(2);
  expect(t[0].end - t[0].start).toBeLessThanOrEqual(SUGGESTION_SERVER_DEADLINE_MS + 1000);
  if (t[1]) expect(t[1].count).toBeLessThanOrEqual(Math.floor(t[0].count / 2));
  const seconds = s.seconds();
  expect(seconds[0]).toBeGreaterThanOrEqual(TARGETS[0]); expect(seconds[2]).toBeGreaterThanOrEqual(TARGETS[2]);
  expect(seconds[1]).toBeLessThan(TARGETS[1]);
  expect(s.h.infos.some((m: string) => m.includes('ran out of time; other sections continued'))).toBe(true);
  expect(s.h.warnings.some((m: string) => m.includes('short'))).toBe(true);
  expect(sections.flatMap(k => s.h.current.result[k]).filter((x: any) => x.fromUpload)).toHaveLength(34);
  s.h.unmount();
}, 60000);

it('a transient Peak failure retries once in its own lane after a delay while other lanes continue', async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'warm', failure: (section, n) => section === 'Peak' && n === 0 ? 'transient' : undefined });
  await s.h.flush(); s.h.library(s.lib); await s.h.flush();
  const pending = s.h.current.generate(); await vi.advanceTimersByTimeAsync(240000); await pending; await s.h.flush();
  const p = s.calls.filter(c => c.section === 'Peak');
  expect(p[1].start - p[0].end).toBeGreaterThanOrEqual(1000);
  const seconds = s.seconds(); seconds.forEach((sec, i) => expect(sec).toBeGreaterThanOrEqual(TARGETS[i]));
  s.h.unmount();
}, 60000);

for (const boundary of ['event', 'account'] as const) it(`a healthy 22 s reply completing after a ${boundary} switch is ignored: no toast, result, save or further request`, async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'warm' });
  await s.h.flush(); s.h.library(s.lib); await s.h.flush();
  const pending = s.h.current.generate();
  for (let i = 0; i < 120 && !s.calls.some(c => c.section === 'Transition'); i++) await vi.advanceTimersByTimeAsync(500);
  expect(s.calls.some(c => c.section === 'Transition' && c.end < 0)).toBe(true);
  s.h.switchTo(boundary === 'account' ? 'other' : 'owner', boundary === 'event' ? 'B' : 'A'); await s.h.flush();
  const snap = { result: JSON.stringify(s.h.current.result), writes: s.h.requests.length, infos: [...s.h.infos], warnings: [...s.h.warnings], calls: s.calls.length };
  s.denyLater();
  await vi.advanceTimersByTimeAsync(240000); await pending; await s.h.flush();
  expect(s.calls.length).toBe(snap.calls);
  expect(JSON.stringify(s.h.current.result)).toBe(snap.result); expect(s.h.requests).toHaveLength(snap.writes);
  expect(s.h.infos).toEqual(snap.infos); expect(s.h.warnings).toEqual(snap.warnings);
  s.h.unmount();
}, 60000);

it('a hung neighbour provider is bounded and long preparation does not consume the expansion lookup window', async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'warm', neighborsHang: true });
  await s.h.flush(); s.h.library(s.lib); await s.h.flush();
  const pending = s.h.current.generate(); await vi.advanceTimersByTimeAsync(240000); await pending; await s.h.flush();
  const firstClient = s.lookups[0].at;
  const firstExpansion = s.lookups.find(l => l.songs.some(k => !k.startsWith('TEST Request')))!.at;
  expect(firstExpansion - firstClient).toBeLessThanOrEqual(15000 + 2000);
  const seconds = s.seconds(); seconds.forEach((sec, i) => expect(sec).toBeGreaterThanOrEqual(TARGETS[i]));
  s.h.unmount();
}, 60000);

it('measured: 37,722-file preparation reaches the first expansion lookup quickly with instant services (real clock)', async () => {
  const s = scenario({ mode: 'warm', delay: () => 0 });
  await s.h.flush(); s.h.library(s.lib); await s.h.flush();
  await s.h.current.generate(); await s.h.flush();
  const firstClient = s.lookups[0].at;
  const firstExpansion = s.lookups.find(l => l.songs.some(k => !k.startsWith('TEST Request')))!.at;
  console.info(`SYNTHETIC prep latency: first client lookup -> first expansion lookup ${firstExpansion - firstClient} ms (37,722 files)`);
  // Before memoizing exact-pair matching this phase measured ~5.1 s in Node (fuzzy matching re-run per sort comparison).
  expect(firstExpansion - firstClient).toBeLessThan(4000);
  s.h.unmount();
}, 120000);

it('actual handler: deadline keeps only fully streamed items, rejects deadlines beyond the server cap, reports empty deadline as timeout', async () => {
  vi.useFakeTimers();
  const item = (i: number) => ({ artist: `TEST Stream ${i}`, song: `Item ${i}`, genre: 'Pop', decade: '2000s', energy: 8, danceability: 8, popularity: 8, valence: 7, reason: 'E8 D8' });
  const h = recommendHandler(async () => ({ stream: Array.from({ length: 40 }, (_, i) => item(i)), stepMs: 1000 }));
  const data = { section: 'Peak', count: 40, prefs: {}, existing: [], deadlineMs: 12000 };
  await expect(h.call({ data: { ...data, deadlineMs: SUGGESTION_SERVER_DEADLINE_MS + 1 } })).rejects.toThrow();
  const p = h.call({ data }); await vi.advanceTimersByTimeAsync(13000); const out = await p;
  expect(out.partial).toBe(true); expect(out.suggestions.length).toBeGreaterThanOrEqual(10); expect(out.suggestions.length).toBeLessThan(12);
  expect(out.suggestions.every((x: any) => typeof x.energy === 'number' && typeof x.danceability === 'number')).toBe(true);
  const empty = recommendHandler(() => new Promise(() => {}));
  const q = empty.call({ data }); q.catch(() => {}); await vi.advanceTimersByTimeAsync(13000);
  const failure = await q.then(() => null, (e: unknown) => e);
  expect(isolation.suggestionFailure(failure).kind).toBe('timeout');
});

it('lane controller: one in-flight request per lane, validation stops all lanes, timeouts stay lane-local, short windows never send', async () => {
  vi.useFakeTimers();
  const { createSuggestionLanes, suggestionDeadlineError } = await import('@/lib/prep/suggestionLanes');
  const sent: string[] = [];
  const make = (fail: (lane: string) => unknown, end = Date.now() + 90000) => createSuggestionLanes<{ lane: string }, string>({
    send: async (r) => { sent.push(r.lane); const e = fail(r.lane); if (e) throw e; return { suggestions: ['x'] }; },
    classify: isolation.suggestionFailure, isCurrent: () => true, end, maxCount: 40,
  });
  const a = make(() => undefined);
  const [one, two] = await Promise.all([a.request('Peak', 10, () => ({ lane: 'Peak' })), a.request('Peak', 10, () => ({ lane: 'Peak' }))]);
  expect(one?.suggestions).toEqual(['x']); expect(two).toBeNull(); expect(sent).toEqual(['Peak']);
  sent.length = 0;
  const b = make(lane => lane === 'Transition' ? suggestionDeadlineError() : undefined);
  expect(await b.request('Transition', 40, () => ({ lane: 'Transition' }))).toBeNull();
  expect(b.lane('Transition').cap).toBe(20); expect(b.open('Transition')).toBe(true);
  expect(await b.request('Transition', 40, () => ({ lane: 'Transition' }))).toBeNull(); expect(b.open('Transition')).toBe(false);
  expect((await b.request('Peak', 10, () => ({ lane: 'Peak' })))?.suggestions).toEqual(['x']);
  const c = make(() => Object.assign(new Error('validation'), { issues: [] }));
  expect(await c.request('Warm Up', 10, () => ({ lane: 'Warm Up' }))).toBeNull(); expect(c.stoppedAll).toBe(true);
  sent.length = 0; expect(await c.request('Peak', 10, () => ({ lane: 'Peak' }))).toBeNull(); expect(sent).toEqual([]);
  const d = make(() => undefined, Date.now() + 10000);
  expect(await d.request('Peak', 10, () => ({ lane: 'Peak' }))).toBeNull(); expect(sent).toEqual([]);
});
