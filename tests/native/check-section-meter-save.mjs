import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkSectionMeterSaveSequence } from './section-meter-save-sequence.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'section-meter-save-'));
const backend = path.join(temp, 'backend.json');
const originalA = { id: 'A', name: 'Saved preferences', updated_at: '2026-10-31T01:59:00Z', inputs: { eventName: 'Saved preferences', songs: [], hours: '1', buffer: 1, listType: 'dance', expand: false }, lists: { warmUp: [], transition: [], peak: [], selections: {} } };
await fs.writeFile(backend, JSON.stringify({ A: originalA }));
const rows = async () => JSON.parse(await fs.readFile(backend, 'utf8'));
const browser = process.env.SECTION_METER_CDP ? await chromium.connectOverCDP(process.env.SECTION_METER_CDP) : await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1800 } });
  await page.route('**/*', r => r.request().url().startsWith('http://127.0.0.1:8091/') ? r.continue() : r.abort());
  await page.exposeFunction('syntheticRead', async id => (await rows())[id] ?? null);
  await page.exposeFunction('syntheticWrite', async r => {
    const data = await rows(), old = data[r.id], field = '__setarchitect_write_revision_v1';
    if (r.create && old) { if (old.inputs[field] !== r.writeRevision) throw Error('Conflict'); return { id: r.id, revision: r.writeRevision, updatedAt: old.updated_at }; }
    if (!r.create && (!old || (old.inputs[field] ?? null) !== r.expectedRevision)) throw Error('Synthetic conflict');
    data[r.id] = { id: r.id, name: r.name, inputs: { ...r.inputs, [field]: r.writeRevision }, lists: r.lists, updated_at: '2026-10-31T01:59:00Z' };
    await fs.writeFile(backend + '.tmp', JSON.stringify(data)); await fs.rename(backend + '.tmp', backend);
    return { id: r.id, revision: r.writeRevision, updatedAt: data[r.id].updated_at };
  });
  await page.goto('http://127.0.0.1:8091');
  await page.evaluate(async () => {
    document.getElementById('root').remove(); const root = document.createElement('div'); root.id = 'root'; document.body.append(root);
    window.__fixture = { tracks: [{ artist: 'Test Artist', title: 'Test Song - Live', filePath: '/synthetic/live.mp3', songLength: 240 }] };
    window.__errors = []; window.__warnings = []; window.__success = [];
    window.testBackend = { read: window.syntheticRead, write: window.syntheticWrite, list: async () => ({ data: [], error: null }), library: async () => {}, export: async () => ({ ok: true }) };
    await import('/route.js');
  });
  await page.waitForFunction(() => typeof window.__rerender === 'function');
  try { await checkSectionMeterSaveSequence(page, rows); }
  catch (e) {
    console.log('Synthetic sequence evidence', JSON.stringify({ rows: await rows(), ui: await page.evaluate(() => ({ errors: window.__errors, warnings: window.__warnings, recovery: Object.keys(localStorage).filter(k => k.includes('recovery')).map(k => [k, localStorage.getItem(k)]) })) }));
    throw e;
  }
  if (JSON.stringify((await rows()).A) !== JSON.stringify(originalA)) throw Error('Prior saved fixture changed');
  console.log('PASS durable actual-route dance / three focus generations / new Dinner / save and reopen');
} finally { await browser.close(); await fs.rm(temp, { recursive: true, force: true }); }