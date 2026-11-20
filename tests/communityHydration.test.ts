import { afterEach, expect, it, vi } from 'vitest';
import { communityHandler } from './helpers/communityHandler';
import { runCommunityBatch } from '@/lib/prep/community.functions';
import { informationKey, type Entry } from '@/lib/songInformation/schema';
import { EvidenceReadError, readFailure } from '@/lib/songInformation/readFailures';

afterEach(() => vi.useRealTimers());
const songs = Array.from({ length: 20 }, (_, i) => ({ artist: `TEST Hydration "${i}" & Guest`, song: `Track, ${i} (Live)` }));
const entry = (s: typeof songs[number], at = Date.now() - 60000): Entry => ({ key: informationKey('community', s.artist, s.song), kind: 'community', at, value: { source: 'lastfm', listeners: 6000, slowTags: [], upbeatTags: ['dance'] } });
const provider = () => vi.fn(async (input: any) => {
  const u = new URL(String(input));
  return new Response(JSON.stringify({ track: { name: u.searchParams.get('track'), artist: { name: u.searchParams.get('artist') }, listeners: '6000', toptags: { tag: [{ name: 'dance' }] } } }));
});
it('authenticated 20-entry warm read at 800ms survives fresh handlers with one transport and zero provider calls', async () => {
  vi.useFakeTimers(); const entries = songs.map(s => entry(s)), read = vi.fn(async () => { await new Promise(r => setTimeout(r, 800)); return entries; }), write = vi.fn(async () => {}), fetcher = provider();
  for (let run = 0; run < 2; run++) {
    const pending = communityHandler({ read, write }, fetcher)({ songs });
    await vi.advanceTimersByTimeAsync(801); const rows = await pending;
    expect(rows).toHaveLength(20); expect(rows.every(r => r.status === 'found' && r.updatedAt === entries[0].at && !r.stale)).toBe(true);
    expect(rows.reduce((n, r) => n + (r.reuse?.database ?? 0), 0)).toBe(20);
    expect(rows.reduce((n, r) => n + (r.reuse?.readFailed ?? 0) + (r.reuse?.external ?? 0), 0)).toBe(0);
    expect(rows.filter(r => r.batchReuse)).toHaveLength(1); expect(rows[0].batchReuse?.readFailed).toBe(0);
    expect(read).toHaveBeenCalledTimes(run + 1);
  }
  expect(read.mock.calls[0][0]).toEqual(songs.map(s => informationKey('community', s.artist, s.song)));
  expect(fetcher).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
});
it.each(['readDeadline', 'readDenied', 'readSchema', 'readOther'] as const)('partial %s preserves warm and dated stale evidence and counts one request cause', async cause => {
  const failures = { ...readFailure({}), readOther: 0, [cause]: 1 }, warm = entry(songs[0]), stale = entry(songs[1], Date.now() - 8 * 86400000);
  const read = vi.fn(async () => { throw new EvidenceReadError([warm, stale], failures); }), write = vi.fn(async () => {});
  const fetcher = vi.fn(async () => new Response('{}', { status: 503 }));
  const rows = await communityHandler({ read, write }, fetcher)({ songs: songs.slice(0, 2) });
  expect(rows[0]).toMatchObject({ status: 'found', updatedAt: warm.at, stale: false });
  expect(rows[1]).toMatchObject({ status: 'found', updatedAt: stale.at, stale: true, reuse: { database: 1, external: 1, refreshFailed: 1 } });
  expect(rows.filter(r => r.batchReuse)).toHaveLength(1); expect(rows[0].batchReuse).toMatchObject({ readFailed: 1, [cause]: 1 });
  expect(rows.reduce((n, r) => n + (r.reuse?.readFailed ?? 0), 0)).toBe(0);
  expect(read).toHaveBeenCalledTimes(1); expect(write).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('hung read aborts at 2s, retains streamed partials and permits useful fallback without retries or late mutation', async () => {
  vi.useFakeTimers(); let signal: AbortSignal | undefined, release = (_entries: Entry[]) => {};
  const read = vi.fn((_keys: string[], s?: AbortSignal, partial?: (entries: Entry[]) => void) => { signal = s; partial?.([entry(songs[0])]); return new Promise<Entry[]>(r => { release = r; }); });
  const write = vi.fn(async () => {}), fetcher = provider(), start = Date.now();
  const pending = communityHandler({ read, write }, fetcher)({ songs: songs.slice(0, 2) });
  await vi.advanceTimersByTimeAsync(2001); const rows = await pending;
  expect(signal?.aborted).toBe(true); expect(Date.now() - start).toBeLessThan(9000);
  expect(rows.map(r => r.status)).toEqual(['found', 'found']); expect(rows[0].batchReuse).toMatchObject({ readFailed: 1, readDeadline: 1 });
  expect(fetcher).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1); expect(write).toHaveBeenCalledTimes(1);
  const before = structuredClone(rows); release([entry(songs[1])]); await vi.advanceTimersByTimeAsync(10000);
  expect(rows).toEqual(before); expect(write).toHaveBeenCalledTimes(1);
});
it('deduplicates exact hydration keys without conflating live/remix credits; no-data stays non-failure', async () => {
  const live = songs[0], remix = { ...live, song: live.song.replace('Live', 'Remix') }, read = vi.fn(async () => []), write = vi.fn(async () => {});
  const rows = await communityHandler({ read, write }, async () => new Response('{"error":6}'))({ songs: [live, live, remix] });
  expect(read.mock.calls[0][0]).toEqual([informationKey('community', live.artist, live.song), informationKey('community', remix.artist, remix.song)]);
  expect(rows.every(r => r.status === 'none' && r.reuse?.refreshFailed === 0)).toBe(true); expect(write).not.toHaveBeenCalled();
});
it('late producers past fixed call/batch deadlines cannot write evidence or mutate returned rows', async () => {
  vi.useFakeTimers(); const write = vi.fn(async () => {}), read = vi.fn(async () => []); let release = (_value: Response) => {};
  const pending = runCommunityBatch([songs[0]], 'synthetic', () => new Promise(r => { release = r; }), 9000, 4000, { read, write });
  await vi.advanceTimersByTimeAsync(4001); const rows = await pending, before = structuredClone(rows);
  expect(rows[0].status).toBe('timeout'); release(await provider()(new URL(`https://synthetic.invalid/?artist=${encodeURIComponent(songs[0].artist)}&track=${encodeURIComponent(songs[0].song)}`)));
  await vi.advanceTimersByTimeAsync(10000); expect(rows).toEqual(before); expect(write).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(1);
});
it('authenticated handler rejects signed-out calls and oversized input before storage or providers', async () => {
  const read = vi.fn(async () => []), write = vi.fn(async () => {}), fetcher = provider();
  await expect(communityHandler({ read, write }, fetcher, false)({ songs })).rejects.toThrow('Unauthorized');
  await expect(communityHandler({ read, write }, fetcher)({ songs: [...songs, songs[0]] })).rejects.toThrow();
  expect(read).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});import { weeklyCheck, weeklyEvidence } from './helpers/weeklyEvidence';
it('weekly structured cache community reuse', async () => {
  await weeklyEvidence('cache-community', 'cache', async e => {
    vi.useFakeTimers();
    const entries = songs.map(s => entry(s)), read = vi.fn(async () => { await new Promise(r => setTimeout(r, 800)); return entries; }), write = vi.fn(async () => {}), fetcher = provider();
    let database = 0, preserved = true;
    for (let run = 0; run < 2; run++) {
      const pending = communityHandler({ read, write }, fetcher)({ songs }); await vi.advanceTimersByTimeAsync(801); const rows = await pending;
      database += rows.reduce((n, r) => n + (r.reuse?.database ?? 0), 0); preserved &&= rows.every(r => r.status === 'found' && r.updatedAt === entries[0]!.at);
    }
    weeklyCheck(e, 'community-delayed-warm-database', database, 40);
    weeklyCheck(e, 'community-recreated-external', fetcher.mock.calls.length, 0);
    weeklyCheck(e, 'community-read-transports', read.mock.calls.length, 2);
    weeklyCheck(e, 'community-original-dates', Number(preserved), 1);
    let signal: AbortSignal | undefined, release = (_entries: Entry[]) => {};
    const hungRead = vi.fn((_keys: string[], s?: AbortSignal, partial?: (entries: Entry[]) => void) => { signal = s; partial?.([entry(songs[0]!)]); return new Promise<Entry[]>(r => { release = r; }); });
    const hungWrite = vi.fn(async () => {}), pending = communityHandler({ read: hungRead, write: hungWrite }, provider())({ songs: songs.slice(0, 2) });
    await vi.advanceTimersByTimeAsync(2001); const hung = await pending;
    weeklyCheck(e, 'community-hung-read-aborted', Number(signal?.aborted === true && hung[0]?.batchReuse?.readDeadline === 1), 1);
    weeklyCheck(e, 'community-hung-retained-rows', hung.filter(r => r.status === 'found').length, 2);
    weeklyCheck(e, 'community-hung-read-calls', hungRead.mock.calls.length, 1);
    const before = structuredClone(hung); release([entry(songs[1]!)]); await vi.advanceTimersByTimeAsync(10000);
    weeklyCheck(e, 'community-late-fenced', Number(JSON.stringify(hung) === JSON.stringify(before) && hungWrite.mock.calls.length === 1), 1);
    vi.useRealTimers();
    let typed = 0, stale = 0, errors = 0;
    for (const cause of ['readDeadline', 'readDenied', 'readSchema', 'readOther'] as const) {
      const failures = { ...readFailure({}), readOther: 0, [cause]: 1 }, old = entry(songs[1]!, Date.now() - 8 * 86400000);
      const rows = await communityHandler({ read: async () => { throw new EvidenceReadError([entry(songs[0]!), old], failures); }, write: async () => {} }, async () => new Response('{}', { status: 503 }))({ songs: songs.slice(0, 2) });
      typed += Number(rows.filter(r => r.batchReuse).length === 1 && rows[0]?.batchReuse?.[cause] === 1 && rows[0]?.batchReuse?.readFailed === 1);
      stale += Number(rows[1]?.updatedAt === old.at && rows[1]?.stale === true);
      errors += rows.reduce((n, r) => n + (r.reuse?.refreshFailed ?? 0), 0);
    }
    weeklyCheck(e, 'community-typed-causes', typed, 4);
    weeklyCheck(e, 'community-stale-dates', stale, 4);
    weeklyCheck(e, 'community-true-error-failures', errors, 4);
    const none = await communityHandler({ read: async () => [], write: async () => {} }, async () => new Response('{"error":6}'))({ songs: songs.slice(0, 3) });
    weeklyCheck(e, 'community-confirmed-none-failures', none.reduce((n, r) => n + (r.status === 'none' ? r.reuse?.refreshFailed ?? 0 : 1), 0), 0);
  });
});
