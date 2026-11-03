import { describe, it, expect } from 'vitest';
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
const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });

// Synthetic, isolated fixtures only. Real event route; network services are fakes.
type Row = { artist: string; song: string; fromUpload?: boolean; rankWhy?: string; metaSource?: string; year?: number };
const requests = [{ artist: 'Queen', song: 'Radio Ga Ga', fromUpload: true }, { artist: 'ABBA', song: 'Dancing Queen', fromUpload: true }];
const row = (inputs: Record<string, unknown> = {}) => ({ id: 'A', name: 'Synthetic', updated_at: 'v1', inputs: { songs: requests, hours: '1', buffer: 2, listType: 'dance', expand: true, ...inputs }, lists: { warmUp: [...requests], transition: [], peak: [] } });
const sug = (artist: string, song: string) => ({ artist, song, energy: 7, danceability: 7, valence: 7, reason: 'synthetic AI reason' });
const all = (r: { warmUp: Row[]; transition: Row[]; peak: Row[] }) => [...r.warmUp, ...r.transition, ...r.peak];
// 12 weak neighbour artists × 6 owned tracks: far more weakly-supported library candidates than open slots.
const weakArtists = Array.from({ length: 12 }, (_, i) => `Weak Act ${String.fromCharCode(65 + i)}`);
const weakLibrary = vdj.buildLibrary(weakArtists.flatMap(a => Array.from({ length: 6 }, (_, j) => ({ filePath: `/synthetic/${a}/${j}.mp3`, artist: a, title: `Weak Song ${j}`, year: '1990', genre: 'Rock' }))) as vdj.VdjTrack[]);
const weakCrowd = (reverse = false) => async () => {
  const similar = weakArtists.map(name => ({ name, match: 0.1 }));
  return { available: true, artists: [{ name: 'Queen', listeners: 1, tags: [], similar: reverse ? [...similar].reverse() : similar }] };
};
async function run(services: Record<string, unknown>, opts: { library?: unknown; inputs?: Record<string, unknown>; prep?: (h: any) => unknown } = {}) {
  const h = harness({ rows: { A: row(opts.inputs) }, services });
  if (opts.prep) h.setPrep((s: object) => ({ ...s, knowledge: opts.prep!(h) }));
  await h.flush(); if (opts.library) { h.library(opts.library); await h.flush(); }
  await h.current.generate(); await h.flush();
  const rows = all(h.current.result) as Row[];
  h.unmount();
  return rows;
}

describe('real event route: one ranking over all available candidates', () => {
  it('a later, stronger AI candidate beats weaker earlier library candidates; no quota or arrival order decides', async () => {
    const rows = await run({ crowd: weakCrowd(), recommend: async () => ({ suggestions: [sug('Queen', 'Strong Synthetic')] }) }, { library: weakLibrary });
    const added = rows.filter(t => !t.fromUpload);
    console.log('DBG', added.length, added.filter(t=>t.artist.startsWith('Weak')).length, added.filter(t=>t.metaSource!=='AI').length);
    expect(added.map(t => t.song)).toContain('Strong Synthetic');
    expect(added.find(t => t.song === 'Strong Synthetic')!.rankWhy).toMatch(/Same artist as client request/);
    const weak = added.filter(t => t.artist.startsWith('Weak Act'));
    expect(weak.length).toBeGreaterThan(0);
    expect(weak.length).toBeLessThan(72); // pool exceeded the room; ranking chose, nothing was padded
    expect(weak.every(t => /artist-level/.test(t.rankWhy ?? ''))).toBe(true);
  });

  it('selection is stable regardless of provider arrival order', async () => {
    const a = await run({ crowd: weakCrowd(false), recommend: async () => ({ suggestions: [sug('Queen', 'Strong Synthetic'), sug('Plain Act', 'Plain One'), sug('Plain Act', 'Plain Two')] }) }, { library: weakLibrary });
    const b = await run({ crowd: weakCrowd(true), recommend: async () => ({ suggestions: [sug('Plain Act', 'Plain Two'), sug('Plain Act', 'Plain One'), sug('Queen', 'Strong Synthetic')] }) }, { library: weakLibrary });
    const set = (r: Row[]) => r.filter(t => !t.fromUpload).map(t => `${t.artist}|${t.song}|${t.rankWhy}`).sort();
    expect(set(b)).toEqual(set(a));
  });

  it('a forbidden candidate never takes a slot or adds an artist-variety penalty to an allowed same-artist one', async () => {
    const rows = await run({ recommend: async () => ({ suggestions: [sug('Queen', 'Forbidden Synthetic'), sug('Queen', 'Allowed Synthetic')] }) }, {
      prep: h => { const k = h.prepModule('knowledge'); return k.setFeedback(k.emptyKnowledge(), 'Queen', 'Forbidden Synthetic', 'never'); },
    });
    expect(rows.map(t => t.song)).not.toContain('Forbidden Synthetic');
    const allowed = rows.find(t => t.song === 'Allowed Synthetic')!;
    // Only the client's own Queen request counts toward variety, never the excluded candidate.
    expect(allowed.rankWhy).toMatch(/Same artist as client request/);
    expect(rows.filter(t => t.fromUpload)).toHaveLength(2);
  });

  it('equivalent candidates score the same whichever source found them (owned file facts win)', async () => {
    const lib = vdj.buildLibrary([{ filePath: '/synthetic/Elton John - Rocket Man.mp3', artist: 'Elton John', title: 'Rocket Man', year: '1972', genre: 'Pop' }] as vdj.VdjTrack[]);
    const inputs = { genresInput: 'Pop' };
    const viaAi = await run({ recommend: async () => ({ suggestions: [{ ...sug('Elton John', 'Rocket Man'), genre: 'Disco', year: 1999 }] }) }, { library: lib, inputs });
    const viaNeighbour = await run({ crowd: async () => ({ available: true, artists: [{ name: 'Queen', listeners: 1, tags: [], similar: [{ name: 'Elton John', match: 0.5 }] }] }), recommend: async () => ({ suggestions: [] }) }, { library: lib, inputs });
    const a = viaAi.find(t => t.song === 'Rocket Man')!, b = viaNeighbour.find(t => t.song === 'Rocket Man')!;
    expect(a.year).toBe(1972); expect(b.year).toBe(1972); // file tags, not the AI's guess
    expect(a.rankWhy).toMatch(/preferred genre/); expect(a.rankWhy).not.toMatch(/Disco/);
    expect(b.rankWhy).toMatch(/preferred genre/);
  });

  it('expansion off adds nothing and never pads', async () => {
    let called = 0;
    const rows = await run({ recommend: async () => { called++; return { suggestions: [sug('Queen', 'X')] }; }, crowd: async () => { called++; return { available: false, artists: [] }; } }, { library: weakLibrary, inputs: { expand: false } });
    expect(rows.every(t => t.fromUpload)).toBe(true);
    expect(called).toBe(0);
  });
});
