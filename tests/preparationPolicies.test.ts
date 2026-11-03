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
import { classifySelectedRow, exportReadiness, summaryText } from '@/lib/exportReadiness';
import { backupVersion, validateBackup, recoveryFromBackup } from '@/lib/backups';
import { prepareOfflineAccess } from '@/lib/offlineAccess';
import { planAddToSection } from '@/lib/prep/addToSection';
import { supportsPreparationPolicy, assertPreparationActivation } from '@/lib/preparationCapability';
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
    expect(h.current.eventSnapshot(h.current.result ?? { warmUp: [], transition: [], peak: [] }, h.current.matches).inputs).toMatchObject(DEFAULTS); h.unmount();
    const old = harness({ rows: { A: row() } }); await old.flush();
    for (const k of Object.keys(DEFAULTS)) expect(old.current.eventSnapshot(old.current.result, old.current.matches).inputs[k]).toBeUndefined();
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
    const r = dance.generateLists({ uploaded: client, hours: .25, expand: true, buffer: 2, prefs: { artists: [], decades: [], doNotPlay: [], additionAllowed: () => false } });
    expect([...r.warmUp, ...r.transition, ...r.peak].map(s => s.song)).toEqual(['Last Christmas']);
    expect(dance.currentShortfall(r).total).toBeGreaterThan(0);
    const topped = dance.topUpSectionsFromLibrary(r, { artists: [], decades: [], doNotPlay: [], additionAllowed: () => false });
    expect([...topped.warmUp, ...topped.transition, ...topped.peak]).toHaveLength(1);
  });
  it.each(['dance', 'dinner'])('real %s route never pads clean owned do-not-play/out-of-range tracks or invented evidence', async (listType) => {
    const banned = [
      { artist: 'Forbidden Artist', title: 'Forbidden Track (Clean)', filePath: '/synthetic/forbidden.mp3', year: '2015', genre: 'Pop', bpm: '120' },
      { artist: 'Old Artist', title: 'Out Of Range (Clean)', filePath: '/synthetic/old.mp3', year: '1955', genre: 'Metal', bpm: '180' },
    ];
    const h = harness({ rows: { A: row({ ...DEFAULTS, listType, minutes: '60', expand: true, eventType: 'school_dance', decades: ['2010s'], genresInput: 'Pop', doNotPlayInput: 'Forbidden Artist - Forbidden Track', bpmRange: [110, 128] }) } });
    await h.flush(); h.library(vdj.buildLibrary(banned)); await h.flush();
    await h.current.generate(); await h.flush();
    const result = h.current.result;
    expect(result).toBeTruthy();
    const added = [...result.warmUp, ...result.transition, ...result.peak].filter(t => !t.fromUpload);
    expect(added).toEqual([]);
    expect([...result.warmUp, ...result.transition, ...result.peak].some(t => t.fromUpload && t.song === request.song)).toBe(true);
    expect(dance.currentShortfall(result).total).toBeGreaterThan(0);
    h.unmount();
  });
  it('real route matches requested Christmas clean identity while holiday expansion stays disabled', async () => {
    const holiday = { artist: 'Wham!', song: 'Last Christmas', fromUpload: true };
    const h = harness({ rows: { A: { ...row(DEFAULTS), inputs: { ...row(DEFAULTS).inputs, songs: [holiday] }, lists: { warmUp: [holiday], transition: [], peak: [] } } } });
    await h.flush(); h.library(vdj.buildLibrary(tracks)); await h.flush();
    const match = Object.values(h.current.matches)[0] as vdj.SongMatch;
    expect(match).toMatchObject({ confirmed: true, trackIndex: 7 });
    expect(tracks[match.trackIndex ?? -1].filePath).toBe('/synthetic/Wham - Last Christmas Clean.mp3');
    expect(buildResolver(tracks, DEFAULTS).allowed(holiday)).toBe(false);
    expect(h.requests).toEqual([]); h.unmount();
  });
  it('shortlist additions reject unowned/off-policy holiday/Dirty links; requests remain untouched', () => {
    const empty = { warmUp: [], transition: [], peak: [] }, lib = vdj.buildLibrary(tracks);
    const args = [empty, 'warmUp', { artist: 'ABBA', song: 'Honey Honey' }, lib, {}, () => 'new', vdj.matchSong, DEFAULTS] as const;
    expect(planAddToSection(...args)).toHaveProperty('error');
    expect(planAddToSection(empty, 'warmUp', { artist: 'Wham!', song: 'Last Christmas' }, lib, {}, () => 'new', vdj.matchSong, DEFAULTS)).toHaveProperty('error');
    // Actual identities use the shared helper, not title/basename.
    expect(planAddToSection(empty, 'warmUp', request, lib, {}, () => 'new', vdj.matchSong, DEFAULTS)).toMatchObject({ match: { confirmed: false } });
    expect(empty.warmUp).toEqual([]);
  });
});
describe('event-wide clean policy and terminal export counts', () => {
  it('row units separate matched, review and exclusions while retaining eligible extras', () => {
    const lib = vdj.buildLibrary(tracks);
    const match: vdj.SongMatch = { status: 'Manually Matched', confidence: 1, trackIndex: 1, confirmed: true, alternatives: [] };
    const classify = (patch: Partial<vdj.SongMatch>, requireClean = true) => classifySelectedRow({ song: request, match: { ...match, ...patch }, requireClean }, lib);
    expect(classify({})).toMatchObject({ matched: true, attention: false, eligibleTracks: 1 });
    expect(classify({ trackIndex: 0 })).toMatchObject({ matched: false, review: true, eligibleTracks: 0 });
    expect(classify({ extraTrackIndices: [0, 1, 2] })).toMatchObject({ matched: false, review: true, eligibleTracks: 2 });
    expect(classify({ excludedFromVdj: true })).toMatchObject({ matched: false, attention: false, excluded: true, eligibleTracks: 0 });
    for (const trackIndex of [4, 5, 999]) expect(classify({ trackIndex })).toMatchObject({ matched: false, review: true, eligibleTracks: 0 });
    expect(classify({ confirmed: false, status: 'Possible Match' })).toMatchObject({ matched: false, review: true, eligibleTracks: 0 });
    expect(classify({ trackIndex: 0 }, false)).toMatchObject({ matched: true, attention: false, eligibleTracks: 1 });
  });
  it.each([[0, 'dirty'], [1, 'clean'], [4, 'unknown'], [5, 'conflicting']])('clean evidence for file %i is %s', (index, expected) => expect(cleanEvidence(tracks[Number(index)])).toBe(expected));
  it('School/Corporate cannot weaken strict clean', () => {
    expect(requiresClean({ eventType: 'school_dance', requireCleanVersions: false })).toBe(true);
    expect(requiresClean({ eventType: 'corporate' })).toBe(true);
    expect(requiresClean({})).toBe(false);
  });
  it('every DJ writer exports exact clean files in order, extras blocked independently, no substitutions', () => {
    const lib = vdj.buildLibrary(tracks), refs: vdj.ExportSongRef[] = [{ song: request, requireClean: true, match: { status: 'Manually Matched', confidence: 1, trackIndex: 0, extraTrackIndices: [1, 2, 4, 5], confirmed: true, alternatives: [] } }];
    for (const text of [vdj.buildM3u(refs, lib, {}), vdj.buildVirtualDjXml(refs, lib)]) {
      expect(text).toContain(tracks[1].filePath); expect(text).toContain(tracks[2].filePath);
      expect(text.indexOf(tracks[1].filePath)).toBeLessThan(text.indexOf(tracks[2].filePath));
      for (const i of [0, 3, 4, 5]) expect(text).not.toContain(tracks[i].filePath);
    }
    expect(vdj.buildTxtPlaylist(refs, lib, { matchedOnly: true }).split("\r\n")).toEqual(["1. Queen - Radio Ga Ga (Clean)", "   + Queen - Radio Ga Ga (Clean)", ""]);
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
      const before = structuredClone(h.current.eventSnapshot(h.current.result ?? { warmUp: [], transition: [], peak: [] }, h.current.matches).lists.selections);
      h.interact((n: any) => n.props?.['aria-label'] === 'Require clean versions', 'onCheckedChange', true);
      expect(h.current.eventSnapshot(h.current.result ?? { warmUp: [], transition: [], peak: [] }, h.current.matches).lists.selections).toEqual(before);
      h.interact((n: any) => n.props?.onConfirm, 'onConfirm', key);
      expect(h.errors.at(-1)).toContain('Clean version needed');
      await h.flush(); await vi.advanceTimersByTimeAsync(1000); await h.flush();
      expect(h.requests.at(-1).inputs.requireCleanVersions).toBe(true);
      const saved = h.requests.at(-1); h.unmount();
      const reopened = harness({ rows: { A: { ...row(), inputs: saved.inputs, lists: saved.lists } } }); await reopened.flush(); reopened.library(vdj.buildLibrary(tracks)); await reopened.flush();
      expect(reopened.current.eventSnapshot(reopened.current.result, reopened.current.matches).inputs.requireCleanVersions).toBe(true); expect(reopened.requests).toEqual([]); reopened.unmount();
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
describe('direct TXT verified confirmation', () => {
  async function setup() {
    const h = harness({ rows: { A: row({ requireCleanVersions: true }) } });
    await h.flush(); h.library(vdj.buildLibrary(tracks)); await h.flush();
    h.current.setVdjDirHandle({ name: 'Synthetic exports' }); await h.flush();
    return h;
  }
  it('confirms only after verification and cancellation writes nothing', async () => {
    const h = await setup(); const order: string[] = [];
    h.testWindow.electronAvailability = { check: async () => { order.push('verified'); return { ok: true, availability: Object.fromEntries(tracks.map(t => [t.filePath, 'available'])) }; } };
    h.testWindow.confirm = (message: string) => { order.push('confirm'); expect(message).toBe('1 track · left out: 2 clean-policy blocks. Reference files retain intended tracks. Continue?'); return false; };
    const before = h.current.eventSnapshot(h.current.result, h.current.matches);
    await h.current.exportSectionXmlToVdj('warmUp');
    expect(order).toEqual(['verified', 'confirm']); expect(h.files).toEqual([]); expect(h.downloads).toEqual([]); expect(h.warnings).toEqual([]);
    expect(h.current.eventSnapshot(h.current.result, h.current.matches)).toEqual(before); expect(h.requests).toEqual([]); h.unmount();
  });
  it.each(['failed', 'incomplete', 'unavailable'])('%s native check stops before confirmation or writes', async mode => {
    const h = await setup(); const confirm = vi.fn(() => true); h.testWindow.confirm = confirm;
    h.testWindow.electronAvailability = { check: async () => mode === 'failed' ? { ok: false, error: 'Synthetic check failure' } : { ok: true, availability: mode === 'incomplete' ? {} : Object.fromEntries(tracks.map(t => [t.filePath, 'unavailable'])) } };
    await h.current.exportSectionXmlToVdj('warmUp'); expect(confirm).not.toHaveBeenCalled(); expect(h.errors).not.toEqual([]); expect(h.files).toEqual([]); expect(h.downloads).toEqual([]); h.unmount();
  });
  it('browser confirmation retains genuinely unknown availability without a native check', async () => {
    const h = await setup(); const confirm = vi.fn(() => false); h.testWindow.confirm = confirm;
    await h.current.exportSectionXmlToVdj('warmUp'); expect(confirm.mock.calls[0]?.[0]).toContain('1 file availability unknown'); expect(h.files).toEqual([]); h.unmount();
  });
  it('clean-policy changes during verification stop before confirmation and writes', async () => {
    const h = await setup(); let release: (value: unknown) => void = () => {}; const gate = new Promise(r => { release = r; }); const confirm = vi.fn(() => true);
    h.testWindow.confirm = confirm; h.testWindow.electronAvailability = { check: async () => gate };
    const pending = h.current.exportSectionXmlToVdj('warmUp');
    await vi.waitFor(() => expect(h.testWindow.electronAvailability).toBeDefined());
    h.interact((n: any) => n.props?.['aria-label'] === 'Require clean versions', 'onCheckedChange', false);
    release({ ok: true, availability: Object.fromEntries(tracks.map(t => [t.filePath, 'available'])) }); await pending;
    expect(confirm).not.toHaveBeenCalled(); expect(h.errors.at(-1)).toContain('changed'); expect(h.files).toEqual([]); expect(h.downloads).toEqual([]); h.unmount();
  });
});
describe('backup/recovery/offline compatibility without mutating legacy snapshots', () => {
  it('old 1.2.44 capability refuses activation but preserves legacy strict-type v1 backup/update input', () => {
    const old = { electronVirtualDJ: { isAvailable: true } };
    expect(supportsPreparationPolicy(old)).toBe(false);
    expect(supportsPreparationPolicy({ ...old, electronOffline: { preparationPolicyVersion: 1 } })).toBe(true);
    expect(supportsPreparationPolicy({})).toBe(true);
    for (const inputs of [DEFAULTS, { ownedOnlyExpansion: false }, { includeSeasonalTracks: true }, { requireCleanVersions: false }]) expect(() => assertPreparationActivation(inputs, old)).toThrow('Update the desktop app');
    const legacy = [{ snapshot: { inputs: { songs: [request], eventType: 'school_dance' } } }];
    const before = JSON.stringify(legacy);
    expect(backupVersion(legacy)).toBe(1);
    expect(() => assertPreparationActivation(legacy[0].snapshot.inputs, old)).not.toThrow();
    expect(JSON.stringify(legacy)).toBe(before);
  });
  it('old-shell legacy editor remains passive and rejects control activation before dirty/save', async () => {
    const h = harness({ rows: { A: row() } });
    h.testWindow.electronVirtualDJ = { isAvailable: true };
    await h.flush();
    const before = h.current.eventSnapshot(h.current.result, h.current.matches);
    h.interact((n: any) => n.props?.['aria-label'] === 'Require clean versions', 'onCheckedChange', true);
    expect(h.current.eventSnapshot(h.current.result, h.current.matches)).toEqual(before);
    expect(h.current.userEdited.current).toBe(false);
    expect(h.errors.at(-1)).toContain('Update the desktop app');
    expect(h.requests).toEqual([]); h.unmount();
  });
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
    const mod = { exports: {} }; vm.runInNewContext(source, { module: mod, exports: mod.exports, require: createRequire(new URL("../desktop/backups.cjs", import.meta.url)) });
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