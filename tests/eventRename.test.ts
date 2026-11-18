import { describe, expect, it } from 'vitest';
import { writeEventConditionally, renameEventConditionally } from '@/lib/eventWriteContract';
import { openedEventName, renamedInputs } from '@/lib/eventName';
import { EVENT_REVISION_FIELD, eventRevision } from '@/lib/eventRevision';
import { eventDbHarness } from './helpers/eventDbHarness';

const fresh = () => crypto.randomUUID();
const inputs = () => ({ eventName: 'Old Wedding', songs: [{ artist: 'Synthetic A', song: 'First Dance', custom: { keep: true } }], hours: '4', notes: 'n', future: { unknown: [1, { x: null }] } });
const lists = () => ({ warmUp: [{ artist: 'S', song: 'T' }], transition: [], peak: [], selections: { k: { paths: ['Music/曲.mp3'], excluded: true } }, custom: 'keep' });
const create = () => ({ id: 'E', create: true, expectedUpdatedAt: null, expectedRevision: null, writeRevision: fresh(), name: 'Old Wedding', inputs: inputs(), lists: lists() });
const strip = (v: any) => { const { [EVENT_REVISION_FIELD]: _, ...rest } = v; return rest; };

describe('event rename keeps the builder name consistent', () => {
  it('rename then reopen/reload shows the new name; every other input and list is exactly preserved', async () => {
    const h = eventDbHarness(); await writeEventConditionally(h.db, 'owner', create());
    await renameEventConditionally(h.db, 'owner', 'E', 'New Wedding');
    const row = h.rows.get('E');
    expect(row.name).toBe('New Wedding'); expect(row.inputs.eventName).toBe('New Wedding');
    expect(strip(row.inputs)).toEqual({ ...inputs(), eventName: 'New Wedding' });
    expect(row.lists).toEqual(lists());
    expect(openedEventName(row.name, row.inputs.eventName)).toBe('New Wedding');
    // reload: a second independent read gives the same name
    expect(openedEventName(h.rows.get('E').name, h.rows.get('E').inputs.eventName)).toBe('New Wedding');
  });
  it('old snapshots already renamed with a stale eventName open with the row name, without any write', async () => {
    const h = eventDbHarness();
    h.rows.set('E', { id: 'E', user_id: 'owner', updated_at: '2026-10-31T00:00:00.000Z', name: 'Renamed Earlier', inputs: inputs(), lists: lists() });
    const before = JSON.stringify(h.rows.get('E'));
    expect(openedEventName(h.rows.get('E').name, h.rows.get('E').inputs.eventName)).toBe('Renamed Earlier');
    expect(h.writes).toBe(0); expect(JSON.stringify(h.rows.get('E'))).toBe(before);
  });
  it('consistent, empty and generated-default names are left as saved', () => {
    expect(openedEventName('Same', 'Same')).toBe('Same');
    expect(openedEventName('Same', '  Same ')).toBe('  Same ');
    expect(openedEventName('Event — 1/2/2026', '')).toBe('');
    expect(openedEventName('Named in list', '')).toBe('Named in list');
    expect(openedEventName('x'.repeat(200), 'x'.repeat(250))).toBe('x'.repeat(250));
    expect(openedEventName(undefined, 'Kept')).toBe('Kept');
  });
  it('renamedInputs only replaces eventName and leaves non-object inputs untouched', () => {
    const src = inputs(); const out: any = renamedInputs(src, 'N');
    expect(out).toEqual({ ...src, eventName: 'N' }); expect(out.songs).toBe(src.songs); expect(src.eventName).toBe('Old Wedding');
    expect(renamedInputs(null, 'N')).toBeNull(); expect(renamedInputs([1], 'N')).toEqual([1]);
  });
  it('a stale autosave after a rename is rejected and leaves the renamed name and data intact', async () => {
    const h = eventDbHarness(); const first = await writeEventConditionally(h.db, 'owner', create());
    await renameEventConditionally(h.db, 'owner', 'E', 'New Wedding'); const renamed = JSON.stringify(h.rows.get('E'));
    await expect(writeEventConditionally(h.db, 'owner', { ...create(), create: false, expectedUpdatedAt: first.updatedAt, expectedRevision: first.revision, writeRevision: fresh(), name: 'Old Wedding', inputs: { ...inputs(), notes: 'stale' } })).rejects.toThrow('changed elsewhere');
    expect(JSON.stringify(h.rows.get('E'))).toBe(renamed);
  });
  it('a rename racing an autosave applies at most one; the loser changes nothing', async () => {
    const h = eventDbHarness(); const first = await writeEventConditionally(h.db, 'owner', create());
    const results = await Promise.allSettled([renameEventConditionally(h.db, 'owner', 'E', 'New Wedding'),
      writeEventConditionally(h.db, 'owner', { ...create(), create: false, expectedUpdatedAt: first.updatedAt, expectedRevision: first.revision, writeRevision: fresh(), inputs: { ...inputs(), notes: 'autosave' } })]);
    const row = h.rows.get('E');
    expect(results.filter(r => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(row.inputs.eventName).toBe(row.name === 'New Wedding' ? 'New Wedding' : 'Old Wedding');
    expect(row.lists).toEqual(lists()); expect(row.inputs.songs).toEqual(inputs().songs); expect(row.inputs.future).toEqual(inputs().future);
  });
  it('legacy rows without a marker rename atomically with the observed timestamp and keep all data', async () => {
    const h = eventDbHarness();
    h.rows.set('E', { id: 'E', user_id: 'owner', updated_at: '2026-10-31T00:00:00.000Z', name: 'Old Wedding', inputs: inputs(), lists: lists() });
    const r = await renameEventConditionally(h.db, 'owner', 'E', 'New Wedding');
    expect(eventRevision(h.rows.get('E').inputs)).toBe(r.revision);
    expect(strip(h.rows.get('E').inputs)).toEqual({ ...inputs(), eventName: 'New Wedding' }); expect(h.rows.get('E').lists).toEqual(lists());
  });
  it('a failed rename (missing or other owner) writes nothing', async () => {
    const h = eventDbHarness(); await writeEventConditionally(h.db, 'owner', create()); const before = JSON.stringify(h.rows.get('E')); const writes = h.writes;
    await expect(renameEventConditionally(h.db, 'intruder', 'E', 'Hijack')).rejects.toThrow('Could not read');
    await expect(renameEventConditionally(h.db, 'owner', 'missing', 'X')).rejects.toThrow('Could not read');
    expect(h.writes).toBe(writes); expect(JSON.stringify(h.rows.get('E'))).toBe(before);
  });
});
