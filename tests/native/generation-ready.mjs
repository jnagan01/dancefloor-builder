import { expect } from '@playwright/test';

// Generation results can be saved before the completion dialog's dwell ends.
// Wait for both real completion and the accessible review surface, never bypass the modal.
export async function generationReady(page, timeout = 30000) {
  await expect(page.getByRole('dialog', { name: 'Building your lists' })).toBeHidden({ timeout });
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeEnabled({ timeout });
  await expect(page.getByRole('button', { name: 'Export All Files as ZIP', exact: false })).toBeVisible({ timeout });
}