import { expect } from '@playwright/test';

// Shared by the isolated Electron event runner and the Chromium route check.
// Caller supplies the real route at its initial Generate step with delayed synthetic details.
export async function checkSectionMeterFocus(page) {
  const dialog = page.getByRole('dialog', { name: 'Building your lists' });
  const generate = page.getByRole('button', { name: 'Generate dance floor lists', exact: true });
  const regenerate = page.getByRole('button', { name: 'Regenerate', exact: true });
  const show = page.getByRole('button', { name: 'Show progress', exact: true });
  async function returned() {
    await expect(regenerate).toBeVisible();
    await expect(regenerate).toBeEnabled();
    await expect(regenerate).toBeFocused();
    expect(await regenerate.evaluate(e => e.isConnected && e.getClientRects().length > 0)).toBe(true);
  }
  await generate.focus(); await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('progressbar')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Hide window', exact: true }).click();
  await expect(show).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 30000 });
  await returned();

  // Regeneration without hiding must also return to the current enabled control.
  await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 30000 }); await returned();

  // A direct close remains dismissal-only, including when Show progress disappears on finish.
  await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Hide progress window', exact: true }).click();
  await expect(show).toBeFocused();
  await expect(show).toBeHidden({ timeout: 30000 });
  await expect(dialog).toBeHidden(); await returned();
}