import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { adaptSource } from '../scripts/adapt-source.mjs';
const base = path.resolve(import.meta.dirname, '..');
const upstream = fs.existsSync(path.join(base, '../source/src')) ? path.resolve(base, '../source') : path.resolve(base, '..');
test('actual shared suggestion handler survives a deadline before the AI stream opens', { timeout: 15000 }, async () => {
  const outfile = path.join(base, 'dist/deadline-regression.mjs');
  await build({ entryPoints: [path.join(base, 'tests/fixtures/deadline-entry.mjs')], outfile, platform: 'node', target: 'node22', format: 'esm', bundle: true, packages: 'external', alias: { '@': path.join(upstream, 'src') }, plugins: [{ name: 'late-provider-regression', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'UPSTREAM_RECOMMEND') return { path: path.join(upstream, 'src/lib/recommend.functions.ts') };
      if (args.path === '@tanstack/react-start' || args.path === '@/integrations/supabase/auth-middleware') return { path: path.join(base, 'src/boundary.ts') };
      if (args.path.endsWith('ai-gateway.server')) return { path: path.join(base, 'tests/fixtures/late-provider.mjs') };
    });
    b.onLoad({ filter: /\.ts$/ }, async args => args.path.startsWith(path.join(upstream, 'src')) ? { contents: adaptSource(await fs.promises.readFile(args.path, 'utf8'), args.path, base), loader: 'ts', resolveDir: path.dirname(args.path) } : undefined);
  } }] });
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', outfile], { env: { PATH: process.env.PATH, GEMINI_API_KEY: 'synthetic-test-no-network' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 0, output);
  assert.match(output, /late-provider-deadline-cleanup-passed/);
});
