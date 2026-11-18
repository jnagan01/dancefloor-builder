import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const root = process.cwd();

// Use each runner's actual build options/plugin, not a parallel alias list that can drift.
async function rendererBundle(runner: string) {
  const source = readFileSync(path.join(root, 'tests/native', runner), 'utf8');
  const start = source.indexOf('const stub');
  const end = source.indexOf('const css', start);
  if (start < 0 || end < start) throw Error('Fixture build configuration unavailable');
  let captured: any;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('root', 'path', 'bundle', 'build', source.slice(start, end))(root, path, '/tmp/native-diagnostic-bundle-test', async (options: any) => { captured = options; });
  expect(captured.platform).toBe('browser');
  return build({ ...captured, write: false, metafile: true, logLevel: 'silent' });
}

it.each(['run.mjs', 'prep.mjs'])('%s bundles actual diagnostic UI/store with synthetic relay/auth and no server runtime', async runner => {
  const result = await rendererBundle(runner);
  const inputs = Object.keys(result.metafile.inputs);
  expect(inputs).toContain('src/components/GenerationActivity.tsx');
  expect(inputs).toContain('src/lib/generationDiagnostics/store.ts');
  expect(inputs.some(p => /fixtures\/(?:prep-)?services\.tsx$/.test(p))).toBe(true);
  expect(inputs.filter(p => /generationDiagnostics\/relay\.|integrations\/supabase\/|@tanstack\/react-start|@tanstack\/start-/.test(p))).toEqual([]);
  const code = result.outputFiles.map((f: any) => f.text).join('\n');
  expect(code).not.toMatch(/BETTER_STACK_SOURCE_TOKEN|BETTER_STACK_INGESTING_HOST|node:async_hooks|node:stream|#tanstack-router-entry|#tanstack-start-entry|tanstack-start-manifest:v/);
}, 20000);

it('standalone offline/race renderers remain browser-safe with no generation relay/auth dependency', async () => {
  // Both harnesses serve these unchanged assets directly, not the React event renderer.
  for (const file of ['app.js', 'core.js', 'policy.cjs']) {
    const result = await build({ entryPoints: [path.join(root, 'desktop/offline', file)], bundle: true, platform: 'browser', write: false, metafile: true, logLevel: 'silent' });
    expect(Object.keys(result.metafile.inputs).every(p => p.startsWith('desktop/offline/'))).toBe(true);
    expect(result.outputFiles.map((f: any) => f.text).join('\n')).not.toMatch(/BETTER_STACK_SOURCE_TOKEN|BETTER_STACK_INGESTING_HOST|generationDiagnostics\/relay|node:async_hooks|#tanstack-start-entry/);
  }
});