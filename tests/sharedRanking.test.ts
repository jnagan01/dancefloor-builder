import { describe, it, expect } from 'vitest';
import { recommend, rankPool, explainTop, DEFAULT_REC_CONTROLS, type Candidate, type RecInput } from '@/lib/prep/recommend';
import { aiCandidate, catalogueCandidate, expansionRankContext, placeRanked, similarArtistEvidence } from '@/lib/prep/expansionRanking';
import { emptyKnowledge, setFeedback, dismissForEvent, setEventTags, setTrackNote, songIdentity } from '@/lib/prep/knowledge';
import { aggregateSimilar } from '@/lib/prep/similarTracks';

// Synthetic, isolated fixtures only.
const lib = (artist: string, song: string, extra: Partial<Candidate['facts']> = {}, trackId = `id/${artist}/${song}`): Candidate =>
  ({ artist, song, origin: 'library', trackId, facts: { owned: true, ...extra } });
const requests = [{ artist: 'Seed A', song: 'One' }, { artist: 'Seed B', song: 'Two' }];
const simTracks = aggregateSimilar([
  { seed: { artist: 'Seed A', title: 'One' }, status: 'ok', similar: [{ artist: 'Double', title: 'Hit', match: 0.5 }, { artist: 'Single', title: 'Hit', match: 0.9 }] },
  { seed: { artist: 'Seed B', title: 'Two' }, status: 'ok', similar: [{ artist: 'Double', title: 'Hit', match: 0.4 }] },
]);
const base = (candidates: Candidate[], extra: Partial<RecInput> = {}): RecInput => ({
  candidates, requests, inEvent: [], feedback: [], dismissed: [], similarTracks: simTracks,
  similar: [{ artist: 'Neighbour', similarTo: 'Seed A', match: 0.9 }], controls: DEFAULT_REC_CONTROLS, limit: 50, ...extra,
});

describe('shared ranking engine', () => {
  it('panel recommend and expansion rankPool give identical scores and explanations for the same context', () => {
    const cands = [lib('Double', 'Hit'), lib('Single', 'Hit'), lib('Neighbour', 'Song'), lib('Plain', 'Song', { genre: 'House', genreSource: 'tags' })];
    let k = emptyKnowledge(); k = setEventTags(k, 'E', ['singalong']); k = setTrackNote(k, 'id/Plain/Song', { tags: ['singalong'] });
    const ctx = expansionRankContext({ knowledge: k, eventId: 'E', requests, rows: [], similar: [{ artist: 'Neighbour', similarTo: 'Seed A', match: 0.9 }], similarTracks: simTracks, preferences: { genres: ['house'] } });
    const panel = recommend({ ...ctx, controls: DEFAULT_REC_CONTROLS, candidates: cands, limit: 10 });
    const pooled = rankPool(cands, c => c, ctx);
    expect(pooled.map(x => [x.rec.key, x.rec.score, x.rec.evidence])).toEqual(panel.items.map(r => [r.key, r.score, r.evidence]));
    expect(panel.items.map(r => r.artist)).toEqual(['Double', 'Single', 'Plain', 'Neighbour']); // tag + preferred genre (2) > artist-level Last.fm 0.9 (1.8)
  });

  it('origin does not earn points: AI claims cannot fabricate evidence and AI genre is weaker than verified', () => {
    const ai = aiCandidate({ artist: 'X', song: 'Y', genre: 'House', year: 2015 });
    const cat = catalogueCandidate({ artist: 'X2', song: 'Y', genre: 'House', year: 2015 });
    const out = recommend(base([{ ...ai }, { ...cat }, { artist: 'Z', song: 'Q', origin: 'ai', facts: {} }], { preferences: { genres: ['House'], decades: ['2010s'] }, similarTracks: [], similar: [] }));
    const by = Object.fromEntries(out.items.map(r => [r.artist, r]));
    expect(by.Z.score).toBe(0);
    expect(by.X2.score).toBeGreaterThan(by.X.score);
    expect(by.X.evidence.every(e => /AI estimate/.test(e.text))).toBe(true);
  });

  it('eligibility first: Never, event dismissal and exact selected file are excluded even with strong evidence', () => {
    let k = emptyKnowledge(); k = setFeedback(k, 'Double', 'Hit', 'favor'); k = setFeedback(k, 'Double', 'Hit', 'never'); k = dismissForEvent(k, 'E', 'Single', 'Hit', 'tooSlow');
    const ctx = expansionRankContext({ knowledge: k, eventId: 'E', requests, rows: [], similarTracks: simTracks });
    const r = recommend({ ...ctx, controls: DEFAULT_REC_CONTROLS, candidates: [lib('Double', 'Hit'), lib('Single', 'Hit'), lib('Other', 'Song', {}, 'exact/file'), lib('Other', 'Song (Remix)', {}, 'exact/file2')], inEventTrackIds: ['exact/file'] });
    expect(r.items.map(x => x.song)).toEqual(['Song (Remix)']);
    expect(r.hidden).toMatchObject({ never: 1, dismissed: 1, inEvent: 1 });
    // Dismissal on another event does not leak.
    const other = expansionRankContext({ knowledge: k, eventId: 'F', requests, rows: [], similarTracks: simTracks });
    expect(rankPool([lib('Single', 'Hit')], c => c, other)).toHaveLength(1);
  });

  it('track evidence across distinct requests > one request > artist similarity; repeated requests do not inflate', () => {
    const cands = [lib('Neighbour', 'Song'), lib('Single', 'Hit'), lib('Double', 'Hit')];
    const once = recommend(base(cands));
    const repeated = recommend(base(cands, { requests: [...requests, ...requests, { artist: 'seed a', song: 'one' }] }));
    expect(once.items.map(r => r.artist)).toEqual(['Double', 'Single', 'Neighbour']);
    expect(repeated.items.map(r => [r.artist, r.score])).toEqual(once.items.map(r => [r.artist, r.score]));
    expect(once.items[2].evidence[0].text).toMatch(/artist-level/);
  });

  it('a favourite does not override stronger evidence; genre counts use distinct requests', () => {
    const k = setFeedback(emptyKnowledge(), 'Fav', 'Song', 'favor');
    const ctx = expansionRankContext({ knowledge: k, eventId: null, requests: [{ artist: 'R', song: 'S', genre: 'House' }, { artist: 'R', song: 'S', genre: 'House' }, { artist: 'R2', song: 'S2', genre: 'Pop' }], rows: [], similarTracks: simTracks });
    const out = rankPool([lib('Fav', 'Song'), lib('Double', 'Hit'), lib('G', 'H', { genre: 'House', genreSource: 'tags' })], c => c, ctx);
    expect(out[0].rec.artist).toBe('Double');
    expect(out.find(x => x.rec.artist === 'G')!.rec.evidence[0].text).toMatch(/matches 1 of 2 client requests/);
  });

  it('artist variety counts additions already chosen', () => {
    const cands = [lib('Neighbour', 'A'), lib('Neighbour', 'B'), lib('Other', 'C')];
    const fresh = recommend(base(cands, { similar: [{ artist: 'Neighbour', similarTo: 'Seed A', match: 0.9 }, { artist: 'Other', similarTo: 'Seed A', match: 0.7 }] }));
    expect(fresh.items.map(r => r.song)).toEqual(['A', 'C', 'B']);
    const chosen = recommend(base(cands, { inEvent: [{ artist: 'Neighbour', song: 'Already chosen' }], similar: [{ artist: 'Neighbour', similarTo: 'Seed A', match: 0.9 }, { artist: 'Other', similarTo: 'Seed A', match: 0.7 }] }));
    expect(chosen.items[0].song).toBe('C');
    expect(chosen.items.find(r => r.song === 'A')!.evidence.some(e => e.kind === 'variety')).toBe(true);
  });

  it('is deterministic regardless of input order, and explanations have no point values', () => {
    const cands = Array.from({ length: 60 }, (_, i) => lib(`Artist ${i % 7}`, `Song ${i}`, i % 3 ? { genre: 'House', genreSource: 'tags' } : {}));
    const ctx = { ...base([]), preferences: { genres: ['House'] } };
    const a = rankPool(cands, c => c, ctx).map(x => x.rec.key);
    const b = rankPool([...cands].reverse(), c => c, ctx).map(x => x.rec.key);
    expect(b).toEqual(a);
    const why = explainTop(recommend(base([lib('Double', 'Hit')])).items[0]);
    expect(why).toMatch(/similar to 2 requested tracks/); expect(why).not.toMatch(/\+\d/);
  });

  it('ranks a 31,250-track library within a bounded time', () => {
    const cands = Array.from({ length: 31250 }, (_, i) => lib(`Artist ${i % 4000}`, `Song ${i}`, { genre: i % 2 ? 'House' : 'Pop', genreSource: 'tags', decade: `${1970 + (i % 5) * 10}s`, decadeSource: 'tags' }));
    const t = performance.now();
    const out = recommend(base(cands, { preferences: { genres: ['House'], decades: ['1990s'] }, limit: 40 }));
    expect(performance.now() - t).toBeLessThan(3000);
    expect(out.items).toHaveLength(40);
  });

  it('rankPool over a 31,250-item pool with a small limit stays bounded (no quadratic pass over all items)', () => {
    const items = Array.from({ length: 31250 }, (_, i) => lib(`Artist ${i % 4000}`, `Song ${i}`, { genre: 'House', genreSource: 'tags' }));
    const t = performance.now();
    const out = rankPool(items, c => c, { ...base([]), preferences: { genres: ['House'] } }, 40);
    expect(performance.now() - t).toBeLessThan(3000);
    expect(out).toHaveLength(40);
  });

  it('placement cycles sections in rank order and never pads', () => {
    const rows: Record<string, string[]> = { a: [], b: [] };
    const placed = placeRanked(['1', '2', '3', '4', '5'], ['a', 'b'], k => rows[k].length < 2, (k, x) => rows[k].push(x));
    expect(placed).toBe(4); expect(rows).toEqual({ a: ['1', '3'], b: ['2', '4'] });
    expect(placeRanked([], ['a'], () => true, () => { throw Error('no'); })).toBe(0);
  });

  it('similar-artist evidence only comes from requested artists', () => {
    const ev = similarArtistEvidence([{ name: 'Seed A', similar: [{ name: 'N', match: 0.5 }] }, { name: 'Favourite Only', similar: [{ name: 'M', match: 0.9 }] }], ['seed a']);
    expect(ev).toEqual([{ artist: 'N', similarTo: 'Seed A', match: 0.5 }]);
    expect(songIdentity('A', 'B (Remix)')).not.toBe(songIdentity('A', 'B'));
  });
});
