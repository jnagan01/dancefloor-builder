import { expect } from '@playwright/test';
// Rendered interpolation contract for the section meters. Drives the real dialog through the
// synthetic progress model only; numbers/ARIA must equal measured totals at every instant.
const targets = { warmUp: 5400, transition: 14400, peak: 7200 };
const bar = (page, label) => page.getByRole('progressbar', { name: `${label} usable preparation time` });
async function visual(page, label) {
  return bar(page, label).locator('[data-meter-fill]').evaluate(el => {
    const clip = getComputedStyle(el).clipPath; if (clip === 'none') return 1;
    const args = (clip.match(/inset\(([^)]*)\)/)?.[1] ?? '').trim().split(/\s+/);
    const right = parseFloat(args[1] ?? args[0] ?? 'NaN'); return 1 - right / 100;
  });
}
const begin = (page, id) => page.evaluate(([id, targets]) => window.__meter.begin({ id, owner: 'synthetic', event: 'A', type: 'dance', expand: true, targets }), [id, targets]);
const update = (page, id, totals) => page.evaluate(([id, totals]) => window.__meter.update(id, 'Checking synthetic tracks', totals, true), [id, totals]);
// Apply a measured update, then sample every real rendered frame for ~1s in-page.
// mid: first strictly intermediate fill; gap: largest distance between the visible leading edge and the clipped fill.
const updateAndSample = (page, id, totals, label) => page.evaluate(async ([id, totals, label]) => {
  const meter = document.querySelector(`[role=progressbar][aria-label="${label} usable preparation time"]`);
  const el = meter.querySelector('[data-meter-fill]'), lead = meter.querySelector('[data-meter-leading]');
  const read = () => { const args = (getComputedStyle(el).clipPath.match(/inset\(([^)]*)\)/)?.[1] ?? '').trim().split(/\s+/); return 1 - parseFloat(args[1] ?? args[0]) / 100; };
  const from = read(); window.__meter.update(id, 'Checking synthetic tracks', totals, true);
  const key = { 'Warm Up': 'warmUp', Transition: 'transition', Peak: 'peak' }[label], to = Math.min(1, totals[key] / window.__meter.get().targets[key]);
  const start = performance.now(); let mid = null, gap = 0, leadSamples = 0, last = from;
  while (performance.now() - start < 1000) {
    await new Promise(r => requestAnimationFrame(r)); last = read();
    if (mid === null && Math.abs(last - from) > 0.01 && Math.abs(last - to) > 0.01) mid = last;
    if (lead && Number(getComputedStyle(lead).opacity) > 0.05) {
      const f = el.getBoundingClientRect(), l = lead.getBoundingClientRect();
      gap = Math.max(gap, Math.abs((l.left + l.width / 2 - f.left) / f.width - last)); leadSamples++;
    }
  }
  return { mid: mid ?? last, gap, leadSamples };
}, [id, totals, label]);
// Sample a full glow pulse (>1.6s) per real frame; effective opacity multiplies the edge wrapper and pulsing glow.
const pulse = (page, label) => page.evaluate(async label => {
  const lead = document.querySelector(`[role=progressbar][aria-label="${label} usable preparation time"] [data-meter-leading]`);
  if (!lead) return { min: 0, max: 0, frames: 0, mounted: 0 };
  let min = Infinity, max = 0, frames = 0; const t0 = performance.now();
  while (performance.now() - t0 < 1800) {
    await new Promise(r => requestAnimationFrame(r)); frames++;
    const v = Number(getComputedStyle(lead).opacity) * Number(getComputedStyle(lead.firstElementChild).opacity);
    min = Math.min(min, v); max = Math.max(max, v);
  }
  return { min, max, frames, mounted: 1 };
}, label);
const zero = { warmUp: 0, transition: 0, peak: 0 };

export async function checkSectionMeterMotion(page, { theme, shots, frames } = {}) {
  // Background/occluded pages may not produce animation frames; observe as a visible user would.
  await page.bringToFront(); await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (theme) await page.getByRole('button', { name: theme, exact: true }).click();
  const base = 10_000 + Math.floor(Math.random() * 1000);
  await begin(page, base);
  const dialog = page.getByRole('dialog', { name: 'Building your lists' }); await expect(dialog).toBeVisible();
  expect(await visual(page, 'Warm Up')).toBe(0);
  const atZero = await pulse(page, 'Warm Up');
  expect(atZero.mounted, 'edge stays mounted for continuous interpolation').toBe(1); expect(atZero.frames).toBeGreaterThan(1);
  expect(atZero.max, 'zero-fill edge invisible through a whole pulse').toBe(0);
  // 1. Upward measured update interpolates visually; values are immediate and truthful.
  const first = await updateAndSample(page, base, { ...zero, warmUp: 2700, transition: 3600 }, 'Warm Up'), mid = first.mid;
  expect(first.leadSamples, 'leading edge rendered during first transition').toBeGreaterThan(0);
  expect(first.gap, 'leading edge stays on the fill during zero-to-positive transition').toBeLessThan(0.03);
  await expect(bar(page, 'Warm Up')).toHaveAttribute('aria-valuenow', '2700');
  await expect(dialog).toContainText('45:00 / 90:00 min');
  expect(mid, 'intermediate fill before measured target').toBeGreaterThan(0.01); expect(mid).toBeLessThan(0.49);
  if (frames) await frames(dialog);
  if (shots) await dialog.screenshot({ path: `${shots}/motion-${theme}-mid.png` });
  expect(Math.abs(await visual(page, 'Warm Up') - 0.5)).toBeLessThan(0.01);
  expect(Math.abs(await visual(page, 'Transition') - 0.25)).toBeLessThan(0.01);
  // 2. Ongoing work stays lively (leading glow) but coverage never advances on a timer.
  await expect(bar(page, 'Warm Up').locator('.meter-leading')).toHaveCount(1);
  expect(await bar(page, 'Warm Up').locator('.meter-leading').evaluate(el => getComputedStyle(el).animationName)).toBe('meter-glow');
  const partial = await pulse(page, 'Warm Up');
  expect(partial.max, 'partial edge visible').toBeGreaterThan(0.3); expect(partial.min).toBeGreaterThan(0);
  const idle = await visual(page, 'Warm Up'); await page.waitForTimeout(1500);
  expect(await visual(page, 'Warm Up')).toBe(idle); await expect(bar(page, 'Warm Up')).toHaveAttribute('aria-valuenow', '2700');
  // 3. Downward revision remains visible.
  const lower = await updateAndSample(page, base, { ...zero, warmUp: 1800, transition: 3600 }, 'Warm Up'), down = lower.mid;
  expect(lower.leadSamples).toBeGreaterThan(0); expect(lower.gap, 'leading edge follows downward fill').toBeLessThan(0.03);
  await expect(bar(page, 'Warm Up')).toHaveAttribute('aria-valuenow', '1800');
  expect(down).toBeLessThan(0.499); expect(down).toBeGreaterThan(1 / 3 + 0.005);
  expect(Math.abs(await visual(page, 'Warm Up') - 1 / 3)).toBeLessThan(0.01);
  await update(page, base, { ...zero, warmUp: 1800, transition: 3600, peak: 7200 }); await page.waitForTimeout(1300);
  expect(await visual(page, 'Peak')).toBeGreaterThan(0.99);
  const atFull = await pulse(page, 'Peak');
  expect(atFull.max, 'full edge invisible through a whole pulse').toBe(0);
  // 4. A new run resets immediately without carrying or animating out the old fill.
  await begin(page, base + 1);
  expect(await visual(page, 'Warm Up')).toBe(0); expect(await visual(page, 'Transition')).toBe(0);
  await expect(bar(page, 'Warm Up')).toHaveAttribute('aria-valuenow', '0');
  // 5. Truthful completion: a shortage never reaches 100%; over-target keeps its real number.
  await update(page, base + 1, { warmUp: 5390, transition: 14400, peak: 8000 });
  await page.waitForTimeout(1200);
  await page.evaluate(id => window.__meter.finish(id, 'Lists ready', { warmUp: 5390, transition: 14400, peak: 8000 }), base + 1);
  const short = await visual(page, 'Warm Up');
  expect(short).toBeLessThan(1); expect(short).toBeGreaterThan(0.9);
  await expect(page.getByLabel('Warm Up target reached')).toHaveCount(0);
  await expect(page.getByLabel('Transition target reached')).toBeVisible(); await expect(page.getByLabel('Peak target reached')).toBeVisible();
  expect(await visual(page, 'Transition')).toBe(1); expect(await visual(page, 'Peak')).toBe(1);
  await expect(bar(page, 'Peak')).toHaveAttribute('aria-valuenow', '8000'); await expect(dialog).toContainText('133:20 / 120:00 min');
  await expect(bar(page, 'Warm Up')).toHaveAttribute('aria-valuenow', '5390');
  if (shots) await dialog.screenshot({ path: `${shots}/motion-${theme}-finished.png` });
  await expect(dialog).toBeHidden({ timeout: 5000 });
  // 6. Reduced motion: static, immediate measured fill with no glow animation.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await begin(page, base + 2); await update(page, base + 2, { ...zero, warmUp: 2700 });
  await expect(bar(page, 'Warm Up')).toHaveAttribute('aria-valuenow', '2700');
  expect(Math.abs(await visual(page, 'Warm Up') - 0.5)).toBeLessThan(0.001);
  expect(await bar(page, 'Warm Up').locator('.meter-leading').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.evaluate(id => window.__meter.finish(id, 'Lists ready', { warmUp: 2700, transition: 0, peak: 0 }), base + 2);
  await expect(dialog).toBeHidden({ timeout: 5000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
