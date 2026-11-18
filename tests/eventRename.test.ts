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
  it('a rename and an autosave from the same captured revision: exactly one applies, loser is a no-op', async () => {
    const h = eventDbHarness(); const first = await writeEventConditionally(h.db, 'owner', create());
    const base = { id: 'E', create: false, expectedUpdatedAt: first.updatedAt, expectedRevision: first.revision, lists: lists() };
    const rename = { ...base, writeRevision: fresh(), name: 'New Wedding', inputs: renamedInputs(inputs(), 'New Wedding') };
    const autosave = { ...base, writeRevision: fresh(), name: 'Old Wedding', inputs: { ...inputs(), notes: 'autosave' } };
    const results = await Promise.allSettled([writeEventConditionally(h.db, 'owner', rename), writeEventConditionally(h.db, 'owner', autosave)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results[0].status === 'fulfilled' ? rename : autosave;
    const loser = winner === rename ? results[1] : results[0];
    expect(loser.status).toBe('rejected'); expect((loser as PromiseRejectedResult).reason.message).toContain('changed elsewhere');
    const row = h.rows.get('E');
    expect(eventRevision(row.inputs)).toBe(winner.writeRevision);
    expect(row.name).toBe(winner.name); expect(strip(row.inputs)).toEqual(winner.inputs); expect(row.lists).toEqual(lists());
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
