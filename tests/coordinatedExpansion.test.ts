import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
import { recommendHandler } from './helpers/recommendHandler';

/*
 * Native-shaped coordination regression, all synthetic (no production data, no real accounts/files):
 * actual event route + actual recommend handler (real validator, server deadline and streamed partial retention;
 * only the model stream is synthetic) + a 37,722-entry index of 3–5 minute files, 34 client requests,
 * targets 90/240/120 min (45/120/60 at 2x), verified 2000s / BPM 110–130 / dance 6–10 / avoidSlow.
 *
 * Measured live shape reproduced: first replies Warm Up 15 @ 12.5 s, Transition 40 @ 29.6 s, Peak 22 @ 18.5 s
 * (3 s start-up + per-item streaming), cold lookup chunks 6143/1844/9149/2771/10396/3274/7457/3300 ms (cyclic),
 * warm cache 300 ms. Suggestions are NOT all eligible: ~20% unlinked strangers / live-version variants / duplicates /
 * credited variants, and linked files resolve to realistic mixed provenance (full provider, incomplete partial,
 * out-of-decade, out-of-BPM, slow, unresolved). Library shelf candidates are mostly ineligible (strict/unsupported).
 */
const require = createRequire(import.meta.url);
const createHarness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness;
const actual = { vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions };
const sections = ['warmUp', 'transition', 'peak'] as const;
const TARGETS = [5400, 14400, 7200];
const COLD = [6143, 1844, 9149, 2771, 10396, 3274, 7457, 3300];
const FIRST_CAP: Record<string, number> = { 'Warm Up': 15, Transition: 40, Peak: 22 };
const PER_ITEM: Record<string, number> = { 'Warm Up': 636, Transition: 666, Peak: 706 };
const STARTUP_MS = 3000;
const KEY: Record<string, (typeof sections)[number]> = { 'Warm Up': 'warmUp', Transition: 'transition', Peak: 'peak' };
const clients = Array.from({ length: 34 }, (_, i) => ({ artist: `TEST Request ${i}`, song: `Client ${i}` }));
const base = { id: 'A', inputs: { songs: clients, hours: '3.75', buffer: 2, listType: 'dance', expand: true, split: { warmUp: 45, transition: 120, peak: 60 }, genresInput: 'Pop', decades: ['2000s'], bpmRange: [110, 130], danceRange: [6, 10], eventFit: { avoidSlow: true } }, lists: { warmUp: clients.map(s => ({ ...s, fromUpload: true })), transition: [], peak: [], selections: {} } };
const DESPERADO = { artist: 'TEST Eagle Trio', title: 'Desperado Ballad' };
const FAVE = 'TEST Fave Star';
const SYL = ['ka', 'vo', 'rel', 'min', 'tas', 'quo', 'zen', 'bri', 'lux', 'dov', 'hap', 'yer', 'gim', 'sol', 'fen', 'wir', 'nap', 'cue', 'jot', 'pex'];
const SEC_SYL: Record<string, string> = { warmUp: 'Amber', transition: 'Cobalt', peak: 'Scarlet' };
const word = (i: number) => { const a = SYL[i % 20], b = SYL[Math.floor(i / 20) % 20], c = SYL[(i * 7 + 3) % 20]; return (a + b + c).replace(/^./, x => x.toUpperCase()); };
/** Distinct, non-numeric names so the real matcher approves exactly one file (no prefix ambiguity). */
const laneTrack = (k: string, i: number) => ({ artist: `TEST Lane ${SEC_SYL[k]} ${word(i)}`, title: `${word(i * 13 + 5)} ${SEC_SYL[k]} Groove`, filePath: `/synthetic/lane/${k}/${i}.mp3`, genre: 'Pop', songLength: 180 + (i % 5) * 30 });
const shelfTrack = (i: number) => ({ artist: `TEST Shelf ${i}`, title: `Shelf Song ${i}`, filePath: `/synthetic/shelf/${i}.mp3`, genre: 'Pop', bpm: '120', songLength: 180 + (i % 5) * 30 });

function library(laneFiles: number) {
  const lane = sections.flatMap(k => Array.from({ length: laneFiles }, (_, i) => laneTrack(k, i)));
  const shelf = Array.from({ length: 300 }, (_, i) => shelfTrack(i));
  // Favourite-artist songs are not in the library, so only simultaneous suggestion replies can admit them.
  const special = [{ ...DESPERADO, filePath: '/synthetic/special/desperado.mp3', year: '2005', bpm: '120', genre: 'Pop', songLength: 214 }];
  const own = clients.map((c, i) => ({ artist: c.artist, title: c.song, filePath: `/synthetic/client/${i}.mp3`, year: '2005', bpm: '120', genre: 'Pop', songLength: 180 + (i % 5) * 30 }));
  const distractors = Array.from({ length: 37722 - lane.length - shelf.length - special.length - own.length }, (_, i) => ({ artist: `TEST Archive ${i % 5000}`, title: `Archive ${i}`, filePath: `/synthetic/archive/${i}.mp3`, year: '1985', bpm: '100', genre: 'Metal', songLength: 180 + (i % 5) * 30 }));
  const tracks = [...distractors, ...own, ...special, ...shelf, ...lane];
  expect(tracks).toHaveLength(37722);
  return vdj.buildLibrary(tracks);
}
const laneIndex = new Map<string, number>();
for (const k of sections) for (let i = 0; i < 400; i++) { const t = laneTrack(k, i); laneIndex.set(`${t.artist}||${t.title}`, i); }
const P = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).map(k => [k, 'provider']));
/** Realistic per-song provider outcome (never "correct facts for every candidate"). */
function providerFacts(s: { artist: string; song: string }) {
  const full = (o: Record<string, unknown>) => ({ ...s, ...o, source: 'ReccoBeats', prov: P(o) });
  if (s.artist.startsWith('TEST Request')) return full({ energy: 8, danceability: 8, bpm: 120, year: 2005, genre: 'Pop' });
  if (s.artist === DESPERADO.artist) return full({ energy: 2, danceability: 2, year: 2005 });
  if (s.artist === FAVE) return full({ energy: 9, danceability: 8, year: 2005, bpm: 122 });
  const shelf = /^TEST Shelf (\d+)$/.exec(s.artist);
  if (shelf) {
    const c = Number(shelf[1]) % 16;
    if (c === 0) return full({ energy: 8, danceability: 7, year: 2004, genre: 'Pop' });
    if (c <= 8) return full({ year: 1990 + (c % 9), energy: 8, danceability: 8 }); // verified out of decade
    if (c <= 13) return { ...full({ year: 2003 }), incomplete: true }; // verified year, no dance evidence
    return full({ energy: 3, danceability: 3, year: 2006 }); // slow
  }
  const lane = laneIndex.get(`${s.artist}||${s.song}`);
  if (lane !== undefined) {
    // ~80% of linked suggestions verify eligible (live: 55 of 64), with mixed provenance; the rest fail verified
    // decade/BPM, carry verified slow evidence, or stay unresolved (estimates only, never counted as verified).
    const c = lane % 10, odd = lane % 20 >= 10;
    if (c <= 3) return full({ energy: 8, danceability: 8, bpm: 112 + (lane % 15), year: 2000 + c, popularity: 7, genre: 'Pop' });
    if (c === 4) return { ...full({ energy: 8, danceability: 7, bpm: 124, year: 2007 }), incomplete: true }; // partial, sufficient
    if (c === 5) return full({ energy: 7, danceability: 6, bpm: 118, year: 2008 });
    if (c === 6) return full({ energy: 8, danceability: 9, bpm: 128, year: 2009 });
    if (c === 7) return { ...s, energy: 8, danceability: 8, bpm: 121, year: 2006, source: 'ReccoBeats+AI', prov: { energy: 'provider', danceability: 'provider', bpm: 'provider', year: 'provider', popularity: 'ai' }, popularity: 6 };
    if (c === 8) return odd ? full({ energy: 8, danceability: 8, bpm: 120, year: 1997 }) : full({ energy: 3, danceability: 2, bpm: 115, year: 2003 }); // verified decade fail / verified slow
    return odd ? full({ energy: 8, danceability: 8, bpm: 96, year: 2004 }) : { ...s, source: 'none' }; // verified BPM fail / unresolved
  }
  return { ...s, source: 'none' };
}
type Call = { section: string; start: number; end: number; count: number; deadlineMs?: number; existing: number; returned: number; only: number };
type Opts = { mode: 'cold' | 'mixed' | 'warm'; baseline?: boolean; laneFiles?: number; outage?: boolean; failure?: (section: string, n: number) => 'transient' | 'validation' | undefined; favorites?: boolean };

function scenario(o: Opts) {
  const laneFiles = o.laneFiles ?? 200;
  const lib = library(laneFiles);
  const before = JSON.stringify(lib.tracks);
  const calls: Call[] = [], lookups: Array<{ at: number; end: number; songs: string[] }> = [];
  const cursor: Record<string, number> = { 'Warm Up': 0, Transition: 0, Peak: 0 };
  const n: Record<string, number> = { 'Warm Up': 0, Transition: 0, Peak: 0 };
  const suggested: string[] = [];
  const item = (artist: string, song: string) => ({ artist, song, genre: 'Pop', decade: '2000s', year: 2005, energy: 8, danceability: 8, popularity: 8, valence: 7, bpm: 120, reason: 'E8 D8 synthetic estimate' });
  const server = recommendHandler(async (options: any) => {
    const section = /for the "([^"]+)" portion/.exec(options.prompt)![1];
    const count = Number(/Suggest (\d+) real/.exec(options.prompt)![1]);
    const call = n[section]++;
    const mode = o.failure?.(section, call);
    if (mode === 'transient') throw Object.assign(new Error('synthetic gateway busy'), { status: 503 });
    if (mode === 'validation') throw Object.assign(new Error('synthetic validation'), { issues: [] });
    const k = KEY[section];
    const want = Math.min(count, FIRST_CAP[section]);
    const rows: any[] = [];
    const only = /<favorite_artists>([^<]+)<\/favorite_artists>/.exec(options.prompt)?.[1];
    if (only) {
      // Favourite pass: every lane returns the same strong favourite songs at the same moment.
      for (let i = 0; i < Math.min(count, 6); i++) rows.push(item(FAVE, `Fave Song ${k} ${i}`));
      await new Promise(r => setTimeout(r, STARTUP_MS));
      return { stream: rows, stepMs: PER_ITEM[section] };
    }
    // A realistic model estimate for a ballad is low; provider evidence (when reachable) confirms it is slow.
    if (section === 'Peak' && call === 0) rows.push({ ...item(DESPERADO.artist, DESPERADO.title), energy: 4, danceability: 3, reason: 'E4 D3 ballad estimate' });
    for (let j = rows.length; rows.length < want; j++) {
      if (j % 10 === 8) { rows.push(item(`TEST Stranger ${k} ${call}-${j}`, `Unowned ${j}`)); continue; }
      if (j % 10 === 9 && cursor[section] > 0) {
        const last = laneTrack(k, cursor[section] - 1), v = (call + j) % 3;
        rows.push(v === 0 ? item(last.artist, `${last.title} (Live Version)`) : v === 1 ? item(clients[j % 34].artist, clients[j % 34].song) : item(`${last.artist} feat. TEST Guest`, last.title));
        continue;
      }
      if (cursor[section] >= laneFiles) { rows.push(item(`TEST Stranger ${k} ${call}-${j}`, `Unowned ${j}`)); continue; }
      const t = laneTrack(k, cursor[section]++); rows.push(item(t.artist, t.title));
    }
    for (const r of rows) suggested.push(`${r.artist}||${r.song}`);
    await new Promise(r => setTimeout(r, STARTUP_MS));
    return { stream: rows, stepMs: PER_ITEM[section] };
  });
  let seq = 0;
  const warm = (k: string) => o.mode === 'warm' || (o.mode === 'mixed' && !k.startsWith('TEST Lane') && !k.startsWith('TEST Stranger'));
  let deny = false;
  const faveAdmitted = new Set<string>();
  // Every shared ranking call sees the pool: a favourite song admitted anywhere is observed.
  const observeRanking = (args: any[]) => { for (const p of args[0]) if (p?.row?.artist === FAVE && p.row.aiSuggestion) faveAdmitted.add(p.row.song); };
  const h = createHarness({ ...actual, observeRanking, routeSource: o.baseline ? readFileSync('tests/fit/archived/events.new.5e46335.txt', 'utf8') : undefined })({ rows: { A: o.favorites ? { ...structuredClone(base), inputs: { ...structuredClone(base.inputs), artistsInput: FAVE } } : structuredClone(base), B: { ...structuredClone(base), id: 'B' } }, contract: true, services: {
    enrich: async ({ data }: any) => {
      const songs: string[] = data.songs.map(factsKey);
      const entry = { at: Date.now(), end: -1, songs }; lookups.push(entry);
      const expansion = songs.some(k => !k.startsWith('TEST Request'));
      if (o.outage && expansion) await new Promise(() => {});
      const latency = songs.every(warm) ? 300 : COLD[seq++ % COLD.length];
      await new Promise(r => setTimeout(r, latency)); entry.end = Date.now();
      return { results: data.songs.map(providerFacts) };
    },
    recommend: async (request: any) => {
      if (deny) throw new Error('stale request sent');
      const call: Call = { section: request.data.section, start: Date.now(), end: -1, count: request.data.count, deadlineMs: request.data.deadlineMs, existing: request.data.existing.length, returned: 0, only: request.data.onlyArtists?.length ?? 0 };
      calls.push(call);
      try { const reply = await server.call({ data: request.data }); call.returned = reply.suggestions.length; return reply; } finally { call.end = Date.now(); }
    },
  } });
  const seconds = () => sections.map(k => exportReadiness(h.current.result[k].map((song: any, i: number) => ({ song, match: h.current.matches[`${k}:${i}:${dance.dedupeKey(song.artist, song.song)}`] })), lib).knownSec);
  let doneAt = 0;
  const run = async (advance = 300000) => {
    await h.flush(); h.library(lib); await h.flush();
    const t0 = Date.now(); const pending = h.current.generate().then(() => { doneAt = Date.now(); }); await vi.advanceTimersByTimeAsync(advance); await pending; await h.flush();
    return t0;
  };
  return { h, lib, before, calls, lookups, seconds, suggested, faveAdmitted, run, doneAt: () => doneAt, denyLater: () => { deny = true; } };
}
function report(label: string, s: ReturnType<typeof scenario>, t0: number) {
  const first = Math.min(...s.calls.map(c => c.start));
  const last = Math.max(...s.calls.map(c => c.end), ...s.lookups.map(l => l.end));
  const sec = s.seconds();
  const per = Object.fromEntries(['Warm Up', 'Transition', 'Peak'].map(x => [x, s.calls.filter(c => c.section === x).map(c => `${c.count}->${c.returned}@${Math.round((c.start - first) / 100) / 10}s/${Math.round((c.end - c.start) / 100) / 10}s`).join(' ')]));
  if (process.env.COORD_TRACE) console.info(s.lookups.map(l => `${Math.round((l.at - first) / 100) / 10}s+${l.end - l.at}ms ${l.songs.length} ${l.songs.map(k => k.split(' ')[1][0] + (k.includes('Stranger') ? 'X' : '')).join('')}`).join('\n'));
  console.info(`SYNTHETIC ${label}: seconds ${sec.join('/')} (targets ${TARGETS.join('/')}); suggestion calls ${s.calls.length} ${JSON.stringify(per)}; lookups ${s.lookups.length} chunks / ${s.lookups.reduce((a, l) => a + l.songs.length, 0)} songs; work span ${Math.round((last - first) / 100) / 10}s; generate total ${Math.round((s.doneAt() - t0) / 100) / 10}s`);
  return sec;
}
afterEach(() => { vi.useRealTimers(); });

it('baseline 5e46335 (archived route) fails the native-shaped mixed reproduction', async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'mixed', baseline: true });
  const t0 = await s.run();
  const sec = report('baseline mixed', s, t0);
  expect(sec.some((v, i) => v < TARGETS[i])).toBe(true);
  s.h.unmount();
}, 120000);

/** Shared invariants for every repaired run: requests, slow gate, dedupe, verified-only coverage, no mutation. */
function invariants(s: ReturnType<typeof scenario>) {
  const all = sections.flatMap(k => s.h.current.result[k]);
  expect(all.filter((x: any) => x.fromUpload).map(factsKey).sort()).toEqual(clients.map(factsKey).sort());
  expect(all.some((x: any) => x.artist === DESPERADO.artist)).toBe(false);
  // Complete local credit/version dedupe: unique intended identities, no credited or live-version re-entry.
  const intended = new AdditionKeySet(); for (const x of all.filter((y: any) => !y.fromUpload)) expect(intended.tryAdd(x.artist, x.song)).toBe(true);
  expect(all.some((x: any) => x.artist.includes('feat. TEST Guest'))).toBe(false);
  // Counted additions are verified within every strict limit (no estimated lengths/facts, no raw padding).
  for (const k of sections) h_counted(s, k).forEach((x: any) => {
    expect(x.year).toBeGreaterThanOrEqual(2000); expect(x.year).toBeLessThan(2010);
    expect(x.bpm).toBeGreaterThanOrEqual(110); expect(x.bpm).toBeLessThanOrEqual(130);
    expect(['provider', 'tags', 'user', 'measured', 'virtualdj']).toContain(x.metaProv?.year);
    expect(['provider', 'tags', 'user', 'measured', 'virtualdj']).toContain(x.metaProv?.bpm);
  });
  for (const c of s.calls) { expect(c.existing).toBeLessThanOrEqual(500); expect(Number.isInteger(c.deadlineMs)).toBe(true); }
  expect(JSON.stringify(s.lib.tracks)).toBe(s.before);
}
/** Non-request rows that count toward approved known-length coverage. */
function h_counted(s: ReturnType<typeof scenario>, k: (typeof sections)[number]) {
  return s.h.current.result[k].filter((song: any, i: number) => !song.fromUpload && exportReadiness([{ song, match: s.h.current.matches[`${k}:${i}:${dance.dedupeKey(song.artist, song.song)}`] }], s.lib).knownSec > 0);
}

for (const mode of ['mixed', 'warm'] as const) it(`coordinated staging reaches 90/240/120 with a sufficient eligible source (${mode})`, async () => {
  vi.useFakeTimers();
  const s = scenario({ mode });
  const t0 = await s.run();
  const sec = report(`repaired ${mode}`, s, t0);
  sec.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(TARGETS[i]));
  const first = s.calls.slice(0, 3);
  expect(new Set(first.map(c => c.section)).size).toBe(3);
  expect(Math.max(...first.map(c => c.start)) - Math.min(...first.map(c => c.start))).toBeLessThan(1000);
  const warmCalls = s.calls.filter(c => c.section === 'Warm Up'), transition = s.calls.find(c => c.section === 'Transition')!;
  if (mode === 'mixed') {
    // Not a barrier: lookups continue while the 29.6 s Transition reply streams, and Warm Up's next request
    // goes out as soon as its own 12.5 s reply lands instead of waiting for the slowest section.
    expect(s.lookups.some(l => l.at > warmCalls[0].end && l.at < transition.end)).toBe(true);
    expect(warmCalls[1].start - warmCalls[0].end).toBeLessThan(1000);
    expect(warmCalls[1].start).toBeLessThan(transition.end);
  }
  // Generation completes within the fixed expansion window plus request-phase/preparation time.
  expect(s.doneAt() - t0).toBeLessThan(120000);
  // Every request had a useful window at its lane's measured pace and returned songs; none is a tiny batch.
  for (const c of s.calls) { expect(c.returned).toBeGreaterThan(0); expect(c.count).toBeGreaterThanOrEqual(8); }
  invariants(s);
  s.h.unmount();
}, 120000);

it('cold cache: bounded staging is measured and either reaches every target or reports an honest gap', async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'cold' });
  const t0 = await s.run();
  const sec = report('repaired cold', s, t0);
  const short = sec.some((v, i) => v < TARGETS[i]);
  if (short) expect(s.h.warnings.some((m: string) => /Preparation is short/.test(m))).toBe(true);
  else expect(s.h.warnings.some((m: string) => /Preparation is short/.test(m))).toBe(false);
  const first = Math.min(...s.calls.map(c => c.start));
  expect(Math.max(...s.calls.map(c => c.end), ...s.lookups.map(l => l.end)) - first).toBeLessThanOrEqual(90000);
  invariants(s);
  s.h.unmount();
}, 120000);

it('genuinely exhausted source: honest per-section gap, bounded requests and a bounded stop (no padding)', async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'mixed', laneFiles: 12 });
  const t0 = await s.run();
  const sec = report('exhausted source', s, t0);
  expect(sec.some((v, i) => v < TARGETS[i])).toBe(true);
  expect(s.h.warnings.some((m: string) => /Preparation is short/.test(m) && /constraints were not relaxed/.test(m))).toBe(true);
  for (const label of ['Warm Up', 'Transition', 'Peak']) expect(s.calls.filter(c => c.section === label).length).toBeLessThanOrEqual(6);
  const first = Math.min(...s.calls.map(c => c.start));
  expect(Math.max(...s.calls.map(c => c.end), ...s.lookups.map(l => l.end)) - first).toBeLessThanOrEqual(90000);
  invariants(s);
  s.h.unmount();
}, 120000);

it('metadata outage: a hung lookup stops further lookups and suggestions; honest gap, nothing unverified counted', async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'mixed', outage: true });
  const t0 = await s.run();
  const sec = report('metadata outage', s, t0);
  expect(sec.some((v, i) => v < TARGETS[i])).toBe(true);
  // One hung expansion chunk: nothing is queued behind an un-abortable request.
  expect(s.lookups.filter(l => l.songs.some(k => !k.startsWith('TEST Request')))).toHaveLength(1);
  const hung = s.lookups.find(l => l.songs.some(k => !k.startsWith('TEST Request')))!;
  // No suggestion request starts after the lookup deadline exposed the outage (20 s).
  expect(s.calls.every(c => c.start <= hung.at + 20000)).toBe(true);
  expect(s.h.warnings.some((m: string) => /Preparation is short/.test(m))).toBe(true);
  invariants(s);
  s.h.unmount();
}, 120000);

for (const boundary of ['event', 'account'] as const) it(`a ${boundary} switch mid-staging stops every lane and lookup: no late toast, result, save, request or lookup`, async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'mixed' });
  await s.h.flush(); s.h.library(s.lib); await s.h.flush();
  const pending = s.h.current.generate();
  for (let i = 0; i < 200 && !s.calls.some(c => c.section === 'Warm Up' && c.end > 0); i++) await vi.advanceTimersByTimeAsync(250);
  expect(s.calls.some(c => c.section === 'Transition' && c.end < 0)).toBe(true);
  s.h.switchTo(boundary === 'account' ? 'other' : 'owner', boundary === 'event' ? 'B' : 'A'); await s.h.flush();
  const snap = { result: JSON.stringify(s.h.current.result), writes: s.h.requests.length, infos: [...s.h.infos], warnings: [...s.h.warnings], calls: s.calls.length, lookups: s.lookups.length };
  s.denyLater();
  await vi.advanceTimersByTimeAsync(240000); await pending; await s.h.flush();
  expect(s.calls.length).toBe(snap.calls);
  expect(s.lookups.length).toBeLessThanOrEqual(snap.lookups);
  expect(JSON.stringify(s.h.current.result)).toBe(snap.result); expect(s.h.requests).toHaveLength(snap.writes);
  expect(s.h.infos).toEqual(snap.infos); expect(s.h.warnings).toEqual(snap.warnings);
  s.h.unmount();
}, 120000);

it('transient Peak failure retries once in its own lane; a validation failure stops every lane once', async () => {
  vi.useFakeTimers();
  const t = scenario({ mode: 'mixed', failure: (section, n) => section === 'Peak' && n === 0 ? 'transient' : undefined });
  const t0 = await t.run();
  const sec = report('transient Peak', t, t0);
  const peak = t.calls.filter(c => c.section === 'Peak');
  expect(peak[1].start - peak[0].end).toBeGreaterThanOrEqual(1000);
  sec.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(TARGETS[i]));
  invariants(t); t.h.unmount();

  const v = scenario({ mode: 'mixed', failure: (section, n) => section === 'Warm Up' && n === 0 ? 'validation' : undefined });
  await v.run();
  const failedAt = v.calls.find(c => c.section === 'Warm Up')!.end;
  expect(v.calls.filter(c => c.start > failedAt)).toHaveLength(0);
  expect(v.h.infos.filter((m: string) => /did not pass validation/.test(m))).toHaveLength(1);
  invariants(v); v.h.unmount();
}, 120000);

it('simultaneous favourite replies across lanes share the three-track favourite cap', async () => {
  vi.useFakeTimers();
  const s = scenario({ mode: 'mixed', favorites: true });
  const t0 = await s.run();
  report('favourites', s, t0);
  // Every lane's first request was the favourite pass, all three in flight at once.
  const fav = s.calls.filter(c => c.only > 0);
  expect(new Set(fav.slice(0, 3).map(c => c.section)).size).toBe(3);
  expect(Math.max(...fav.slice(0, 3).map(c => c.start)) - Math.min(...fav.slice(0, 3).map(c => c.start))).toBeLessThan(1000);
  // 3 lanes x 6 favourite songs replied; admission recounts shared state after each reply: at most 3 ever ranked.
  expect(fav.reduce((n, c) => n + c.returned, 0)).toBeGreaterThan(3);
  expect(s.faveAdmitted.size).toBeLessThanOrEqual(3); expect(s.faveAdmitted.size).toBeGreaterThan(0);
  const all = sections.flatMap(k => s.h.current.result[k]);
  expect(dance.FAVORITE_ARTIST_CAP).toBe(3);
  expect(all.filter((x: any) => !x.fromUpload && x.artist === FAVE).length).toBeLessThanOrEqual(3);
  invariants(s);
  s.h.unmount();
}, 120000);

it('lane controller: measured pace skips windows that cannot return useful output, sizes counts to the window, sends integer deadlines, and close() aborts quietly', async () => {
  vi.useFakeTimers();
  const { createSuggestionLanes, usefulWindowMs, SUGGESTION_STARTUP_MS, SUGGESTION_MIN_WINDOW_MS } = await import('@/lib/prep/suggestionLanes');
  const sent: Array<{ count: number; deadlineMs: number }> = [];
  const failures: string[] = [];
  let latest = Date.now() + 60000.4; // a fractional dynamic end must still yield whole-millisecond deadlines
  const lanes = createSuggestionLanes<{ count: number; deadlineMs: number }, string>({
    send: async (r, signal) => { sent.push(r); await new Promise((res, rej) => { const t = setTimeout(res, 12536); signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); }); return { suggestions: Array.from({ length: Math.min(15, r.count) }, (_, i) => `s${i}`) }; },
    classify: isolation.suggestionFailure, isCurrent: () => true, end: Date.now() + 90000, latestEnd: () => latest, maxCount: 40,
    onFailure: f => failures.push(f.kind),
  });
  const first = lanes.request('Warm Up', 32, (count, deadlineMs) => ({ count, deadlineMs }));
  await vi.advanceTimersByTimeAsync(12536); expect((await first)?.suggestions).toHaveLength(15);
  expect(Number.isInteger(sent[0].deadlineMs)).toBe(true);
  const pace = lanes.lane('Warm Up').perItemMs!; expect(pace).toBeCloseTo(12536 / 15, 0);
  // Live case: an 8.45 s window at 0.84 s/item cannot return a useful batch after start-up, so nothing is sent.
  expect(usefulWindowMs(pace, 32)).toBeGreaterThan(8452); expect(usefulWindowMs(undefined, 32)).toBe(SUGGESTION_MIN_WINDOW_MS);
  latest = Date.now() + 8452 + 4000;
  expect(await lanes.request('Warm Up', 32, (count, deadlineMs) => ({ count, deadlineMs }))).toBeNull();
  expect(sent).toHaveLength(1); expect(lanes.lane('Warm Up').shortWindow).toBe(true); expect(lanes.open('Warm Up')).toBe(false);
  // A wider window is sized to what the lane's pace can stream within it.
  latest = Date.now() + 20000 + 4000;
  const p = lanes.request('Peak', 40, (count, deadlineMs) => ({ count, deadlineMs }));
  await vi.advanceTimersByTimeAsync(12536); await p;
  latest = Date.now() + 14000 + 4000;
  const sized = lanes.request('Peak', 40, (count, deadlineMs) => ({ count, deadlineMs }));
  await vi.advanceTimersByTimeAsync(10);
  const last = sent.at(-1)!;
  expect(last.count).toBe(Math.floor((last.deadlineMs - SUGGESTION_STARTUP_MS) / lanes.lane('Peak').perItemMs!));
  // close(): the in-flight request resolves null at once, reports nothing, and nothing further is sent.
  lanes.close(); expect(await sized).toBeNull(); expect(failures).toEqual([]);
  const before = sent.length; expect(await lanes.request('Transition', 40, (count, deadlineMs) => ({ count, deadlineMs }))).toBeNull(); expect(sent).toHaveLength(before);
  expect(lanes.inFlight).toBe(0);
});
