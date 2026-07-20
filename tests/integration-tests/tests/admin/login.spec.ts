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
import { ROOT_TENANT } from '../utils/env';

// Opt out of the storageState written by auth.setup.ts — we need the
// unauthenticated login form, not the post-login /manage surface.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('configurator login — empty defaults (#412)', () => {
  test('username, password, tenant inputs render empty on initial load', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#412 (empty-default regression): the configurator login form used to let Chromium / password managers pre-fill stale credentials, leaving Sign In enabled — a misclick would sign in as the wrong principal. Post-fix every input renders with an explicit empty default. Test opts out of the auth storageState so it sees the fresh, unauthenticated login form.

Steps:
1. Drop admin storageState (test.use storageState empty).
2. Navigate to /configurator/login.
3. Locate input#username, input#password, input#tenantCode.
4. Assert all three are visible.
5. Assert username + password toHaveValue('') — DOM value is literally empty. The tenant field is intentionally PRE-FILLED with the deployment's configured root tenant (an empty tenantCode silently sends an empty tenantId to /user/oauth/token), so it must equal the configured code ('' only on unconfigured dev builds).

Browser autofill writes into .value, so a regression would trip this assertion even when the React state is clean.`,
    },
    tag: ['@area:auth', '@area:configurator-manage', '@ccrs:412', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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
    // Tenant is intentionally pre-filled with the configured root tenant
    // (build-time VITE_STATE_TENANT_ID): an empty tenantCode silently sends
    // an empty tenantId to /user/oauth/token. Accept the configured code, or
    // '' on unconfigured dev builds. Stale-credential autofill (the #412
    // regression) is still caught by the username/password asserts above.
    await expect(tenant).toHaveValue(new RegExp(`^(?:${ROOT_TENANT}|)$`));
  });

  test('form + password input carry autocomplete-off attributes', {
    annotation: {
      type: 'description',
      description: `Asserts the autocomplete-defeating attributes that prevent CCRS#412 from coming back. The form must carry autocomplete="off" (suppresses the browser's save-password prompt), and the password field must carry autocomplete="new-password" — that's the only value Chromium respects to skip auto-filling a saved password.

Steps:
1. Drop admin storageState.
2. Navigate to /configurator/login.
3. Locate the first form on the page; assert autocomplete="off".
4. Locate input#password; assert autocomplete="new-password".

Pairs with the empty-defaults test above — together they enforce both the React-side cleanup AND the browser-side hint.`,
    },
    tag: ['@area:auth', '@area:configurator-manage', '@ccrs:412', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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
