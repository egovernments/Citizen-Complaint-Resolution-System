/**
 * Account actions ask for the password again as a confirmation (CCRS #2645).
 *
 * From /<slug>/digit-ui/employee/user/account, "Set or update password" sends
 * the person to Keycloak with kc_action and login_hint. The digit-employee
 * theme then says "Confirm it's you to change your password", shows the
 * username prefilled and read-only, and offers Cancel back to the account
 * page. Signing in continues into the action: the update-password form.
 *
 * The password is typed on a hosted page, so tracing is off for this file
 * (the same rule as hostedSignIn's guard). The update-password form is never
 * submitted, so the persona's password is unchanged.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { loginViaApi } from '../utils/auth';
import { surfacePath } from '../utils/identity-bff';

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off', video: 'off' });

test.describe('employee account — confirm it is you before an account action #2645', () => {
  async function openPasswordAction(page: import('@playwright/test').Page) {
    await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    await page.goto(`${BASE_URL}${surfacePath('employee', 'user/account')}?cb=${Date.now()}`);
    await expect(page.getByRole('heading', { name: /account and security/i })).toBeVisible({ timeout: 15_000 });
    // IdentityAccount.js ACTIONS.UPDATE_PASSWORD; absent where the realm does not offer the action.
    const passwordButton = page.getByRole('button', { name: /set or update password/i });
    test.skip(!(await passwordButton.isVisible()), 'UPDATE_PASSWORD is not offered on this deployment');
    await passwordButton.click();
    await expect(page.locator('#kc-page-title')).toContainText(/confirm it.s you/i, { timeout: 30_000 });
  }

  test('Set or update password asks to confirm, prefilled, then continues into the action',
    { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
      await openPasswordAction(page);
      await expect(page.locator('#kc-page-title')).toContainText(/change your password/i);

      const username = page.locator('input[name="username"]');
      await expect(username).toHaveValue(ADMIN_USER);
      await expect(username).toHaveAttribute('readonly', /.*/);

      await page.locator('#password').fill(ADMIN_PASS);
      const consent = page.locator('#privacy-component-check');
      if (await consent.count()) await consent.check({ force: true });
      await page.locator('#kc-login, button[type="submit"]').first().click();

      await expect(page.locator('#password-new')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#password-confirm')).toBeVisible();
    });

  test('Cancel on the confirmation returns to the account page',
    { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
      await openPasswordAction(page);
      await page.locator('#kc-cancel').click();
      await expect(page).toHaveURL(/\/employee\/user\/account/, { timeout: 30_000 });
      await expect(page.getByRole('heading', { name: /account and security/i })).toBeVisible({ timeout: 15_000 });
    });
});
