import { describe, it, expect, vi } from 'vitest';
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
import { parseSafeSaveRequest, SAVE_REJECTED_PREFIX } from '@/lib/eventSchemas';
import { repeatedRequestRows } from '@/lib/additionIdentity';
const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });

// Synthetic copy of the native repro: six distinct client requests, favourites, Dance Floor 1 hour, expansion on at 1×.
const SIX = [['Mark Ronson feat. Bruno Mars', 'Uptown Funk'], ['Mark Ronson', 'Valerie'], ['Mark Ronson', 'Valerie (Live)'], ['Adele', 'Hello'], ['Lionel Richie', 'Hello'], ['Earth, Wind & Fire', 'September']].map(([artist, song]) => ({ artist, song }));
const request = (inputs: Record<string, unknown>) => ({ id: crypto.randomUUID(), create: true, expectedUpdatedAt: null, expectedRevision: null, writeRevision: crypto.randomUUID(), name: 'TEST ONLY',
  inputs: { songs: SIX, hours: '1', artistsInput: 'Mark Ronson, Bruno Mars', genresInput: '', decades: [], notes: '', doNotPlayInput: '', expand: true, eventName: 'TEST ONLY', listType: 'dance', ...inputs },
  lists: { warmUp: SIX, transition: [], peak: [] } });

describe('safe-save contract accepts every preparation target the editor offers', () => {
  it('1× (fresh-event default) is accepted; 0× and 5× stay rejected without echoing values', () => {
    for (const buffer of [1, 2, 3, 4]) expect(() => parseSafeSaveRequest(request({ buffer }))).not.toThrow();
    for (const buffer of [0, 5, 1.5]) {
      let message = '';
      try { parseSafeSaveRequest(request({ buffer })); } catch (e) { message = (e as Error).message; }
      expect(message.startsWith(SAVE_REJECTED_PREFIX)).toBe(true);
      expect(message).toContain('inputs.buffer');
    }
  });
  it('rejection names selection locations without the song-derived key', () => {
    let message = '';
    try { parseSafeSaveRequest({ ...request({ buffer: 1 }), lists: { warmUp: [], transition: [], peak: [], selections: { 'warmUp:0:adele|hello': { paths: 'bad' } } } }); } catch (e) { message = (e as Error).message; }
    expect(message).toContain('lists.selections.*.paths');
    expect(message).not.toContain('adele');
  });
});

describe('real event route: fresh 1× event generates and its save is confirmed through the real contract', () => {
  it('six distinct requests + generated rows save with buffer 1 and reach "saved"', async () => {
    const writes: any[] = [];
    const h = harness({ eventId: null, contract: true, rows: {}, write: async (r: any) => { writes.push(r.data); return { id: r.data.id, updatedAt: new Date(Date.UTC(2026, 10, 3, 18, writes.length)).toISOString(), revision: r.data.writeRevision }; } });
    vi.useFakeTimers();
    try {
      await h.flush();
      h.interact((n: any) => n.props?.role === 'radio' && /^Dance floor$/i.test(n.props?.children));
      h.interact((n: any) => n.props?.id === 'hours', 'onChange', { target: { value: '1' } });
      h.current.setEventName('TEST ONLY'); h.current.setSongs(SIX); await h.flush();
      h.interact((n: any) => n.props?.steps && n.props?.onSelect, 'onSelect', 4);
      h.interact((n: any) => n.props?.['aria-label'] === 'Expand event with additional tracks', 'onCheckedChange', true);
      await h.flush();
      await h.current.generate(); await h.flush();
      await vi.advanceTimersByTimeAsync(3000); await h.flush();
      const saved = h.requests.filter((r: any) => r.lists?.warmUp).at(-1);
      expect(saved.inputs.buffer).toBe(1);
      expect(saved.inputs.expand).toBe(true);
      const rows = [...saved.lists.warmUp, ...saved.lists.transition, ...saved.lists.peak];
      expect(rows.filter((r: any) => r.fromUpload)).toHaveLength(6);
      expect(() => parseSafeSaveRequest(saved)).not.toThrow();
      expect(writes.length).toBeGreaterThan(0);
      expect(h.current.saveState).toBe('saved');
      expect(h.errors).toEqual([]);
    } finally { vi.useRealTimers(); h.unmount(); }
  });
});

describe('import review duplicates use the conservative version-aware identity', () => {
  it('the six distinct requests show no duplicate', () => { expect(repeatedRequestRows(SIX).size).toBe(0); });
  it('keeps versions, covers, other artists and bands; merges only true repeats and explicit featured aliases', () => {
    const rows = [
      ...SIX,
      { artist: 'Mark Ronson', song: 'Valerie (Acoustic)' }, { artist: 'Mark Ronson', song: 'Valerie (Extended Mix)' }, { artist: 'Mark Ronson', song: 'Valerie (Version Revisited)' },
      { artist: 'Fire', song: 'September' }, { artist: 'Simon', song: 'The Boxer' }, { artist: 'Simon & Garfunkel', song: 'The Boxer' },
      { artist: 'mark ronson', song: 'valerie' },              // 12: exact repeat
      { artist: 'Mark Ronson', song: 'Uptown Funk' },          // 13: explicit feat. alias of row 0
      { artist: 'Adele', song: 'Hello (Clean)' },              // 14: clean label of row 3
    ];
    expect([...repeatedRequestRows(rows)].sort((a, b) => a - b)).toEqual([12, 13, 14]);
  });
  it('explicit Remove (route) drops only counted repeats and keeps the first occurrence', async () => {
    const h = harness({ eventId: null, rows: {} });
    await h.flush();
    h.current.setSongs([...SIX, { artist: 'Adele', song: 'Hello' }]); await h.flush();
    const button = h.nodes().find((n: any) => n.props?.onClick && /Remove/.test(JSON.stringify(n.props?.children ?? '')) && /duplicate/.test(JSON.stringify(n.props?.children ?? '')));
    expect(JSON.stringify(button.props.children)).toContain('"1"," duplicate"');
    button.props.onClick(); await h.flush();
    expect(h.current.songs).toEqual(SIX);
    h.unmount();
  });
});
