import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { emptyKnowledge, readKnowledge, mergeKnowledgeAdditive, setFeedback, type PrepKnowledge } from '@/lib/prep/knowledge';
import { addQualitySample, rateQualityCandidate, deleteQualitySample, ratingCounts, QUALITY_LIMITS, type QualitySample } from '@/lib/prep/quality';
import { evaluateSample, compareRevisions, describeEvaluation, MIN_RATED } from '@/lib/prep/qualityEval';
import { recommend, type RecInput } from '@/lib/prep/recommend';
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
    expect(describeEvaluation(e)).toMatch(new RegExp(`at least ${MIN_RATED}`));
    s.candidates[5].rating = 'good'; s.candidates[0].rating = 'poor'; s.candidates[1].rating = 'poor';
    const partial = evaluateSample(s);
    expect(partial).toMatchObject({ enough: true, rated: 3, unrated: 3 });
    expect(describeEvaluation(partial)).toMatch(/3 of 6 rated tracks only/);
    expect(describeEvaluation(partial)).not.toMatch(/%/);
  });

  it(`synthetic benchmark (${SYNTHETIC_NOTICE}): current engine orders the evidence ladder and beats the captured order`, () => {
    const cmp = compareRevisions(syntheticEvidenceSample);
    const names = cmp.revision.order.map(i => syntheticEvidenceSample.candidates[i].song);
    expect(names).toEqual(['Two Seeds Similar', 'One Seed Similar', 'File Tag House', 'Artist Similar', 'AI Genre Guess', 'No Evidence']);
    // Invariant: verified file-tag genre outranks the same genre as an AI estimate.
    expect(names.indexOf('File Tag House')).toBeLessThan(names.indexOf('AI Genre Guess'));
    expect(cmp.revision.gain).toBe(1);
    expect(cmp.captured.gain!).toBeLessThan(cmp.revision.gain!);
    expect(cmp.revision.topK).toEqual({ k: 5, good: 2, rated: 5 });
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
    expect(cmp.revision.order).toHaveLength(6);
    expect(cmp.revision.gain!).toBeLessThan(1);
  });
});
