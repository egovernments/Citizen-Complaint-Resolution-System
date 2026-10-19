import { test, expect } from '@playwright/test';
import { loginViaApi } from '../../utils/auth';
import { requiredEnv } from '../../utils/identity';

const BASE_URL = requiredEnv('BASE_URL');
const TENANT = requiredEnv('DIGIT_TENANT');
const ADMIN_USER = requiredEnv('DIGIT_USERNAME');
const ADMIN_PASS = requiredEnv('DIGIT_PASSWORD');
const SESSION_URL = `${BASE_URL}/identity/v1/session?surface=employee`;

test.describe('Employee Logout', () => {
  test('the rail logout ends the BFF session', async ({ page }) => {
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    expect((await page.request.get(SESSION_URL)).status()).toBe(200);

    // The sign-in page that logout lands on starts a fresh sign-in at once; hold
    // it, so a live Keycloak SSO cookie cannot open a new session before we look.
    await page.route('**/identity/v1/authorize**', (route) => route.abort());
    await page.locator('.digit-sidebar-logout').click();
    const logout = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/identity/v1/logout' && r.request().method() === 'POST',
    );
    await page.locator('.digit-logout-popup-wrapper').getByRole('button', { name: /log ?out/i }).click();
    expect((await logout).ok()).toBe(true);

    expect((await page.request.get(SESSION_URL)).status()).toBe(401);
  });
});
