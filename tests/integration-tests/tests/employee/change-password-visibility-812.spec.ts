/**
 * Employee password action is a visible button (CCRS #812).
 *
 * #812 was a "Change password" control that rendered as plain text. Since
 * #1999 the profile's change-password form is gone: identity-managed staff
 * reach Keycloak's UPDATE_PASSWORD action from "Account and security"
 * (UserProfile.js -> /employee/user/account, IdentityAccount.js). This
 * spec walks that path and keeps the original styling assertion on the
 * password button. UPDATE_PASSWORD is in keycloak/realm.json's
 * clientPolicy.accountActions, so the button is expected on every deployment.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { loginViaApi } from '../utils/auth';
import { surfacePath } from '../utils/identity-bff';

test.describe('employee account — password action visibility #812', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Account and security shows a styled password button', { tag: ['@persona:employee'] }, async ({ page }) => {
    await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });

    await page.goto(`${BASE_URL}${surfacePath('employee', 'user/profile')}?cb=${Date.now()}`);
    const accountButton = page.getByRole('button', { name: /account and security/i });
    await expect(accountButton, 'identity-managed profile must link to Account and security').toBeVisible({ timeout: 15_000 });
    await accountButton.click();

    await expect(page).toHaveURL(/\/employee\/user\/account/);
    await expect(page.getByRole('heading', { name: /account and security/i })).toBeVisible({ timeout: 15_000 });

    // IdentityAccount.js ACTIONS.UPDATE_PASSWORD: "Set or update password".
    const passwordButton = page.getByRole('button', { name: /password/i }).first();
    await expect(passwordButton).toBeVisible({ timeout: 15_000 });

    // The #812 assertion: a real button surface, not transparent or white text.
    const backgroundColor = await passwordButton.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(backgroundColor).not.toBe('rgb(255, 255, 255)');
  });
});
