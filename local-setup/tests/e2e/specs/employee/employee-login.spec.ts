import { test, expect } from '@playwright/test';
import { loginViaApi } from '../../utils/auth';
import { acceptHostedConsent, authorizeUrl, enterHostedUsername, requiredEnv } from '../../utils/identity';

const BASE_URL = requiredEnv('BASE_URL');
const TENANT = requiredEnv('DIGIT_TENANT');
const ADMIN_USER = requiredEnv('DIGIT_USERNAME');
const ADMIN_PASS = requiredEnv('DIGIT_PASSWORD');

test.describe('Employee sign-in (Keycloak + Identity BFF)', () => {
  test('hosted sign-in lands on the employee home with a route-tenant session', async ({ page }) => {
    const context = await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    expect(context.UserRequest.tenantId).toBe(TENANT);
    expect(context.UserRequest.type).toBe('EMPLOYEE');
  });

  test('hosted form rejects a wrong password and starts no session', async ({ page }) => {
    await page.goto(authorizeUrl(BASE_URL, 'employee'));
    await enterHostedUsername(page, ADMIN_USER);
    await page.locator('#password').fill(`${ADMIN_PASS}-wrong`);
    await acceptHostedConsent(page);
    await page.locator('#kc-login, button[type="submit"]').first().click();

    await expect(page.locator('#dg-toast[role="alert"], #input-error').first()).toBeVisible();
    expect(new URL(page.url()).pathname).not.toContain('/digit-ui/');
    const session = await page.request.get(`${BASE_URL}/identity/v1/session?surface=employee`);
    expect(session.status()).toBe(401);
  });
});
