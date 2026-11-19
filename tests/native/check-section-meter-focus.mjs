import { chromium, expect } from '@playwright/test';
import { checkSectionMeterFocus } from './section-meter-focus.mjs';
import { generationReady } from './generation-ready.mjs';
import JSZip from 'jszip';
import fs from 'node:fs/promises';

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
  // Actual route reproduction of the hosted six-row upload failure, including
  // invalid preflight, correction, modal dwell, accessible completion and ZIP contents.
  await page.evaluate(() => { window.__testState.eventId = undefined; window.__fixture.meterDelay = 800; window.__rerender(); });
  await page.getByRole('radio', { name: /^Dance floor$/i }).click();
  await page.locator('#hours').fill('3');
  await page.getByRole('button', { name: /Upload lists/ }).first().click();
  const six = 'Artist,Song\nOne,Song One\nTwo,Song Two\nThree,Song Three\nFour,Song Four\nFive,Song Five\nArtist Only,\n';
  await page.locator('input[type=file][accept=".csv,.txt"]').setInputFiles({ name: 'six.csv', mimeType: 'text/csv', buffer: Buffer.from(six) });
  await page.getByRole('button', { name: /Review songs/ }).first().click();
  const rows = page.locator('tbody tr'); await expect(rows).toHaveCount(6);
  await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.locator('#buffer').selectOption('2');
  await page.getByRole('button', { name: 'Generate dance floor lists', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__errors.at(-1))).toContain('missing a song title');
  await expect(rows).toHaveCount(6); await expect(page.getByRole('dialog')).toBeHidden();
  await rows.nth(5).locator('input').nth(1).fill('Corrected Song');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Generate dance floor lists', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Building your lists' })).toBeVisible();
  // Observe actual completion dwell: background exports remain excluded from ARIA.
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Lists ready', { timeout: 30000 });
  expect(await page.getByRole('button', { name: 'Export All Files as ZIP', exact: false }).count()).toBe(0);
  await generationReady(page);
  expect(await page.getByRole('button', { name: 'Export All Files as ZIP', exact: false }).count()).toBe(1);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export All Files as ZIP', exact: false }).click();
  const download = await downloaded;
  const zip = await JSZip.loadAsync(await fs.readFile(await download.path()));
  const text = (await Promise.all(Object.values(zip.files).filter(f => f.name.endsWith('.csv')).map(f => f.async('string')))).join('\n');
  for (const title of ['Song One','Song Two','Song Three','Song Four','Song Five','Corrected Song']) expect(text).toContain(title);
  console.log('PASS six-row invalid/corrected upload: modal dwell excludes export, bounded automatic close restores export, all six ZIP titles preserved');
  if (errors.length) throw Error(errors.join('\n'));
  await page.screenshot({ path: '/tmp/browser/section-meters/screenshots/focus-return.png' });
  console.log('PASS actual-route initial Generate, keyboard hide/reopen, automatic close, regeneration and direct close focus');
} finally { await browser.close(); }