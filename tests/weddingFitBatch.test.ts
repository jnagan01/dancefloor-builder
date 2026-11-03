import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
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
import { parseSafeSaveRequest } from '@/lib/eventSchemas';
import cache from './fit/realCacheRows.json';
import { REQUESTS } from './fit/fitComparison';
const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });

/**
 * SYNTHETIC real-route batch for the fictional Traditional Wedding brief. Real event screen, real shared ranking and the
 * real save contract. AI suggestions and online details come from tests/fit/realCacheRows.json (read-only metadata-cache
 * snapshot); Last.fm is unavailable; the built-in catalogue runs live; no music library. NOT live native generation and NOT
 * the original candidate pool.
 */
const NOTES = 'Fictional client brief: mixed-age wedding guests, ages 25–70. Familiar upbeat pop, funk, disco and 2000s party favorites. Build from approachable classics into a lively finish. No line dances, slow ballads, or hard EDM. Preserve every client request.';
const DNP = 'Village People - YMCA\nDJ Casper - Cha Cha Slide\nCupid - Cupid Shuffle';
const suggestions = (cache as any[]).map(r => ({ artist: r.artist, song: r.song, reason: 'synthetic fixture suggestion' }));
const enrichFrom = (pool: any[]) => async (req: any) => ({ results: (req.data.songs as any[]).flatMap(s => { const r = pool.find(c => c.artist === s.artist && c.song === s.song); return r ? [{ artist: r.artist, song: r.song, energy: r.energy, danceability: r.danceability, popularity: r.popularity, year: r.year, source: 'ReccoBeats+MusicBrainz', prov: r.metaProv }] : []; }) });
/** TEST-ONLY synthetic pool with explicitly VERIFIED provider years/popularity/energy (fictional tracks; NOT real data and
 *  NOT realCacheRows). Exists only to prove fit choices change automatic selection under the unchanged strict decade rule. */
const V = { energy: 'provider', danceability: 'provider', popularity: 'provider', year: 'provider' };
export const SYNTHETIC_VERIFIED = [
  ...Array.from({ length: 10 }, (_, i) => ({ artist: `TEST ONLY Popular ${i + 1}`, song: `Synthetic Hit ${i + 1}`, popularity: 9, energy: 7, danceability: 8, year: 1985 + i, metaProv: V, kind: 'popular' })),
  ...Array.from({ length: 10 }, (_, i) => ({ artist: `TEST ONLY Obscure ${i + 1}`, song: `Synthetic Deep Cut ${i + 1}`, popularity: 2, energy: 7, danceability: 8, year: 1985 + i, metaProv: V, kind: 'obscure' })),
  ...Array.from({ length: 4 }, (_, i) => ({ artist: `TEST ONLY Slow ${i + 1}`, song: `Synthetic Anthem Ballad ${i + 1}`, popularity: 9, energy: 2, danceability: 2, year: 1990 + i, metaProv: V, kind: 'slow' })),
];
const enrich = async (req: any) => ({ results: (req.data.songs as any[]).flatMap(s => { const r = (cache as any[]).find(c => c.artist === s.artist && c.song === s.song); return r ? [{ artist: r.artist, song: r.song, energy: r.energy, danceability: r.danceability, ...(r.popularity !== undefined ? { popularity: r.popularity } : {}), ...(r.year !== undefined ? { year: r.year } : {}), source: String(r.rawCacheSource ?? '').startsWith('ReccoBeats') ? 'ReccoBeats' : 'AI', prov: r.metaProv }] : []; }) });

async function run(applyFit: boolean, pool?: any[]) {
  const writes: any[] = [];
  const h = harness({ eventId: null, contract: true, rows: {}, services: { recommend: async () => ({ suggestions: pool ? pool.map(r => ({ artist: r.artist, song: r.song, reason: 'TEST ONLY synthetic suggestion' })) : suggestions }), enrich: pool ? enrichFrom(pool) : enrich }, write: async (r: any) => { writes.push(r.data); return { id: r.data.id, updatedAt: new Date(Date.UTC(2026, 10, 3, 20, writes.length)).toISOString(), revision: r.data.writeRevision }; } });
  vi.useFakeTimers();
  try {
    await h.flush();
    h.interact((n: any) => n.props?.role === 'radio' && /^Dance floor$/i.test(n.props?.children));
    h.interact((n: any) => n.props?.id === 'hours', 'onChange', { target: { value: '1.5' } });
    // The shallow harness does not render the event-type buttons; select the same decades the Traditional Wedding type sets.
    for (const d of ['1970s', '1980s', '1990s', '2000s', '2010s', '2020s']) { const label = h.nodes().find((n: any) => n.type === 'label' && n.key === d); label.props.children[0].props.onCheckedChange(true); await h.flush(); }
    h.interact((n: any) => n.props?.id === 'notes', 'onChange', { target: { value: NOTES } });
    h.current.setEventName('TEST ONLY Wedding Fit'); h.current.setSongs(REQUESTS); await h.flush();
    h.interact((n: any) => n.props?.id === 'donotplay', 'onChange', { target: { value: DNP } });
    h.interact((n: any) => n.props?.steps && n.props?.onSelect, 'onSelect', 4);
    h.interact((n: any) => n.props?.['aria-label'] === 'Expand event with additional tracks', 'onCheckedChange', true);
    await h.flush();
    if (applyFit) {
      // The fit panel's own onChange with its own notes suggestion (what "Apply to additions" sends).
      const panel = h.nodes().find((n: any) => n.props && 'notes' in n.props && typeof n.props.onChange === 'function' && 'value' in n.props);
      expect(panel.props.value).toBeUndefined();
      const { suggestFitFromNotes } = await import('@/lib/prep/eventFit');
      panel.props.onChange({ ...panel.props.value, ...suggestFitFromNotes(panel.props.notes) }); await h.flush();
    }
    await h.current.generate(); await h.flush();
    await vi.advanceTimersByTimeAsync(3000); await h.flush();
    if (process.env.DBG) console.log('DBG', JSON.stringify({ e: h.errors, w: h.warnings, i: h.infos }));
    return { saved: h.requests.filter((r: any) => r.lists?.warmUp).at(-1), h };
  } finally { vi.useRealTimers(); h.unmount(); }
}

const rowsOf = (s: any) => ['warmUp', 'transition', 'peak'].flatMap(k => s.lists[k].map((r: any) => ({ ...r, section: k })));

describe('synthetic real-route batch: Traditional Wedding brief', () => {
  it('fit applied explicitly from notes: requests kept, DNP respected, choices saved through the real contract', async () => {
    const { saved: after } = await run(true);
    const { saved: before } = await run(false);
    expect(after.inputs.eventFit).toEqual({ familiarity: 'familiar', avoidSlow: true });
    expect(before.inputs.eventFit).toBeUndefined();
    for (const s of [after, before]) {
      expect(() => parseSafeSaveRequest(s)).not.toThrow();
      const rows = rowsOf(s);
      expect(rows.filter((r: any) => r.fromUpload)).toHaveLength(10);
      expect(rows.some((r: any) => /YMCA|Cha Cha Slide|Cupid Shuffle/i.test(r.song))).toBe(false);
    }
    const pick = (s: any) => rowsOf(s).filter((r: any) => !r.fromUpload).map((r: any) => ({ section: r.section, artist: r.artist, song: r.song, why: r.rankWhy ?? null, energy: r.energy ?? null, danceability: r.danceability ?? null, popularity: r.popularity ?? null, prov: r.metaProv ?? null }));
    const out = { conditions: 'SYNTHETIC real-route batch (vitest event-route harness, real ranking + save contract). AI suggestions + online details: tests/fit/realCacheRows.json (read-only metadata-cache snapshot, 31 rows). Last.fm unavailable. Built-in catalogue live. No music library. Not live native generation; not the original candidate pool. Cache values carry legacy row-level labels only, so years decode as estimates and the unchanged strict decade policy excludes them; an empty or short additions list is an honest shortfall, not a failure.', before: pick(before), after: pick(after) };
    mkdirSync('test-results', { recursive: true });
    writeFileSync(process.env.WRITE_WEDDING_BATCH ?? 'test-results/wedding-fit-batch.json', JSON.stringify(out, null, 1));
    // Honest shortfall allowed: no confirmed years exist in this fixture, and strict decades are intentionally unchanged.
    expect(out.after.every((r: any) => r.prov?.year !== 'estimate' && r.prov?.year !== 'ai')).toBe(true);
  }, 30000);

  it('TEST-ONLY verified synthetic pool: fit changes automatic selection/order, requests preserved, strict decades unchanged', async () => {
    const { saved: before } = await run(false, SYNTHETIC_VERIFIED);
    const { saved: after } = await run(true, SYNTHETIC_VERIFIED);
    const kind = (r: any) => SYNTHETIC_VERIFIED.find(x => x.artist === r.artist && x.song === r.song)?.kind;
    for (const s of [before, after]) {
      expect(() => parseSafeSaveRequest(s)).not.toThrow();
      expect(rowsOf(s).filter((r: any) => r.fromUpload).map((r: any) => `${r.artist}|${r.song}`).sort()).toEqual(REQUESTS.map(r => `${r.artist}|${r.song}`).sort());
    }
    if (process.env.DBG2) console.log('ADDS', JSON.stringify({ b: rowsOf(before).filter((r: any) => !r.fromUpload).map((r: any) => r.song), a: rowsOf(after).filter((r: any) => !r.fromUpload).map((r: any) => r.song) }));
    const addsB = rowsOf(before).filter((r: any) => !r.fromUpload), addsA = rowsOf(after).filter((r: any) => !r.fromUpload);
    expect(addsA.length).toBeGreaterThan(0);
    expect(addsA.some((r: any) => kind(r) === 'slow')).toBe(false); // verified slow additions avoided
    // Note: in this route the low-energy rows were also not chosen without fit (other existing dance-floor ranking), so
    // this scenario proves fit via familiarity ordering; avoidSlow exclusion itself is covered by eventFit unit tests.
    const pop = (xs: any[]) => xs.filter(r => kind(r) === 'popular').length;
    expect(pop(addsA)).toBeGreaterThan(pop(addsB));
    expect(after.inputs.eventFit).toEqual({ familiarity: 'familiar', avoidSlow: true }); expect(before.inputs.eventFit).toBeUndefined();
  }, 30000);
});
