import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
test('built service starts independently and fails closed without secrets', { timeout: 15000 }, async () => {
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const child = spawn(process.execPath, ['dist/server.mjs'], { cwd: root, env: { PATH: process.env.PATH, PORT: String(port), APP_ENV: 'prototype-test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let error = ''; child.stderr.on('data', b => { error += b.toString(); });
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', b => { if (b.toString().includes('test API listening')) resolve(); }); child.on('exit', code => reject(Error('Service failed to start: ' + code + ' ' + error))); });
    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(base + '/healthz').then(r => r.json());
    assert.equal(health.environment, 'prototype-test'); assert.equal(health.configured, false);
    const denied = await fetch(base + '/v1/rpc/listWorkflows', { method: 'POST', body: '{}' });
    assert.equal(denied.status, 503);
  } finally { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
});
