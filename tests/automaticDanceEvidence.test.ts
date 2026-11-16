import { it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import * as vdj from '@/lib/virtualDj'; import * as dance from '@/lib/danceFloor'; import * as audio from '@/lib/audioMatch'; import * as snapshots from '@/lib/snapshotSafety'; import * as drafts from '@/lib/eventDrafts'; import * as input from '@/lib/inputSafety'; import * as autosave from '@/lib/eventAutosave'; import * as vibes from '@/lib/vibes'; import * as isolation from '@/lib/workflowIsolation'; import * as theory from '@/lib/musicTheory'; import * as revisions from '@/lib/eventRevision';
import { automaticDanceFailure, fitFactsFromRow, type FitFacts } from '@/lib/prep/eventFit';
import { mergeMeta, decodeCacheSource } from '@/lib/prep/provenance';
import { parseCommunityTrackInfo } from '@/lib/prep/communityEvidence';
import { baselineDanceFailure } from './fit/archived/automaticDance.9780e18';
import { rankPool } from '@/lib/prep/recommend';
import { rowCandidate } from '@/lib/prep/expansionRanking';
const row = { artist: 'Rihanna', song: 'Desperado (Clean)', fromUpload: false, bpm: 126, year: 2016, energy: 6, danceability: 7, valence: 4, popularity: 7, metaSource: 'Estimated', metaProv: { bpm: 'tags', year: 'tags', energy: 'estimate', danceability: 'estimate', popularity: 'estimate' } as const };
const fit = { avoidSlow: true };
const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });
afterEach(() => vi.useRealTimers());
it('observed heuristic 6/7 passes frozen gate but is withheld now, including cached provider-looking legacy labels', () => {
  const facts = fitFactsFromRow(row);
  expect(baselineDanceFailure(fit, facts)).toBeUndefined();
  expect(automaticDanceFailure(fit, facts)).toMatch(/withheld/);
  const cached = decodeCacheSource('ReccoBeats+AI', row);
  expect(automaticDanceFailure(fit, fitFactsFromRow({ ...row, metaProv: cached.prov }))).toMatch(/withheld/);
  expect(automaticDanceFailure(undefined, facts)).toBeUndefined();
});
it('recording-aware AI upgrades heuristics, never tags/provider/curation; partials never erase fields', () => {
  const ai = mergeMeta(row, { energy: 2, danceability: 3 }, 'ai');
  expect(ai).toMatchObject({ energy: 2, danceability: 3, bpm: 126, year: 2016, metaProv: { energy: 'ai', bpm: 'tags' } });
  expect(automaticDanceFailure(fit, fitFactsFromRow(ai))).toMatch(/withheld/);
  const provider = mergeMeta(ai, { energy: 8, danceability: 8 }, 'provider');
  expect(automaticDanceFailure(fit, fitFactsFromRow(provider))).toBeUndefined();
  expect(mergeMeta(provider, { energy: 9 }, 'ai')).toBe(provider);
  expect(mergeMeta(row, { bpm: 100, year: 2004 }, 'ai').bpm).toBe(126);
  expect(mergeMeta({ energy: 6, metaProv: { energy: 'catalogue' } }, { energy: 9 }, 'ai').energy).toBe(6);
});
it.each(['provider', 'tags', 'measured', 'user', 'virtualdj'] as const)('strong %s dance evidence supports lower-energy grooves without BPM classification; slow conflict vetoes', source => {
  const f: FitFacts = { energy: 4, energySource: source, danceability: 8, danceabilitySource: source };
  expect(automaticDanceFailure(fit, f)).toBeUndefined();
  expect(automaticDanceFailure(fit, { ...f, energy: 8, danceability: 3 })).toMatch(/withheld/);
  expect(automaticDanceFailure(fit, { ...f, energy: 3, community: { source: 'lastfm', slowTags: [], upbeatTags: ['dance'] } })).toMatch(/withheld/);
});
it('AI is advisory positive support only with a corroborating high pair; incomplete/heuristic fields cannot rescue', () => {
  expect(automaticDanceFailure(fit, { energy: 6, energySource: 'ai', danceability: 7, danceabilitySource: 'ai' })).toMatch(/withheld/);
  expect(automaticDanceFailure(fit, { energy: 8, energySource: 'ai', danceability: 8, danceabilitySource: 'ai' })).toBeUndefined();
  expect(automaticDanceFailure(fit, { energy: 8, energySource: 'ai', danceability: 8, danceabilitySource: 'estimate' })).toMatch(/withheld/);
  expect(automaticDanceFailure(fit, { energy: 9, energySource: 'provider' })).toMatch(/withheld/);
});
it('only exact community tags support fit; remix evidence and mixed slow/upbeat tags cannot rescue', () => {
  const body = (name: string, tags: string[]) => ({ track: { name, artist: { name: 'Rihanna' }, listeners: '10000', toptags: { tag: tags.map(name => ({ name })) } } });
  const cm = parseCommunityTrackInfo(body('Desperado', ['dance']), row.artist, row.song);
  expect(automaticDanceFailure(fit, { ...fitFactsFromRow(row), community: cm })).toBeUndefined();
  expect(parseCommunityTrackInfo(body('Desperado (Club Remix)', ['dance']), row.artist, row.song)).toBeUndefined();
  const mixed = parseCommunityTrackInfo(body('Desperado', ['dance', 'ballad']), row.artist, row.song);
  expect(automaticDanceFailure(fit, { energy: 9, danceability: 9, energySource: 'provider', danceabilitySource: 'provider', community: mixed })).toMatch(/Conflicting/);
});
it('shared final ranking admits exact supported variant and low-BPM dance, not the heuristic original or credited repeat', () => {
  const rows = [row, { ...row, song: 'Desperado (Club Remix)', energy: 8, danceability: 8, metaProv: { energy: 'provider', danceability: 'provider' } },
    { artist: 'Groove Artist', song: 'Lower Tempo Dance', bpm: 90, energy: 4, danceability: 8, metaProv: { energy: 'provider', danceability: 'provider' } }];
  const out = rankPool(rows, r => rowCandidate(r as any, 'library'), { requests: [], inEvent: [], feedback: [], dismissed: [], preferences: { fit }, automaticExpansion: true });
  expect(out.map(r => r.item.song).sort()).toEqual(['Desperado (Club Remix)', 'Lower Tempo Dance']);
  const credited = rankPool([{ ...rows[1], artist: 'Rihanna feat. Guest' }], r => rowCandidate(r as any, 'library'), { requests: [], inEvent: [{ artist: 'Rihanna feat. Guest', song: rows[1].song }], feedback: [], dismissed: [], preferences: { fit }, automaticExpansion: true });
  expect(credited).toEqual([]);
});
async function route(policy: boolean, baseline = false, requested = false) {
  const inputs = { songs: requested ? [{ artist: row.artist, song: row.song }] : [{ artist: 'Rihanna', song: 'We Found Love' }], hours: '1', buffer: 1, split: { warmUp: 20, transition: 20, peak: 20 }, listType: 'dance', expand: true, decades: ['2000s', '2010s'], bpmRange: [85, 130], danceRange: [6, 10], eventFit: { avoidSlow: policy } };
  const lists = { warmUp: [row], transition: [], peak: [], selections: {} };
  const original = JSON.stringify({ inputs, lists });
  const h = harness({ rows: { A: { id: 'A', inputs, lists } }, contract: true, services: { enrich: async ({ data }: any) => ({ results: data.songs.map((s: any) => s.song === row.song ? { ...s, ...row, prov: row.metaProv, source: 'cache' } : { ...s, source: 'none' }) }), recommend: async () => ({ suggestions: [] }) } });
  const originalGate = h.prepModule('eventFit').automaticDanceFailure;
  if (baseline) h.prepModule('eventFit').automaticDanceFailure = baselineDanceFailure;
  await h.flush(); const lib = vdj.buildLibrary([{ artist: row.artist, title: row.song, filePath: '/synthetic/desperado.mp3', bpm: '126', year: '2016', songLength: 240 }]); h.library(lib); await h.flush();
  expect(h.current.result.warmUp).toEqual([row]); expect(h.requests).toEqual([]);
  const before = JSON.stringify(lib.tracks); let done = false;
  const work = h.current.generate().finally(() => { done = true; });
  for (let i = 0; i < 120 && !done; i++) await vi.advanceTimersByTimeAsync(1000);
  expect(done).toBe(true); await work; await h.flush();
  const all = ['warmUp', 'transition', 'peak'].flatMap(k => h.current.result[k]);
  expect(JSON.stringify(lib.tracks)).toBe(before); expect(JSON.stringify({ inputs, lists })).toBe(original);
  h.prepModule('eventFit').automaticDanceFailure = originalGate;
  h.unmount(); return { all, warnings: h.warnings };
}
it('actual route baseline admits observed row; fresh repair excludes all sections, preserves requests and passive saved membership, off remains opt-in', async () => {
  vi.useFakeTimers();
  expect((await route(true, true)).all.some(s => s.song === row.song && !s.fromUpload)).toBe(true);
  const after = await route(true); expect(after.all.some(s => s.song === row.song)).toBe(false); expect(after.warnings.join(' ')).toMatch(/Preparation is short|withheld/);
  expect((await route(false)).all.some(s => s.song === row.song)).toBe(true);
  expect((await route(true, false, true)).all.some(s => s.song === row.song && s.fromUpload)).toBe(true);
}, 20000);