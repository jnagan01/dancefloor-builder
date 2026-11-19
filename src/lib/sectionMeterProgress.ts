export type MeterKey = 'warmUp' | 'transition' | 'peak';
export type MeterTotals = Record<MeterKey, number>;
export type MeterRun = { id: number; owner: string | null; event: string | undefined; type: string; expand: boolean; targets: MeterTotals; totals: MeterTotals; started: number; stage: string; open: boolean; finished: boolean };
/** Ephemeral, per-editor observations only. No persistence, ranking or scheduling. */
export function createSectionMeterProgress(now = Date.now) {
  let run: MeterRun | null = null, last = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(f => f());
  return {
    get: () => run,
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
    begin(input: Omit<MeterRun, 'totals' | 'started' | 'stage' | 'open' | 'finished'>) {
      run = { ...input, targets: { ...input.targets }, totals: { warmUp: 0, transition: 0, peak: 0 }, started: now(), stage: 'Preparing your choices', open: true, finished: false }; last = 0; emit();
    },
    update(id: number, stage: string, totals?: MeterTotals | (() => MeterTotals), force = false) {
      if (!run || run.id !== id || run.finished) return;
      if (!force && run.stage === stage && now() - last < 250) return;
      last = now(); run = { ...run, stage, totals: totals ? { ...(typeof totals === 'function' ? totals() : totals) } : run.totals }; emit();
    },
    finish(id: number, stage: string, totals: MeterTotals) {
      if (!run || run.id !== id) return;
      run = { ...run, stage, totals: { ...totals }, finished: true }; emit();
    },
    visible(id: number, open: boolean) { if (run?.id !== id || (open && run.finished)) return; run = { ...run, open }; emit(); },
    release(id: number) { if (run?.id !== id) return; run = null; emit(); },
  };
}
export type SectionMeterProgress = ReturnType<typeof createSectionMeterProgress>;
export const meterMinutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;