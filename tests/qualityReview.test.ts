import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { emptyKnowledge, readKnowledge, mergeKnowledgeAdditive, setFeedback, type PrepKnowledge } from '@/lib/prep/knowledge';
import { addQualitySample, rateQualityCandidate, deleteQualitySample, ratingCounts, QUALITY_LIMITS, type QualitySample } from '@/lib/prep/quality';
import { evaluateSample, compareRevisions, describeComparison, captureFromRanking, MIN_RATED } from '@/lib/prep/qualityEval';
import { commitQualitySample } from '@/lib/prep/qualityCommit';
import { createPrepStore } from '@/lib/prep/prepStore';
import { recommend, DEFAULT_REC_CONTROLS, type RecInput, type Candidate } from '@/lib/prep/recommend';
import { validateBackup } from '@/lib/backups';
import { syntheticEvidenceSample, syntheticVarietySample, SYNTHETIC_NOTICE } from './fixtures/syntheticQualitySamples';
const native = createRequire(import.meta.url)('../desktop/backups.cjs');

const input = (candidates: QualitySample['candidates']) => ({ name: 'Synthetic', requests: [{ artist: 'R', song: 'S' }], preferences: { genres: [], decades: [], artists: [] }, eventTags: [], candidates });
const withSample = (k: PrepKnowledge = emptyKnowledge()) => addQualitySample(k, input([
  { artist: 'A', song: '1', origin: 'library', rating: 'good' }, { artist: 'B', song: '2', origin: 'ai' }, { artist: 'C', song: '3', origin: 'catalogue' },
]));

describe('recommendation quality samples (account-local prep notes)', () => {
  it('captures unrated (never invents ratings) and leaves feedback/events untouched', () => {
    const k0 = setFeedback(emptyKnowledge(), 'X', 'Y', 'never');
    const k = withSample(k0);
    expect(k.quality![0].candidates.every(c => c.rating === undefined)).toBe(true);
    expect(k.feedback).toEqual(k0.feedback); expect(k.events).toEqual(k0.events);
    expect(JSON.stringify(k.quality)).not.toMatch(/trackId|filePath|\//);
  });

  it('rating set, change and clear only touches that candidate; never becomes Never/favourite', () => {
    let k = withSample(); const id = k.quality![0].id;
    k = rateQualityCandidate(k, id, 0, 'poor'); k = rateQualityCandidate(k, id, 0, 'good'); k = rateQualityCandidate(k, id, 1, 'maybe');
    expect(ratingCounts(k.quality![0])).toMatchObject({ good: 1, maybe: 1, unrated: 1, reviewed: 2, total: 3 });
    k = rateQualityCandidate(k, id, 0, null);
    expect(k.quality![0].candidates[0]).not.toHaveProperty('rating');
    expect(k.feedback).toEqual([]); expect(k.events).toEqual([]);
    expect(deleteQualitySample(k, id).quality).toEqual([]);
    expect(() => rateQualityCandidate(k, 'gone', 0, 'good')).toThrow();
  });

  it('is optional and backward compatible: legacy notes read without a passive quality field', () => {
    const legacy = JSON.parse(JSON.stringify(emptyKnowledge()));
    expect(readKnowledge(legacy)).toEqual(legacy);
    expect(readKnowledge(legacy)).not.toHaveProperty('quality');
    const k0 = withSample(), k = rateQualityCandidate(k0, k0.quality![0].id, 0, 'good');
    const saved = JSON.parse(JSON.stringify(k));
    expect(readKnowledge(saved)).toEqual(saved);
  });

  it('rejects malformed or oversized samples so the original bytes are preserved', () => {
    const k = JSON.parse(JSON.stringify(withSample()));
    for (const bad of [
      (x: any) => { x.quality[0].candidates[0].rating = 'excellent'; },
      (x: any) => { x.quality[0].candidates[0].playCount = -1; },
      (x: any) => { x.quality[0].candidates[0].decade = '90s'; },
      (x: any) => { x.quality[0].candidates = []; },
      (x: any) => { x.quality = Array.from({ length: QUALITY_LIMITS.samples + 1 }, (_, i) => ({ ...x.quality[0], id: `s${i}` })); },
      (x: any) => { x.quality.push(structuredClone(x.quality[0])); }, // duplicate id
      (x: any) => { x.quality = {}; },
    ]) { const c = structuredClone(k); bad(c); expect(readKnowledge(c)).toBeNull(); }
    expect(() => addQualitySample(emptyKnowledge(), input([]))).toThrow();
  });

  it('additive backup merge keeps existing ratings and adds missing samples', () => {
    let cur = withSample(); const id = cur.quality![0].id; cur = rateQualityCandidate(cur, id, 2, 'poor');
    const incoming = structuredClone(cur); incoming.quality![0].candidates[2].rating = 'good';
    const other = withSample();
    const r = mergeKnowledgeAdditive(cur, { ...incoming, quality: [...incoming.quality!, other.quality![0]] });
    expect(r.next.quality!.map(q => q.id)).toEqual([id, other.quality![0].id]);
    expect(r.next.quality![0].candidates[2].rating).toBe('poor');
    expect(mergeKnowledgeAdditive(emptyKnowledge(), emptyKnowledge()).next).not.toHaveProperty('quality');
  });

  it('backups with quality samples validate identically in browser and native validators', () => {
    const p0 = withSample(), prep = rateQualityCandidate(p0, p0.quality![0].id, 0, 'good');
    const b = { format: 'setarchitect-backup', version: 1, account: 'synthetic', createdAt: '2026-11-03T00:00:00Z', events: [], sources: [], roots: {}, prep };
    const raw = JSON.stringify(b);
    expect(validateBackup(raw, 'synthetic')).toEqual(JSON.parse(raw));
    expect(native.validate(raw, 'synthetic')).toEqual(JSON.parse(raw));
  });
});

describe('quality evaluator (labeled judgments only)', () => {
  it('reports no metric without enough ratings and counts unrated as missing coverage', () => {
    const s = structuredClone(syntheticEvidenceSample); s.candidates.forEach(c => delete c.rating);
    const e = evaluateSample(s);
    expect(e).toMatchObject({ enough: false, rated: 0, unrated: 6 }); expect(e.topK).toBeUndefined(); expect(e.gain).toBeUndefined();
    expect(describeComparison(compareRevisions(s), s).join(' ')).toMatch(new RegExp(`at least ${MIN_RATED}`));
    s.candidates[5].rating = 'good'; s.candidates[0].rating = 'poor'; s.candidates[1].rating = 'poor';
    const partial = evaluateSample(s);
    expect(partial).toMatchObject({ enough: true, rated: 3, unrated: 3 });
    const text = describeComparison(compareRevisions(s), s).join(' ');
    expect(text).toMatch(/3 of 6 tracks rated/); expect(text).toMatch(/counting only rated tracks/);
    expect(text).not.toMatch(/%|gain/i);
  });

  it(`synthetic benchmark (${SYNTHETIC_NOTICE}): current engine orders the evidence ladder and beats the captured order`, () => {
    const cmp = compareRevisions(syntheticEvidenceSample);
    const names = cmp.revision!.order.map(i => syntheticEvidenceSample.candidates[i].song);
    expect(names).toEqual(['Two Seeds Similar', 'One Seed Similar', 'File Tag House', 'Artist Similar', 'AI Genre Guess', 'No Evidence']);
    // Invariant: verified file-tag genre outranks the same genre as an AI estimate.
    expect(names.indexOf('File Tag House')).toBeLessThan(names.indexOf('AI Genre Guess'));
    expect(cmp.status).toBe('changed'); // fixture is deliberately saved weakest-first
    expect(cmp.revision!.gain).toBe(1);
    expect(cmp.captured.gain!).toBeLessThan(cmp.revision!.gain!);
    expect(cmp.revision!.topK).toEqual({ k: 5, good: 2, rated: 5 });
  });

  it('synthetic variety invariant and deterministic repeated evaluation', () => {
    const e = evaluateSample(syntheticVarietySample);
    const artists = e.order.map(i => syntheticVarietySample.candidates[i].artist);
    expect(artists.indexOf('Other Act')).toBeLessThan(artists.lastIndexOf('Repeat Act'));
    expect(evaluateSample(syntheticVarietySample)).toEqual(e);
  });

  it('compares ranking revisions on the same frozen sample without dropping candidates', () => {
    const reversed = (i: RecInput) => { const r = recommend(i); return { ...r, items: [...r.items].reverse() }; };
    const cmp = compareRevisions(syntheticEvidenceSample, reversed);
    expect(cmp.revision!.order).toHaveLength(6);
    expect(cmp.revision!.gain!).toBeLessThan(1);
  });

  it('samples saved before full context, or with truncated context, report comparison unavailable', () => {
    const old = structuredClone(syntheticEvidenceSample); delete old.controls;
    expect(compareRevisions(old).status).toBe('unavailable');
    expect(describeComparison(compareRevisions(old), old).join(' ')).toMatch(/saved before/);
    expect(compareRevisions({ ...syntheticEvidenceSample, truncated: true }).status).toBe('unavailable');
  });
});

describe('capture -> replay is faithful under the same ranking revision', () => {
  const lib = (artist: string, song: string, trackId: string, extra: Partial<Candidate['facts']> = {}, playCount?: number): Candidate => ({ artist, song, origin: 'library', trackId, playCount, facts: { owned: true, ...extra } });
  const many = Array.from({ length: 75 }, (_, i) => ({ artist: `Req ${i}`, song: `Req Song ${i}`, genre: i % 2 ? 'House' : 'Pop' }));
  const input = (): RecInput => ({
    candidates: [
      lib('Same', 'Title', 'z/second.mp3', { genre: 'House', genreSource: 'tags' }, 5), lib('Same', 'Title', 'a/first.mp3', { genre: 'House', genreSource: 'tags' }, 5),
      lib('Busy Artist', 'One', 'b/1.mp3', { genre: 'House', genreSource: 'tags' }, 0), lib('Fresh', 'Two', 'c/2.mp3', { genre: 'Pop', genreSource: 'tags' }),
      lib('Req 3', 'Other', 'd/3.mp3', {}, 40), { artist: 'Cat', song: 'Log', origin: 'catalogue', facts: { genre: 'House', genreSource: 'catalogue', decade: '1990s', decadeSource: 'catalogue' } },
      lib('Neighbour', 'N', 'e/4.mp3'), lib('Track Sim', 'T', 'f/5.mp3'),
    ],
    requests: [...many, ...many], // repeated requests count once
    inEvent: [{ artist: 'Busy Artist', song: 'Already 1' }, { artist: 'Busy Artist', song: 'Already 2' }, { artist: 'Fresh', song: 'Already 3' }],
    feedback: [{ key: 'fresh|two', label: 'Fresh – Two', kind: 'favor', at: 1 }], dismissed: [],
    notes: new Map([['c/2.mp3', { id: 'c/2.mp3', tags: ['singalong'], note: '', updatedAt: 1 }]]), eventTags: ['singalong'],
    similar: [{ artist: 'Neighbour', similarTo: 'Req 1', match: 0.4 }, { artist: 'neighbour', similarTo: 'Req 0', match: 0.8 }],
    similarTracks: [{ key: 'track sim|t', artist: 'Track Sim', song: 'T', seeds: Array.from({ length: 12 }, (_, i) => `Req ${i} – Req Song ${i}`), bestMatch: 0.5 }],
    preferences: { genres: ['house'], decades: ['1990s'], artists: ['Fresh'] },
    controls: { familiarity: 0.75, clientSimilarity: 0.6, artistVariety: 1, ownedOnly: false }, limit: 40,
  });
  it('reproduces order and scores with non-default controls, event artist counts, >60 requests, duplicate files and partial labels', () => {
    const i = input(), out = recommend(i);
    const captured = captureFromRanking(i, out.items, 'Replay');
    expect(captured.truncated).toBeUndefined();
    expect(captured.requests).toHaveLength(75);
    const k = addQualitySample(emptyKnowledge(), captured);
    const saved = readKnowledge(JSON.parse(JSON.stringify(k)))!; // storage round trip
    let s = saved.quality![0];
    expect(JSON.stringify(s)).not.toMatch(/\.mp3|\//);
    const same = s.candidates.filter(c => c.artist === 'Same');
    expect(same.map(c => c.tie)).toEqual([0, 1]); // first.mp3 before second.mp3, as in the panel
    let kk = rateQualityCandidate(saved, s.id, 0, 'good'); kk = rateQualityCandidate(kk, s.id, 3, 'poor'); s = kk.quality![0];
    const cmp = compareRevisions(s);
    expect(cmp.status).toBe('unchanged');
    expect(cmp.revision!.order).toEqual(s.candidates.map((_, n) => n));
    expect(describeComparison(cmp, s).join(' ')).toMatch(/same order and reasons/);
    // A real engine change is reported.
    const tweak = (x: RecInput) => recommend({ ...x, controls: { ...x.controls, familiarity: -1 } });
    expect(compareRevisions(s, tweak).status).toBe('changed');
  });
  it('marks a sample truncated (comparison unavailable) instead of silently dropping context', () => {
    const i = input(); i.requests = Array.from({ length: 320 }, (_, n) => ({ artist: `R${n}`, song: `S${n}` }));
    const s = addQualitySample(emptyKnowledge(), captureFromRanking(i, recommend(i).items, 'Big')).quality![0];
    expect(s.truncated).toBe(true); expect(s.requests).toHaveLength(QUALITY_LIMITS.requests);
    expect(compareRevisions(s).status).toBe('unavailable');
  });
});

describe('sample save reports success only after a committed same-owner write', () => {
  const sample = () => captureFromRanking({ candidates: [{ artist: 'A', song: 'B', origin: 'catalogue', facts: {} }], requests: [], inEvent: [], feedback: [], dismissed: [], controls: DEFAULT_REC_CONTROLS }, [{ artist: 'A', song: 'B', origin: 'catalogue', facts: {}, key: 'a|b', score: 0, evidence: [] }], 'S');
  it('a failing write reports the error and nothing is stored', async () => {
    const data = new Map<string, unknown>();
    const store = createPrepStore({ read: async k => data.get(k), write: async () => { throw Error('disk full'); } });
    await store.setAccount('a');
    const r = await commitQualitySample(store, store.owner(), sample());
    expect(r).toEqual({ ok: false, message: 'disk full' });
    expect(store.get().knowledge.quality).toBeUndefined();
  });
  it('an account switch during the write rejects it as stale; the other account gets nothing', async () => {
    const data = new Map<string, unknown>(); let release!: () => void;
    const store = createPrepStore({ read: async k => data.get(k), write: async (k, v) => { await new Promise<void>(r => { release = r; }); data.set(k, v); } });
    await store.setAccount('a'); const owner = store.owner();
    const pending = commitQualitySample(store, owner, sample());
    await Promise.resolve(); await Promise.resolve();
    void store.setAccount('b'); release();
    const r = await pending;
    expect(r.ok).toBe(false);
    await store.settled(store.owner()!).catch(() => undefined);
    expect(store.get().account).toBe('b'); expect(store.get().knowledge.quality).toBeUndefined();
  });
  it('success only when committed', async () => {
    const data = new Map<string, unknown>();
    const store = createPrepStore({ read: async k => data.get(k), write: async (k, v) => { data.set(k, v); } });
    await store.setAccount('a');
    expect(await commitQualitySample(store, store.owner(), sample())).toEqual({ ok: true, count: 1 });
    expect(await commitQualitySample(store, null, sample())).toMatchObject({ ok: false });
  });
});
