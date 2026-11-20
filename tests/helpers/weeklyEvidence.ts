import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';

export type WeeklyCategory = 'lookup' | 'slow' | 'coverage' | 'cache' | 'pacing';
type Evidence = {
  checks: Array<{ rule: string; expected: number; actual: number; passed: boolean }>;
  sections: Array<{ section: string; seconds: number; target: number }>;
  causes: Record<string, Record<string, number>>;
};
/** Only isolated focused CI writes evidence. No console parsing, exception text, URLs or track data. */
export async function weeklyEvidence(id: string, category: WeeklyCategory, run: (e: Evidence) => Promise<void> | void) {
  const e: Evidence = { checks: [], sections: [], causes: {} };
  let status = 'failed';
  try { await run(e); status = 'passed'; }
  finally {
    const dir = process.env.WEEKLY_EVIDENCE_DIR;
    if (dir) {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${id}.json`), temp = `${file}.tmp`;
      writeFileSync(temp, JSON.stringify({ schema: 1, id, category, status,
        commit: process.env.GITHUB_SHA ?? 'local', run_id: process.env.GITHUB_RUN_ID ?? 'local',
        run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? '1', seed: process.env.WEEKLY_SEED ?? '20261116', ...e }));
      renameSync(temp, file);
    }
  }
}
export function weeklyCheck(e: Evidence, rule: string, actual: number, expected: number, passed = actual === expected) {
  e.checks.push({ rule, actual, expected, passed });
  expect(passed, rule).toBe(true);
}