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
import { DEFAULTS, buildResolver, intended, seasonal, cleanEvidence, requiresClean } from '@/lib/preparationPolicy';
import { exportReadiness, summaryText } from '@/lib/exportReadiness';
import { backupVersion, validateBackup, recoveryFromBackup } from '@/lib/backups';
import { prepareOfflineAccess } from '@/lib/offlineAccess';
import { planAddToSection } from '@/lib/prep/addToSection';
const require = createRequire(import.meta.url);
const harness = require('./helpers/eventRouteHarness.cjs').createEventRouteHarness({ vdj, dance, audio, snapshots, drafts, input, autosave, vibes, isolation, theory, revisions });
const core = require('../desktop/offline/core.js');
const nativeValidate = require('../desktop/backups.cjs').validate;
const tracks = [
  { filePath: '/synthetic/Queen - Radio Ga Ga (Dirty).mp3', artist: 'Queen', title: 'Radio Ga Ga (Dirty)' },
  { filePath: '/synthetic/Queen - Radio Ga Ga (Clean).mp3', artist: 'Queen', title: 'Radio Ga Ga (Clean)' },
  { filePath: '/synthetic/other/Queen - Radio Ga Ga (Clean).mp3', artist: 'Queen', title: 'Radio Ga Ga (Clean)' },
  { filePath: '/synthetic/Rammstein - Radio (Clean).mp3', artist: 'Rammstein', title: 'Radio (Clean)' },
  { filePath: '/synthetic/Unknown.mp3', artist: 'Unknown', title: 'Unknown' },
  { filePath: '/synthetic/Queen - Radio Ga Ga Clean Dirty.mp3', artist: 'Queen', title: 'Radio Ga Ga Clean Dirty' },
  { filePath: '/synthetic/Queen - Radio Ga Ga Live Clean.mp3', artist: 'Queen', title: 'Radio Ga Ga Live Clean' },
  { filePath: '/synthetic/Wham - Last Christmas Clean.mp3', artist: 'Wham!', title: 'Last Christmas Clean' },
];
const request = { artist: 'Queen', song: 'Radio Ga Ga', fromUpload: true };
const key = `warmUp:0:${dance.dedupeKey(request.artist, request.song)}`;
const lists = { warmUp: [request], transition: [], peak: [], selections: { [key]: { paths: [tracks[0].filePath, tracks[1].filePath, tracks[4].filePath], confirmed: true } } };
const row = (inputs = {}) => ({ id: 'A', name: 'Synthetic', updated_at: 'v1', inputs: { songs: [request], hours: '0.25', buffer: 2, ...inputs }, lists: structuredClone(lists) });
describe('owned-only expansion and conservative seasonal evidence', () => {
  it('new defaults are owned-only, seasonal excluded, clean required; legacy fields are absent', async () => {
    const h = harness({ eventId: null }); await h.flush();
    expect(h.current.eventSnapshot().inputs).toMatchObject(DEFAULTS); h.unmount();
    const old = harness({ rows: { A: row() } }); await old.flush();
    for (const k of Object.keys(DEFAULTS)) expect(old.current.eventSnapshot().inputs[k]).toBeUndefined();
    expect(old.requests).toEqual([]); old.unmount();
  });
  it('intended song/version resolver never pads wrong artist/title, live/remix, or basename matches', () => {
    const r = buildResolver(tracks, DEFAULTS);
    expect(r.resolve(request)).toBe(1);
    expect(intended(request, tracks[3])).toBe(false);
    expect(r.resolve({ artist: 'ABBA', song: 'Honey Honey' })).toBeUndefined();
    expect(r.resolve({ artist: 'Anderson .Paak', song: 'Fire In The Sky' })).toBeUndefined();
    expect(r.resolve({ artist: 'Queen', song: 'Killer Queen' })).toBeUndefined();
    expect(intended(request, tracks[6])).toBe(false);
    expect(intended({ artist: 'Queen', song: 'Radio Ga Ga Acoustic' }, tracks[1])).toBe(false);
  });
  it('seasonal titles/genre/tags detected; winter/snow/December not broad guesses', () => {
    for (const song of ['Last Christmas', 'Xmas Party', 'Noël', 'Feliz Navidad', 'Jingle Bells']) expect(seasonal({ song })).toBe(true);
    expect(seasonal({ song: 'Ordinary', tags: ['Christmas'] })).toBe(true);
    expect(seasonal({ song: 'Ordinary', genre: 'Holiday' })).toBe(true);
    for (const song of ['Winter', 'Snow', 'December', 'Holiday Road']) expect(seasonal({ song })).toBe(false);
    expect(buildResolver(tracks, DEFAULTS).allowed({ artist: 'Wham!', song: 'Last Christmas' })).toBe(false);
    expect(buildResolver(tracks, { ...DEFAULTS, includeSeasonalTracks: true }).allowed({ artist: 'Wham!', song: 'Last Christmas' })).toBe(true);
  });
  it('31,250-track resolver remains indexed and returns exact eligible version', () => {
    const large = [...Array.from({ length: 31242 }, (_, i) => ({ artist: `A${i}`, title: `T${i} Clean`, filePath: `/synthetic/${i}.mp3` })), ...tracks];
    const start = performance.now(), r = buildResolver(large, DEFAULTS);
    for (let i = 0; i < 5000; i++) expect(r.resolve(request)).toBe(31243);
    expect(performance.now() - start).toBeLessThan(2000);
  });
  it('empty eligible pool yields honest gaps while requested seasonal track remains', () => {
    const client = [{ artist: 'Wham!', song: 'Last Christmas' }];
    const r = dance.generateLists(client, .25, { expand: true, buffer: 2, prefs: { additionAllowed: () => false } });
    expect([...r.warmUp, ...r.transition, ...r.peak].map(s => s.song)).toEqual(['Last Christmas']);
    expect(r.finalShortfall?.total).toBeGreaterThan(0);
    const topped = dance.topUpSectionsFromLibrary(r, { additionAllowed: () => false });
    expect([...topped.warmUp, ...topped.transition, ...topped.peak]).toHaveLength(1);
  });
  it('shortlist additions reject unowned/off-policy holiday/Dirty links; requests remain untouched', () => {
    const empty = { warmUp: [], transition: [], peak: [] }, lib = vdj.buildLibrary(tracks);
    const args = [empty, 'warmUp', { artist: 'ABBA', song: 'Honey Honey' }, lib, {}, () => 'new', vdj.matchSong, DEFAULTS] as const;
    expect(planAddToSection(...args)).toHaveProperty('error');
    expect(planAddToSection(empty, 'warmUp', { artist: 'Wham!', song: 'Last Christmas' }, lib, {}, () => 'new', vdj.matchSong, DEFAULTS)).toHaveProperty('error');
    const id = (p: string) => require('../node_modules/typescript') && `file:${p}`;
    // Actual identities use the shared helper, not title/basename.
    expect(planAddToSection(empty, 'warmUp', request, lib, {}, () => 'new', vdj.matchSong, DEFAULTS)).toMatchObject({ match: { confirmed: false } });
    expect(empty.warmUp).toEqual([]);
  });
});
describe('event-wide clean policy and terminal export counts', () => {
  it.each([[0, 'dirty'], [1, 'clean'], [4, 'unknown'], [5, 'conflicting']])('clean evidence for file %i is %s', (index, expected) => expect(cleanEvidence(tracks[Number(index)])).toBe(expected));
  it('School/Corporate cannot weaken strict clean', () => {
    expect(requiresClean({ eventType: 'school_dance', requireCleanVersions: false })).toBe(true);
    expect(requiresClean({ eventType: 'corporate' })).toBe(true);
    expect(requiresClean({})).toBe(false);
  });
  it('every DJ writer exports exact clean files in order, extras blocked independently, no substitutions', () => {
    const lib = vdj.buildLibrary(tracks), refs: vdj.ExportSongRef[] = [{ song: request, requireClean: true, match: { status: 'Manually Matched', confidence: 1, trackIndex: 0, extraTrackIndices: [1, 2, 4, 5], confirmed: true, alternatives: [] } }];
    for (const text of [vdj.buildM3u(refs, lib, {}), vdj.buildVirtualDjXml(refs, lib), vdj.buildTxtPlaylist(refs, lib, { matchedOnly: true })]) {
      expect(text).toContain(tracks[1].filePath); expect(text).toContain(tracks[2].filePath);
      expect(text.indexOf(tracks[1].filePath)).toBeLessThan(text.indexOf(tracks[2].filePath));
      for (const i of [0, 3, 4, 5]) expect(text).not.toContain(tracks[i].filePath);
    }
    expect(vdj.buildTxtPlaylist(refs, lib)).toContain('Radio Ga Ga');
    expect(vdj.countMatchedForExport(refs, lib)).toBe(2);
  });
  it('shared reason counts distinguish 4 unapproved + 3 intentional exclusions, plus clean/missing extras', () => {
    const match = { status: 'Manually Matched' as const, confidence: 1, trackIndex: 1, confirmed: true, alternatives: [] };
    const refs: vdj.ExportSongRef[] = [
      ...Array.from({ length: 4 }, () => ({ song: request, match: { ...match, confirmed: false, status: 'Possible Match' as const } })),
      ...Array.from({ length: 3 }, () => ({ song: request, match: { ...match, excludedFromVdj: true } })),
      { song: request, requireClean: true, match: { ...match, extraTrackIndices: [0, 4, 2] } },
    ];
    const report = exportReadiness(refs, vdj.buildLibrary(tracks), { [tracks[1].filePath]: 'available', [tracks[2].filePath]: 'unavailable' }, {});
    expect(report).toMatchObject({ approved: 1, excluded: 3, unapproved: 4, cleanBlocked: 2, missing: 1, omitted: 7 });
    expect(summaryText(report)).toContain('3 explicitly excluded'); expect(summaryText(report)).toContain('4 unapproved/unresolved');
    expect(summaryText(report)).not.toContain('unmatched');
  });
  it('toggle preserves exact selections, cannot generic-confirm dirty/unknown, and saves/reopens policy', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ rows: { A: row() } }); await h.flush(); h.library(vdj.buildLibrary(tracks)); await h.flush();
      const before = structuredClone(h.current.eventSnapshot().lists.selections);
      h.interact((n: any) => n.props?.['aria-label'] === 'Require clean versions', 'onCheckedChange', true);
      expect(h.current.eventSnapshot().lists.selections).toEqual(before);
      h.interact((n: any) => n.props?.onConfirm, 'onConfirm', key);
      expect(h.errors.at(-1)).toContain('Clean version needed');
      await h.flush(); await vi.advanceTimersByTimeAsync(1000); await h.flush();
      expect(h.requests.at(-1).inputs.requireCleanVersions).toBe(true);
      const saved = h.requests.at(-1); h.unmount();
      const reopened = harness({ rows: { A: { ...row(), inputs: saved.inputs, lists: saved.lists } } }); await reopened.flush(); reopened.library(vdj.buildLibrary(tracks)); await reopened.flush();
      expect(reopened.current.eventSnapshot().inputs.requireCleanVersions).toBe(true); expect(reopened.requests).toEqual([]); reopened.unmount();
    } finally { vi.useRealTimers(); }
  });
  it('policy change while actual export waits for availability stops all outputs', async () => {
    const h = harness({ rows: { A: row() } }); await h.flush(); h.library(vdj.buildLibrary(tracks)); await h.flush();
    let release: (value: unknown) => void = () => {}; const gate = new Promise(r => { release = r; });
    h.testWindow.electronAvailability = { check: async () => gate };
    const pending = h.current.exportAllZip();
    h.interact((n: any) => n.props?.['aria-label'] === 'Require clean versions', 'onCheckedChange', true);
    release({ ok: true, availability: Object.fromEntries(tracks.map(t => [t.filePath, 'available'])) }); await pending;
    expect(h.files).toEqual([]); expect(h.downloads).toEqual([]); expect(h.errors.at(-1)).toContain('changed'); h.unmount();
  });
});
describe('backup/recovery/offline compatibility without mutating legacy snapshots', () => {
  const backup = (policy = false) => ({ format: 'setarchitect-backup' as const, version: policy ? 2 as const : 1 as const, account: 'synthetic', createdAt: new Date().toISOString(), events: Array.from({ length: 14 }, (_, i) => ({ id: `E${i}`, snapshot: { name: 'Synthetic', inputs: { songs: [request], ...(policy ? DEFAULTS : {}) }, lists } })), sources: [{ label: 'Synthetic', tracks }], roots: {} });
  it('14 legacy events untouched; optional policies roundtrip in v2 through web/native/recovery', () => {
    for (const policy of [false, true]) {
      const b = backup(policy), bytes = JSON.stringify(b);
      expect(backupVersion(b.events)).toBe(policy ? 2 : 1);
      expect(validateBackup(bytes, 'synthetic')).toEqual(b); expect(nativeValidate(bytes, 'synthetic')).toEqual(b);
      expect(JSON.stringify(b)).toBe(bytes);
      const recovered = recoveryFromBackup(b, 'E0'); expect(recovered.snapshot.lists).toEqual(lists);
      if (policy) expect(recovered.snapshot.inputs).toMatchObject(DEFAULTS); else expect(recovered.snapshot.inputs.requireCleanVersions).toBeUndefined();
    }
  });
  it('invalid persisted policies fail closed in both validators', () => {
    const b = backup(true); (b.events[0].snapshot.inputs as any).requireCleanVersions = 'false';
    for (const check of [validateBackup, nativeValidate]) expect(() => check(JSON.stringify(b), b.account)).toThrow();
  });
  it('old native reader rejects v2 and web preparation revokes older offline capability', async () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const source = fs.readFileSync('desktop/backups.cjs', 'utf8').replace('![1,2].includes(b.version)', 'b.version!==1');
    const mod = { exports: {} }; vm.runInNewContext(source, { module: mod, exports: mod.exports, require });
    expect(() => (mod.exports as any).validate(JSON.stringify(backup(true)), 'synthetic')).toThrow();
    let revoked = 0, prepared = 0;
    const bridge = { signedOut: async () => { revoked++; return { ok: true }; }, accountSeen: async () => ({ ok: true }), status: async () => ({ prepared: false }), prepare: async () => { prepared++; return { ok: true }; } };
    await expect(prepareOfflineAccess({ account: 'synthetic', check: () => {} }, async () => backup(true), bridge)).rejects.toThrow('newer signed desktop');
    expect(revoked).toBe(1); expect(prepared).toBe(0);
  });
  it('offline uses identical clean classification/counts with exact selected paths including extras', () => {
    const event = { id: 'E0', inputs: DEFAULTS, lists }, available = Object.fromEntries(tracks.map(t => [t.filePath, 'available']));
    const plan = core.exportPlan(event, { selections: {} }, core.buildIndex(tracks), {}, available);
    expect(plan.sections[0].entries.map((e: any) => e.path)).toEqual([tracks[1].filePath]);
    expect(plan.summary).toMatchObject({ approved: 1, cleanBlocked: 2 });
    const overlay = { selections: { 'warmUp:0': { paths: [tracks[0].filePath], confirmed: true, song: request } } };
    expect(core.exportPlan(event, overlay, core.buildIndex(tracks), {}, available).summary.approved).toBe(0);
  });
});