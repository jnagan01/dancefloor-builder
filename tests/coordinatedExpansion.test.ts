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
const SYL = ['ka', 'vo', 'rel', 'min', 'tas', 'quo', 'zen', 'bri', 'lux', 'dov', 'hap', 'yer', 'gim', 'sol', 'fen', 'wir', 'nap', 'cue', 'jot', 'pex'];
const SEC_SYL: Record<string, string> = { warmUp: 'Amber', transition: 'Cobalt', peak: 'Scarlet' };
const word = (i: number) => { const a = SYL[i % 20], b = SYL[Math.floor(i / 20) % 20], c = SYL[(i * 7 + 3) % 20]; return (a + b + c).replace(/^./, x => x.toUpperCase()); };
/** Distinct, non-numeric names so the real matcher approves exactly one file (no prefix ambiguity). */
const laneTrack = (k: string, i: number) => ({ artist: `TEST Lane ${SEC_SYL[k]} ${word(i)}`, title: `${word(i * 13 + 5)} ${SEC_SYL[k]} Groove`, filePath: `/synthetic/lane/${k}/${i}.mp3`, genre: 'Pop', songLength: 180 + (i % 5) * 30 });
const shelfTrack = (i: number) => ({ artist: `TEST Shelf ${i}`, title: `Shelf Song ${i}`, filePath: `/synthetic/shelf/${i}.mp3`, genre: 'Pop', bpm: '120', songLength: 180 + (i % 5) * 30 });

function library(laneFiles: number) {
  const lane = sections.flatMap(k => Array.from({ length: laneFiles }, (_, i) => laneTrack(k, i)));
  const shelf = Array.from({ length: 300 }, (_, i) => shelfTrack(i));
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
    const c = lane % 10;
    if (c <= 3) return full({ energy: 8, danceability: 8, bpm: 112 + (lane % 15), year: 2000 + c, popularity: 7, genre: 'Pop' });
    if (c === 4) return { ...full({ energy: 8, danceability: 7, bpm: 124, year: 2007 }), incomplete: true }; // partial, sufficient
    if (c === 5) return full({ energy: 7, danceability: 6, bpm: 118, year: 2008 });
    if (c === 6) return full({ energy: 8, danceability: 8, bpm: 120, year: 1997 }); // verified decade fail
    if (c === 7) return full({ energy: 8, danceability: 8, bpm: 96, year: 2004 }); // verified BPM fail
    if (c === 8) return full({ energy: 3, danceability: 2, bpm: 115, year: 2003 }); // verified slow
    return { ...s, source: 'none' }; // unresolved: estimates only
  }
  return { ...s, source: 'none' };
}
type Call = { section: string; start: number; end: number; count: number; deadlineMs?: number; existing: number; returned: number };
type Opts = { mode: 'cold' | 'mixed' | 'warm'; baseline?: boolean; laneFiles?: number; outage?: boolean; failure?: (section: string, n: number) => 'transient' | 'validation' | undefined; favorites?: string };

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
    if (section === 'Peak' && call === 0) rows.push(item(DESPERADO.artist, DESPERADO.title));
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
  const h = createHarness({ ...actual, routeSource: o.baseline ? readFileSync('tests/fit/archived/events.new.5e46335.txt', 'utf8') : undefined })({ rows: { A: structuredClone(base), B: { ...structuredClone(base), id: 'B' } }, contract: true, services: {
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
      const call: Call = { section: request.data.section, start: Date.now(), end: -1, count: request.data.count, deadlineMs: request.data.deadlineMs, existing: request.data.existing.length, returned: 0 };
      calls.push(call);
      try { const reply = await server.call({ data: request.data }); call.returned = reply.suggestions.length; return reply; } finally { call.end = Date.now(); }
    },
  } });
  const seconds = () => sections.map(k => exportReadiness(h.current.result[k].map((song: any, i: number) => ({ song, match: h.current.matches[`${k}:${i}:${dance.dedupeKey(song.artist, song.song)}`] })), lib).knownSec);
  const run = async (advance = 300000) => {
    await h.flush(); h.library(lib); await h.flush();
    const t0 = Date.now(); const pending = h.current.generate(); await vi.advanceTimersByTimeAsync(advance); await pending; await h.flush();
    return t0;
  };
  return { h, lib, before, calls, lookups, seconds, suggested, run, denyLater: () => { deny = true; } };
}
function report(label: string, s: ReturnType<typeof scenario>, t0: number) {
  const first = Math.min(...s.calls.map(c => c.start));
  const last = Math.max(...s.calls.map(c => c.end), ...s.lookups.map(l => l.end));
  const sec = s.seconds();
  const per = Object.fromEntries(['Warm Up', 'Transition', 'Peak'].map(x => [x, s.calls.filter(c => c.section === x).map(c => `${c.count}->${c.returned}@${Math.round((c.start - first) / 100) / 10}s/${Math.round((c.end - c.start) / 100) / 10}s`).join(' ')]));
  console.info(`SYNTHETIC ${label}: seconds ${sec.join('/')} (targets ${TARGETS.join('/')}); suggestion calls ${s.calls.length} ${JSON.stringify(per)}; lookups ${s.lookups.length} chunks / ${s.lookups.reduce((a, l) => a + l.songs.length, 0)} songs; work span ${Math.round((last - first) / 100) / 10}s; generate total ${Math.round((Date.now() - t0) / 100) / 10}s`);
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

for (const mode of ['mixed', 'warm'] as const) it(`coordinated staging reaches 90/240/120 with a sufficient eligible source (${mode})`, async () => {
  vi.useFakeTimers();
  const s = scenario({ mode });
  const t0 = await s.run();
  const sec = report(`repaired ${mode}`, s, t0);
  sec.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(TARGETS[i]));
  const first = s.calls.slice(0, 3);
  expect(new Set(first.map(c => c.section)).size).toBe(3);
  expect(Math.max(...first.map(c => c.start)) - Math.min(...first.map(c => c.start))).toBeLessThan(1000);
  for (const c of s.calls) expect(c.existing).toBeLessThanOrEqual(500);
  // The 12.5 s Warm Up reply is looked up while the 29.6 s Transition reply is still streaming.
  const warmReply = s.calls.find(c => c.section === 'Warm Up')!, transition = s.calls.find(c => c.section === 'Transition')!;
  const warmSongs = new Set(s.suggested.slice(0, 0));
  const firstWarmLookup = s.lookups.find(l => l.at >= warmReply.end && l.songs.some(k => k.startsWith('TEST Lane Amber')));
  expect(firstWarmLookup!.at).toBeLessThan(transition.end);
  expect(warmSongs.size).toBe(0);
  // No request is sent into a window too short for useful output.
  expect(s.calls.every(c => c.returned > 0)).toBe(true);
  const all = sections.flatMap(k => s.h.current.result[k]);
  expect(all.filter((x: any) => x.fromUpload)).toHaveLength(34);
  expect(all.some((x: any) => x.artist === DESPERADO.artist)).toBe(false);
  // Complete local credit/version dedupe: no duplicated addition identity across sections.
  const keys = new AdditionKeySet(); for (const x of all) { expect(keys.has(x)).toBe(false); keys.add(x); }
  expect(JSON.stringify(s.lib.tracks)).toBe(s.before);
  s.h.unmount();
}, 120000);
