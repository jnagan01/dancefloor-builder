import { expect, it } from 'vitest';
import { createSectionMeterProgress } from '@/lib/sectionMeterProgress';
const input = { id: 1, owner: 'synthetic', event: 'A', type: 'dance', expand: true, targets: { warmUp: 5400, transition: 14400, peak: 7200 } };
it('measured totals may decrease, exceed targets and never fabricate coverage or mutate captured inputs', () => {
  let time = 0; const p = createSectionMeterProgress(() => time); p.begin(input);
  p.update(1, 'Checking', { warmUp: 5500, transition: 500, peak: 0 });
  expect(p.get()?.totals.warmUp).toBe(5500); time = 300;
  p.update(1, 'Checking', { warmUp: 2000, transition: 0, peak: 0 });
  expect(p.get()?.totals.warmUp).toBe(2000);expect(input.targets.warmUp).toBe(5400);
});
it('old updates/releases cannot affect a fresh run and hidden completion never reopens', () => {
  const p = createSectionMeterProgress(); p.begin(input); p.visible(1, false);
  p.finish(1, 'Short', { warmUp: 0, transition: 0, peak: 0 }); expect(p.get()?.open).toBe(false);
  p.begin({ ...input, id: 2 });p.update(1, 'Old');p.finish(1, 'Old', input.targets);p.release(1);
  expect(p.get()).toMatchObject({ id: 2, stage: 'Preparing your choices', open: true, finished: false });
});
it('bounded observations do not calculate coverage during suppressed updates or timer ticks', () => {
  let time=0,calls=0; const p=createSectionMeterProgress(()=>time);p.begin(input);
  p.update(1,'Check',()=>{calls++;return input.targets;});
  for(let i=0;i<50;i++)p.update(1,'Check',()=>{calls++;return input.targets;});
  expect(calls).toBe(1);time=250;p.update(1,'Check',()=>{calls++;return input.targets;});expect(calls).toBe(2);
});