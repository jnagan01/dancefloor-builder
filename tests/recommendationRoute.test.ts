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

// Synthetic, isolated fixtures only.
const requests = [{ artist: 'Queen', song: 'Radio Ga Ga', fromUpload: true }, { artist: 'ABBA', song: 'Dancing Queen', fromUpload: true }];
const row = () => ({ id: 'A', name: 'Synthetic', updated_at: 'v1', inputs: { songs: requests, hours: '1', buffer: 2, listType: 'dance', expand: true }, lists: { warmUp: [...requests], transition: [], peak: [] } });
const library = vdj.buildLibrary([
  { filePath: '/synthetic/Elton John - I\'m Still Standing.mp3', artist: 'Elton John', title: "I'm Still Standing", year: '1983', genre: 'Pop' },
  { filePath: '/synthetic/Elton John - Rocket Man.mp3', artist: 'Elton John', title: 'Rocket Man', year: '1972', genre: 'Pop' },
] as vdj.VdjTrack[]);
const sug = (artist: string, song: string) => ({ artist, song, energy: 7, danceability: 7, valence: 7, reason: 'synthetic' });
const all = (r: { warmUp: { artist: string; song: string; fromUpload?: boolean; aiReason?: string }[]; transition: typeof r.warmUp; peak: typeof r.warmUp }) => [...r.warmUp, ...r.transition, ...r.peak];

function knowledge(h: { prepModule: (n: string) => Record<string, (...a: unknown[]) => unknown> }) {
  const k = h.prepModule('knowledge');
  let next = k.emptyKnowledge();
  next = k.setFeedback(next, 'Bad Act', 'Never Track', 'never');
  next = k.setFeedback(next, 'Queen', 'Radio Ga Ga', 'never'); // a request: must stay
  next = k.setFeedback(next, 'Fav Act', 'Fav Song', 'favor');
  next = k.dismissForEvent(next, 'A', 'Slow Act', 'Dismissed Track', 'tooSlow');
  next = k.dismissForEvent(next, 'B', 'Plain Act', 'Plain Song', 'wrongStyle'); // other event: must not leak
  return next;
}

describe('real event route: Last.fm track evidence and preparation feedback in automatic expansion', () => {
  it('adds owned Last.fm-similar exact track, honours Never/event dismissals/favour, keeps requests, rechecks late feedback', async () => {
    const seen: unknown[] = [];
    let h: ReturnType<typeof harness>;
    const services = {
      similarTracks: async (r: { data: unknown }) => { seen.push(r.data); return { availability: 'ok', seeds: [
        { seed: { artist: 'Queen', title: 'Radio Ga Ga' }, status: 'ok', similar: [{ artist: 'Elton John', title: "I'm Still Standing", match: 0.4 }, { artist: 'Elton John', title: 'Rocket Man (Live)', match: 0.9 }] },
        { seed: { artist: 'ABBA', title: 'Dancing Queen' }, status: 'ok', similar: [{ artist: 'Elton John', title: "I'm Still Standing", match: 0.5 }] },
      ] }; },
      enrich: async (r: { data: { songs: { song: string }[] } }) => {
        // Feedback changes after AI additions while enrichment is in flight: the late Never must be honoured before commit.
        if (r.data.songs.some(x => x.song === 'Late Song')) h.setPrep((s: { knowledge: unknown }) => ({ ...s, knowledge: h.prepModule('knowledge').setFeedback(s.knowledge, 'Late Act', 'Late Song', 'never') }));
        return { results: [] };
      },
      recommend: async () => {
        return { suggestions: [sug('Bad Act', 'Never Track'), sug('Slow Act', 'Dismissed Track'), sug('Plain Act', 'Plain Song'), sug('Late Act', 'Late Song'), sug('Fav Act', 'Fav Song')] };
      },
    };
    h = harness({ rows: { A: row() }, services });
    h.setPrep((s: object) => ({ ...s, knowledge: knowledge(h) }));
    await h.flush(); h.library(library); await h.flush();
    await h.current.generate(); await h.flush();
    const rows = all(h.current.result);
    const names = rows.map(t => `${t.artist} – ${t.song}`);
    // Requests survive regardless of feedback.
    expect(rows.filter(t => t.fromUpload).map(t => t.song).sort()).toEqual(['Dancing Queen', 'Radio Ga Ga']);
    // Only bounded artist/title seeds were sent to Last.fm.
    expect(seen).toEqual([{ seeds: [{ artist: 'Queen', title: 'Radio Ga Ga' }, { artist: 'ABBA', title: 'Dancing Queen' }], perSeed: 20 }]);
    // Exact owned similar track added with readable multi-seed evidence; same artist but other version is not.
    const elton = rows.find(t => t.song === "I'm Still Standing")!;
    expect(elton.aiReason).toMatch(/similar to 2 requested tracks/);
    expect(names).not.toContain('Elton John – Rocket Man');
    expect(names).not.toContain('Bad Act – Never Track');
    expect(names).not.toContain('Slow Act – Dismissed Track');
    expect(names).not.toContain('Late Act – Late Song');
    expect(names).toContain('Plain Act – Plain Song'); // dismissed only on event B
    expect(names).toContain('Fav Act – Fav Song');
    h.unmount();
  });

  it('missing Last.fm key and failures fall back without inventing evidence', async () => {
    const h = harness({ rows: { A: row() }, services: { similarTracks: async () => { throw Error('offline'); }, recommend: async () => ({ suggestions: [sug('Plain Act', 'Plain Song')] }) } });
    await h.flush(); h.library(library); await h.flush();
    await h.current.generate(); await h.flush();
    const rows = all(h.current.result);
    expect(rows.some(t => /Last\.fm/.test(t.aiReason ?? ''))).toBe(false);
    expect(rows.filter(t => t.fromUpload)).toHaveLength(2);
    h.unmount();
  });

  it('an account/session change during generation discards the result', async () => {
    let h: ReturnType<typeof harness>;
    h = harness({ rows: { A: row() }, services: { recommend: async () => { h.setPrep((s: { generation: number }) => ({ ...s, generation: s.generation + 1 })); return { suggestions: [sug('Plain Act', 'Plain Song')] }; } } });
    await h.flush(); h.library(library); await h.flush();
    const before = JSON.stringify(h.current.result);
    await h.current.generate(); await h.flush();
    expect(JSON.stringify(h.current.result)).toBe(before);
    expect(h.errors).toContain('Account changed during generation; nothing was applied.');
    h.unmount();
  });
});
