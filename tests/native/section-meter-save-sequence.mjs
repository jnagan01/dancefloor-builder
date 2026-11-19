import { expect } from '@playwright/test';
import { checkSectionMeterFocus } from './section-meter-focus.mjs';
import { generationReady } from './generation-ready.mjs';

export async function checkSectionMeterSaveSequence(page, readRows) {
  const song = { artist: 'Test Artist', song: 'Test Song - Live' };
  await page.evaluate(() => { window.__testState.eventId = undefined; window.__rerender(); });
  await page.getByRole('radio', { name: /^Dance floor$/i }).click();
  await page.locator('#hours').fill('1'); await page.locator('#eventName').fill('Explicit fresh choices');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const file = { name: 'fresh.csv', mimeType: 'text/csv', buffer: Buffer.from('Artist,Song\nTest Artist,Test Song - Live\n') };
  await page.locator('input[type=file][accept=".csv,.txt"]').setInputFiles(file);
  await page.getByRole('button', { name: /Review songs/ }).first().click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.evaluate(() => { window.__fixture.meterDelay = 800; });
  await checkSectionMeterFocus(page);
  await page.evaluate(() => { delete window.__fixture.meterDelay; });
  const dance = async () => Object.values(await readRows()).find(r => r.name === 'Explicit fresh choices');
  await expect.poll(dance, { timeout: 15000 }).toBeTruthy();
  expect((await dance()).inputs).toMatchObject({ hours: '1', buffer: 1, listType: 'dance', expand: false });
  expect((await dance()).inputs.songs).toEqual([song]);
  const originalDance = await dance();

  await page.evaluate(() => { window.__testState.eventId = undefined; window.__rerender(); });
  await page.getByRole('radio', { name: 'Dinner', exact: true }).click();
  await expect(page.locator('#minutes')).toHaveValue('');
  await page.locator('#minutes').fill('15'); await page.locator('#eventName').fill('Explicit dinner');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('input[type=file][accept=".csv,.txt"]').setInputFiles(file);
  await page.getByRole('button', { name: /Review songs/ }).first().click();
  await page.getByRole('button', { name: 'Generate dinner playlist', exact: true }).click();
  await generationReady(page);
  const dinner = async () => Object.values(await readRows()).find(r => r.name === 'Explicit dinner');
  await expect.poll(dinner, { timeout: 15000 }).toBeTruthy();
  const original = await dinner();
  expect(original.id).not.toBe(originalDance.id);
  expect(await dance()).toEqual(originalDance);
  expect(original.inputs).toMatchObject({ listType: 'dinner', minutes: '15', decades: [], requireCleanVersions: false, ownedOnlyExpansion: false, expand: false });
  expect([...original.lists.warmUp, ...original.lists.transition, ...original.lists.peak]).toHaveLength(1);
  await page.evaluate(id => { window.__testState.eventId = id; window.__rerender(); }, original.id);
  await expect(page.getByRole('heading', { name: 'Explicit dinner', exact: true })).toBeVisible();
  await expect(page.getByText('Saved event needs review', { exact: false })).toHaveCount(0);
  expect(await dinner()).toEqual(original);
}