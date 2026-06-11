/**
 * Citizen entry flow.
 *
 * The legacy first-visit language-selection gate ("Continue" screen)
 * no longer exists: the V2 citizen home renders the All Services page
 * directly with a language switcher in the header. These tests cover
 * the same intent against the current UI — the home renders for an
 * anonymous visitor, and the login route presents the mobile-number
 * form.
 */
import { test, expect } from '@playwright/test';

test.describe('Citizen Flow', () => {
  test('citizen home renders with language switcher and services', async ({ page }) => {
    await page.goto('/digit-ui/citizen');

    const body = page.locator('body');
    await expect(body).toContainText(/english/i, { timeout: 30_000 });
    await expect(body).toContainText(/all services/i);

    // Anonymous visitor: the header offers Login.
    await expect(page.getByRole('button', { name: /login/i }).first()).toBeVisible();
  });

  test('login route shows the mobile-number form', async ({ page }) => {
    await page.goto('/digit-ui/citizen/login');

    const mobileInput = page.locator('input[type="tel"]').first();
    await mobileInput.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(
      page.locator('button[type="submit"], button:has-text("Continue")').first()
    ).toBeVisible();
  });
});
