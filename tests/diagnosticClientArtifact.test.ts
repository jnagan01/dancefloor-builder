import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

it('production client inspection fails closed for missing artifacts and server-only diagnostic content', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-diagnostic-client-'));
  const check = () => spawnSync(process.execPath, ['scripts/check-diagnostic-client.mjs', dir], { encoding: 'utf8' });
  try {
    expect(check().status).not.toBe(0);
    fs.writeFileSync(path.join(dir, 'client.js'), 'export const build = "synthetic";');
    expect(check().status).toBe(0);
    for (const forbidden of ['BETTER_STACK_SOURCE_TOKEN', 'BETTER_STACK_INGESTING_HOST', 'SYNTHETIC CONNECTION CHECK — no user data']) {
      fs.writeFileSync(path.join(dir, 'client.js'), forbidden);
      expect(check().status).not.toBe(0);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});