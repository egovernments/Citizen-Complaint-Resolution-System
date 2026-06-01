/**
 * Configurator login — empty-default regression (CCRS #412).
 *
 * Chromium (and some password managers) used to auto-fill the
 * `/configurator/login` form with a previous session's username +
 * password because the inputs neither explicitly cleared their initial
 * value nor carried autocomplete-defeating attributes. Operators opening
 * the page on a fresh browser would see stale credentials pre-filled,
 * with "Sign In" enabled — one misclick and they'd be signed in as the
 * wrong principal.
 *
 * Fix (PR #28, d501bbf): every login input renders with an explicit
 * empty default, the form is `autocomplete="off"`, and the password
 * field is `autocomplete="new-password"` (the only directive Chromium
 * actually honours against its autofill heuristic).
 *
 * This spec walks the login page without any stored session so it sees
 * exactly what a fresh operator sees.
 */
import { test, expect } from '@playwright/test';

// Opt out of the storageState written by auth.setup.ts — we need the
// unauthenticated login form, not the post-login /manage surface.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('configurator login — empty defaults (#412)', () => {
  test('username, password, tenant inputs render empty on initial load', async ({ page }) => {
    await page.goto('/configurator/login');

    const username = page.locator('input#username');
    const password = page.locator('input#password');
    const tenant = page.locator('input#tenantCode');

    await expect(username).toBeVisible();
    await expect(password).toBeVisible();
    await expect(tenant).toBeVisible();

    // `toHaveValue('')` asserts the DOM value is literally empty —
    // browser autofill writes into .value so a regression would trip
    // this even when the React state is clean.
    await expect(username).toHaveValue('');
    await expect(password).toHaveValue('');
    await expect(tenant).toHaveValue('');
  });

  test('form + password input carry autocomplete-off attributes', async ({ page }) => {
    await page.goto('/configurator/login');

    // Form-level `autocomplete="off"` suppresses the browser's
    // save-password prompt on the login surface.
    const form = page.locator('form').first();
    await expect(form).toHaveAttribute('autocomplete', 'off');

    // `new-password` is the only value Chromium respects to skip
    // auto-filling a previously-saved password into this field.
    const password = page.locator('input#password');
    await expect(password).toHaveAttribute('autocomplete', 'new-password');
  });
});
