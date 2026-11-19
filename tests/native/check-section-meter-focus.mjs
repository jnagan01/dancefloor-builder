import { chromium } from '@playwright/test';
import { checkSectionMeterFocus } from './section-meter-focus.mjs';

const origin = 'http://127.0.0.1:8091';
const browser = process.env.SECTION_METER_CDP
  ? await chromium.connectOverCDP(process.env.SECTION_METER_CDP)
  : await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => r.request().url().startsWith(`${origin}/`) ? r.continue() : r.abort());
  await page.goto(origin);
  await page.evaluate(async () => {
    document.getElementById('root').remove();
    const root = document.createElement('div'); root.id = 'root'; document.body.append(root);
    const songs = Array.from({ length: 12 }, (_, i) => ({ artist: `TEST Focus ${i}`, song: `Track ${i}` }));
    window.__fixture = { meterDelay: 800, tracks: songs.map((s, i) => ({ artist: s.artist, title: s.song, filePath: `/synthetic/${i}.mp3`, songLength: 180 })) };
    window.__errors = []; window.__warnings = []; window.__success = [];
    window.testBackend = { read: async () => null, write: async d => ({ id: d.id, updatedAt: new Date().toISOString(), revision: d.writeRevision }), list: async () => ({ data: [], error: null }), library: async () => {}, export: async () => ({ ok: true }) };
    await import('/route.js');
  });
  await page.waitForFunction(() => typeof window.__rerender === 'function');
  await page.evaluate(() => { window.__testState.eventId = undefined; window.__rerender(); });
  await page.getByRole('radio', { name: /^Dance floor$/i }).click();
  await page.locator('#hours').fill('0.6'); await page.locator('#eventName').fill('Focus route fixture');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const csv = 'Artist,Song\n' + Array.from({ length: 12 }, (_, i) => `TEST Focus ${i},Track ${i}`).join('\n');
  await page.locator('input[type=file][accept=".csv,.txt"]').setInputFiles({ name: 'focus.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: /Review songs/ }).first().click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await checkSectionMeterFocus(page);
  if (errors.length) throw Error(errors.join('\n'));
  await page.screenshot({ path: '/tmp/browser/section-meters/screenshots/focus-return.png' });
  console.log('PASS actual-route initial Generate, keyboard hide/reopen, automatic close, regeneration and direct close focus');
} finally { await browser.close(); }