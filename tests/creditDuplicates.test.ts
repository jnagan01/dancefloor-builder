import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { additionKeys, creditNames, versionTitleIdentity, AdditionKeySet } from '@/lib/additionIdentity';
import { SongKeySet, dedupeKey, type GenerationResult } from '@/lib/danceFloor';
import { preventAutomaticDuplicates } from '@/lib/preparationDuplicates';
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
const require = createRequire(import.meta.url);
const policy = require('../desktop/offline/policy.cjs');

const same = (a: [string, string], b: [string, string]) => { const s = new SongKeySet(true); s.add(...a); return s.has(...b); };

describe('shared automatic-addition identity', () => {
  it('equivalent credits collapse', () => {
    expect(same(['Mark Ronson feat. Bruno Mars', 'Uptown Funk'], ['Mark Ronson', 'Uptown Funk'])).toBe(true);
    expect(same(['Mark Ronson', 'Uptown Funk'], ['Mark Ronson ft. Bruno Mars', 'Uptown Funk'])).toBe(true);
    expect(same(['Bruno Mars & Mark Ronson', 'Uptown Funk'], ['Mark Ronson featuring Bruno Mars', 'Uptown Funk'])).toBe(true);
    expect(same(['Mark Ronson, Bruno Mars', 'Uptown Funk'], ['Bruno Mars x Mark Ronson', 'Uptown Funk!'])).toBe(true);
    expect(same(['Beyoncé with Jay-Z', 'Crazy in Love'], ['Beyonce', 'Crazy In Love'])).toBe(true);
    expect(same(['Mark Ronson', 'Uptown Funk (feat. Bruno Mars)'], ['Mark Ronson', 'Uptown Funk'])).toBe(true);
    expect(same(['Mark Ronson', 'Mark Ronson - Uptown Funk'], ['Mark Ronson', 'Uptown Funk'])).toBe(true);
    expect(same(['Artist', 'Song (Clean)'], ['Artist', 'Song (Radio Edit)'])).toBe(true);
  });
  it('versions, covers and unrelated artists stay distinct', () => {
    for (const v of ['Song (Tiesto Remix)', 'Song (Live)', 'Song - Acoustic', 'Song (Extended Mix)', 'Song (Club Edit)'])
      expect(same(['Artist', 'Song'], ['Artist', v])).toBe(false);
    expect(same(['Artist', 'Song (Tiesto Remix)'], ['Artist', 'Song (David Guetta Remix)'])).toBe(false);
    expect(same(['Adele', 'Hello'], ['Adele Roberts', 'Hello'])).toBe(false);
    expect(same(['Lionel Richie', 'Hello'], ['Adele', 'Hello'])).toBe(false);
    expect(same(['Malcolm X', 'Song'], ['Malcolm', 'Song'])).toBe(false);
    expect(versionTitleIdentity('A', 'Song (Acoustic)')).toBe('song acoustic');
    expect(creditNames('Mark Ronson feat. Bruno Mars')).toEqual(['mark ronson', 'bruno mars']);
    expect(additionKeys('A', '')).toEqual([]);
  });
  it('saved/legacy identities and clean-policy matching are unchanged', () => {
    expect(dedupeKey('Mark Ronson feat. Bruno Mars', 'Uptown Funk')).toBe(dedupeKey('Mark Ronson feat. Bruno Mars', 'Uptown Funk'));
    expect(policy.intendedKey({ artist: 'Mark Ronson feat. Bruno Mars', song: 'Uptown Funk' })).not.toBe(policy.intendedKey({ artist: 'Mark Ronson', song: 'Uptown Funk' }));
    const tracks = [{ artist: 'Mark Ronson', title: 'Uptown Funk', filePath: '/m/u.mp3' }];
    expect(policy.buildResolver(tracks).resolve({ artist: 'Mark Ronson feat. Bruno Mars', song: 'Uptown Funk' })).toBeUndefined();
    const k = new AdditionKeySet(); k.add('A', 'B', 'tag'); expect(k.match('A ft. C', 'B')).toBe('tag');
  });
});

const empty = (): GenerationResult => ({ warmUp: [], transition: [], peak: [], perSectionTarget: 5, duplicatesRemoved: 0 } as unknown as GenerationResult);
describe('preventAutomaticDuplicates', () => {
  it('requests win regardless of section order; automatic aliases removed with counts', () => {
    const r = { ...empty(), warmUp: [{ artist: 'Mark Ronson', song: 'Uptown Funk', fromUpload: false }], peak: [{ artist: 'Mark Ronson feat. Bruno Mars', song: 'Uptown Funk', fromUpload: true }, { artist: 'Mark Ronson ft Bruno Mars', song: 'Uptown Funk', fromUpload: true }] } as GenerationResult;
    const out = preventAutomaticDuplicates(r, () => undefined);
    expect(out.warmUp).toEqual([]);
    expect(out.peak).toHaveLength(2); // both explicit request variants retained
    expect(out.duplicatesRemoved).toBe(1);
  });
  it('two AI aliases without files collapse; versions kept; distinct-case paths stay distinct', () => {
    const r = { ...empty(), warmUp: [
      { artist: 'Mark Ronson', song: 'Uptown Funk', fromUpload: false },
      { artist: 'Bruno Mars & Mark Ronson', song: 'Uptown Funk', fromUpload: false },
      { artist: 'Mark Ronson', song: 'Uptown Funk (Live)', fromUpload: false },
      { artist: 'X', song: 'One', fromUpload: false }, { artist: 'Y', song: 'Two', fromUpload: false },
    ] } as GenerationResult;
    const paths: Record<string, string> = { One: '/m/Track.mp3', Two: '/m/track.mp3' };
    const out = preventAutomaticDuplicates(r, s => paths[s.song]);
    expect(out.warmUp.map(s => s.song)).toEqual(['Uptown Funk', 'Uptown Funk (Live)', 'One', 'Two']);
    expect(out.duplicatesRemoved).toBe(1);
  });
});

const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });
type Row = { artist: string; song: string; fromUpload?: boolean };
const sug = (artist: string, song: string) => ({ artist, song, energy: 7, danceability: 7, valence: 7, reason: 'synthetic' });
async function run(requests: Row[], suggestions: ReturnType<typeof sug>[]) {
  const h = harness({ rows: { A: { id: 'A', name: 'S', updated_at: 'v1', inputs: { songs: requests, hours: '1', buffer: 1, listType: 'dance', expand: true }, lists: { warmUp: [...requests], transition: [], peak: [] } } }, services: { recommend: async () => ({ suggestions }) } });
  await h.flush(); await h.current.generate(); await h.flush();
  const rows = [...h.current.result.warmUp, ...h.current.result.transition, ...h.current.result.peak] as Row[];
  h.unmount(); return rows;
}
describe('real event route', () => {
  it('no library: request + AI credit alias -> one requested row', async () => {
    const rows = await run([{ artist: 'Mark Ronson feat. Bruno Mars', song: 'Uptown Funk', fromUpload: true }], [sug('Mark Ronson', 'Uptown Funk'), sug('Bruno Mars & Mark Ronson', 'Uptown Funk')]);
    const uf = rows.filter(r => /uptown funk/i.test(r.song));
    expect(uf).toEqual([expect.objectContaining({ artist: 'Mark Ronson feat. Bruno Mars', fromUpload: true })]);
  });
  it('AI aliases collapse in the pool before slots; remix kept; unrelated same title kept', async () => {
    const rows = await run([{ artist: 'Queen', song: 'Radio Ga Ga', fromUpload: true }], [sug('Mark Ronson', 'Uptown Funk'), sug('Mark Ronson ft. Bruno Mars', 'Uptown Funk'), sug('Mark Ronson', 'Uptown Funk (Live)'), sug('Adele', 'Hello'), sug('Lionel Richie', 'Hello')]);
    const added = rows.filter(r => !r.fromUpload).map(r => `${r.artist}|${r.song}`);
    expect(added.filter(a => /\|Uptown Funk$/.test(a))).toHaveLength(1);
    console.log('ADDED', JSON.stringify(added));
    expect(added).toContain('Mark Ronson|Uptown Funk (Live)');
    expect(added).toEqual(expect.arrayContaining(['Adele|Hello', 'Lionel Richie|Hello']));
    expect(rows.filter(r => r.fromUpload)).toHaveLength(1);
  });
});
