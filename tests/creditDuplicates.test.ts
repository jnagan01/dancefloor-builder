import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { additionKeys, parseCredit, versionTitleIdentity, AdditionKeySet } from '@/lib/additionIdentity';
import { createCandidatePool } from '@/lib/prep/candidatePool';
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
    expect(same(['Mark Ronson feat. Bruno Mars', 'Uptown Funk'], ['Bruno Mars feat. Mark Ronson', 'Uptown Funk'])).toBe(true);
    expect(same(['Artist', 'Song - Clean Version'], ['Artist', 'Song [Dirty]'])).toBe(true);
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
    expect(parseCredit('Mark Ronson feat. Bruno Mars')).toEqual({ primary: 'mark ronson', set: ['bruno mars', 'mark ronson'] });
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
describe('ambiguous bands and meaningful title words', () => {
  it('unmarked separators never equate a band with one token or a solo credit', () => {
    expect(same(['Earth, Wind & Fire', 'September'], ['Fire', 'September'])).toBe(false);
    expect(same(['Earth, Wind & Fire', 'September'], ['Earth', 'September'])).toBe(false);
    expect(same(['AC/DC', 'Thunderstruck'], ['AC', 'Thunderstruck'])).toBe(false);
    expect(same(['AC/DC', 'Thunderstruck'], ['DC', 'Thunderstruck'])).toBe(false);
    expect(same(['Simon & Garfunkel', 'Mrs. Robinson'], ['Simon', 'Mrs. Robinson'])).toBe(false);
    expect(same(['Simon & Garfunkel', 'Mrs. Robinson'], ['Garfunkel feat. Someone', 'Mrs. Robinson'])).toBe(false);
    // Documented limitation: unmarked joint credit vs solo is not merged without explicit-credit corroboration.
    expect(same(['Bruno Mars & Mark Ronson', 'Uptown Funk'], ['Mark Ronson', 'Uptown Funk'])).toBe(false);
    expect(same(['Earth, Wind & Fire', 'September'], ['Earth, Wind & Fire', 'September'])).toBe(true);
  });
  it('absorbing an alias does not transitively merge another artist solo recording', () => {
    const k = new AdditionKeySet();
    expect(k.tryAdd('A', 'Song')).toBe(true);
    expect(k.tryAdd('A feat. B', 'Song')).toBe(false);
    expect(k.has('B & A', 'Song')).toBe(true); // full set now corroborated
    expect(k.has('B', 'Song')).toBe(false);
  });
  it('bare title words are kept; only label positions are ignored', () => {
    expect(same(['Michael Jackson', 'Dirty Diana'], ['Michael Jackson', 'Diana'])).toBe(false);
    expect(same(['Wings', 'Live and Let Die'], ['Wings', 'And Let Die'])).toBe(false);
    expect(same(['Artist', 'Clean Bandit'], ['Artist', 'Bandit'])).toBe(false);
    expect(same(['Artist', 'Song (Live)'], ['Artist', 'Song (Clean)'])).toBe(false);
    expect(same(['Artist', 'Song (Clean)'], ['Artist', 'Song'])).toBe(true);
    expect(same(['Artist', 'Song - Radio Edit'], ['Artist', 'Song'])).toBe(true);
  });
});

type PR = { artist: string; song: string; aiReason?: string; aiSuggestion?: boolean; bpm?: number; src?: string };
const ident = (a: string, s: string) => `${a.toLowerCase()}|${s.toLowerCase()}`;
function mkPool(files: Record<string, number>) {
  return createCandidatePool<PR, string>({ cap: 100, taken: () => false, identity: ident, sectionRank: () => 0,
    exactOwned: (r) => files[ident(r.artist, r.song)],
    ownedRow: (i, reason) => ({ artist: `file${i}`, song: 'Uptown Funk', src: 'tags', bpm: 115, aiReason: reason }),
    merge: (a, b) => ({ ...a, bpm: a.bpm ?? b.bpm }) });
}
describe('candidate pool', () => {
  it('promotes the exact owned row regardless of arrival order', () => {
    const ai = { artist: 'Mark Ronson', song: 'Uptown Funk', aiSuggestion: true, aiReason: 'ai' };
    const owned = { artist: 'Mark Ronson feat. Bruno Mars', song: 'Uptown Funk' };
    const files = { [ident(owned.artist, owned.song)]: 3 };
    const p1 = mkPool(files); p1.offer(ai); p1.offer(owned);
    const p2 = mkPool(files); p2.offer(owned); p2.offer(ai);
    const e1 = [...p1.map.values()], e2 = [...p2.map.values()];
    expect(e1).toHaveLength(1);
    expect(e1[0]).toMatchObject({ trackIdx: 3, row: { artist: 'file3', src: 'tags', bpm: 115, aiSuggestion: true, aiReason: 'ai' } });
    expect(e2[0]).toEqual(e1[0]);
  });
  it('non-owned representative is order independent; lower owned index wins', () => {
    const a = { artist: 'Mark Ronson', song: 'Uptown Funk' }, b = { artist: 'Mark Ronson ft. Bruno Mars', song: 'Uptown Funk', bpm: 115 };
    const p1 = mkPool({}); p1.offer(a); p1.offer(b);
    const p2 = mkPool({}); p2.offer(b); p2.offer(a);
    expect([...p1.map.values()][0].row).toEqual([...p2.map.values()][0].row);
    const f = { [ident(a.artist, a.song)]: 7, [ident(b.artist, b.song)]: 2 };
    const p3 = mkPool(f); p3.offer(a); p3.offer(b); const p4 = mkPool(f); p4.offer(b); p4.offer(a);
    expect([...p3.map.values()][0].trackIdx).toBe(2); expect([...p4.map.values()][0].trackIdx).toBe(2);
  });
  it('alias pool larger than slots stays unique before ranking', () => {
    const p = mkPool({});
    for (let i = 0; i < 10; i++) { p.offer({ artist: `Artist ${i}`, song: `Song ${i}` }); p.offer({ artist: `Artist ${i} feat. Guest`, song: `Song ${i}` }); }
    expect(p.map.size).toBe(10);
    p.offer({ artist: 'Artist 1', song: 'Song 1 (Live)' }); expect(p.map.size).toBe(11);
  });
});

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
      { artist: 'Mark Ronson ft. Bruno Mars', song: 'Uptown Funk', fromUpload: false },
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
async function runFull(requests: Row[], suggestions: ReturnType<typeof sug>[], peakRequests: Row[] = []) {
  const h = harness({ rows: { A: { id: 'A', name: 'S', updated_at: 'v1', inputs: { songs: [...requests, ...peakRequests], hours: '1', buffer: 1, listType: 'dance', expand: true }, lists: { warmUp: [...requests], transition: [], peak: [...peakRequests] } } }, services: { recommend: async () => ({ suggestions }) } });
  await h.flush(); await h.current.generate(); await h.flush();
  const res = h.current.result;
  const rows = [...res.warmUp, ...res.transition, ...res.peak] as Row[];
  h.unmount(); return { rows, duplicatesRemoved: res.duplicatesRemoved as number };
}
async function run(requests: Row[], suggestions: ReturnType<typeof sug>[]) { return (await runFull(requests, suggestions)).rows; }
describe('real event route', () => {
  it('no library: request + AI credit alias -> one requested row', async () => {
    const rows = await run([{ artist: 'Mark Ronson feat. Bruno Mars', song: 'Uptown Funk', fromUpload: true }], [sug('Mark Ronson', 'Uptown Funk'), sug('Bruno Mars feat. Mark Ronson', 'Uptown Funk')]);
    const uf = rows.filter(r => /uptown funk/i.test(r.song));
    expect(uf).toEqual([expect.objectContaining({ artist: 'Mark Ronson feat. Bruno Mars', fromUpload: true })]);
  });
  it('AI aliases collapse in the pool before slots; remix kept; unrelated same title kept', async () => {
    const rows = await run([{ artist: 'Queen', song: 'Radio Ga Ga', fromUpload: true }], [sug('Mark Ronson', 'Uptown Funk'), sug('Mark Ronson ft. Bruno Mars', 'Uptown Funk'), sug('Queen', 'Radio Ga Ga (Live Aid)'), sug('Queen feat. Guest', 'Radio Ga Ga'), sug('Adele', 'Hello'), sug('Lionel Richie', 'Hello')]);
    const added = rows.filter(r => !r.fromUpload).map(r => `${r.artist}|${r.song}`);
    expect(added.filter(a => /\|Uptown Funk$/.test(a))).toHaveLength(1);
    expect(added).toContain('Queen|Radio Ga Ga (Live Aid)');
    expect(added).not.toContain('Queen feat. Guest|Radio Ga Ga');
    expect(added).toEqual(expect.arrayContaining(['Adele|Hello', 'Lionel Richie|Hello']));
    expect(rows.filter(r => r.fromUpload)).toHaveLength(1);
  });
  it('alias pool larger than slots: every slot gets the next distinct candidate, no late cleanup', async () => {
    const req = [{ artist: 'Req', song: 'Requested', fromUpload: true }];
    const many = Array.from({ length: 80 }, (_, i) => sug(`Band ${i}`, `Track ${i}`));
    const slots = (await run(req, many)).filter(r => !r.fromUpload).length;
    expect(slots).toBeGreaterThan(2);
    const aliased = Array.from({ length: slots }, (_, i) => [sug(`Band ${i} feat. Guest ${i}`, `Track ${i}`), sug(`Band ${i}`, `Track ${i}`)]).flat();
    const { rows, duplicatesRemoved } = await runFull(req, aliased);
    const added = rows.filter(r => !r.fromUpload);
    expect(added).toHaveLength(slots);
    expect(new Set(added.map(r => r.song.toLowerCase())).size).toBe(slots);
    expect(duplicatesRemoved).toBe(0);
  });
  it('same-artist original and distinct live/remix both remain; both request credits kept across sections', async () => {
    const { rows } = await runFull([{ artist: 'Mark Ronson', song: 'Uptown Funk', fromUpload: true }],
      [sug('Mark Ronson', 'Valerie'), sug('Mark Ronson', 'Valerie (Live)'), sug('Mark Ronson', 'Valerie (Version Remix)'), sug('Mark Ronson ft. Bruno Mars', 'Uptown Funk')],
      [{ artist: 'Mark Ronson feat. Bruno Mars', song: 'Uptown Funk', fromUpload: true }]);
    const added = rows.filter(r => !r.fromUpload).map(r => r.song);
    expect(added).toEqual(expect.arrayContaining(['Valerie', 'Valerie (Live)', 'Valerie (Version Remix)']));
    expect(added).not.toContain('Uptown Funk');
    expect(rows.filter(r => r.fromUpload).map(r => r.artist).sort()).toEqual(['Mark Ronson', 'Mark Ronson feat. Bruno Mars']);
  });
});
