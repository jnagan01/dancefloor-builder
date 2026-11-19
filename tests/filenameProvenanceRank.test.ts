import { expect, it } from 'vitest';
import { mergeMeta, sourceRank } from '../src/lib/prep/provenance';

it('keeps filename at rank 1, tied with estimate, without displacing equal provenance', () => {
  expect(sourceRank('filename')).toBe(1);
  expect(sourceRank('filename')).toBe(sourceRank('estimate'));
  const filename = { bpm: 120, metaProv: { bpm: 'filename' as const } };
  const estimate = { bpm: 120, metaProv: { bpm: 'estimate' as const } };
  expect(mergeMeta(filename, { bpm: 130 }, 'estimate')).toBe(filename);
  expect(mergeMeta(estimate, { bpm: 130 }, 'filename')).toBe(estimate);
});