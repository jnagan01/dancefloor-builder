import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { checkSectionMeterMotion } from './section-meter-motion.mjs';
// Chromium runner for the isolated synthetic meter fixture (build-section-meter.mjs, served on 8091).
const origin = process.env.SECTION_METER_ORIGIN ?? 'http://127.0.0.1:8091', shots = '/tmp/browser/section-meters/screenshots';
fs.mkdirSync(`${shots}/frames`, { recursive: true });
const browser = process.env.SECTION_METER_CDP ? await chromium.connectOverCDP(process.env.SECTION_METER_CDP) : await chromium.launch({ headless: true });
try {
  for (const [width, height] of [[1280, 1800], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.request().url().startsWith(`${origin}/`) ? r.continue() : r.abort());
    await page.goto(`${origin}/`); await page.waitForFunction(() => !!window.__meter);
    for (const theme of (process.env.METER_THEMES ?? 'light,dark').split(',')) {
      let n = 0;
      await checkSectionMeterMotion(page, { theme: theme, shots: width === 1280 ? shots : undefined,
        frames: width === 1280 ? async d => { for (let i = 0; i < 12; i++) { await d.screenshot({ path: `${shots}/frames/${theme}-${String(n++).padStart(2, '0')}.png` }); } } : undefined });
      console.log(`PASS section-meter motion ${width}px ${theme}`);
    }
    if (errors.length) throw Error(errors.join('\n'));
    await page.close();
  }
} finally { await browser.close(); }
