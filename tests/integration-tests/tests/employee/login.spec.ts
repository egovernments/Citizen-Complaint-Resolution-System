import { test, expect } from '@playwright/test';
import { loginViaApi, staffContext } from '../utils/auth';
import { authorizeUrl, enterHostedUsername, identityJson } from '../utils/identity-bff';
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe('Employee Login — BFF', () => {
  test('valid credentials return access token', { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
    const context = await staffContext(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS }, 'employee');
    expect(Boolean(context.access_token)).toBe(true);
    expect(context.UserRequest.type).toBe('EMPLOYEE');
    expect(context.UserRequest.tenantId).toBe(TENANT);
    expect('refresh_token' in context).toBe(false);
  });

  test('bad credentials are rejected', { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
    await page.goto(authorizeUrl(BASE_URL, 'employee'));
    // An unknown login, not ADMIN with a wrong password: Keycloak answers both
    // with the same error, and this keeps brute-force protection off the persona.
    await enterHostedUsername(page, `pw-no-such-user-${Date.now()}`);
    await page.locator('#password').fill('wrong-password');
    // The digit-employee theme keeps #kc-login disabled until consent is ticked
    // (Login.tsx canSubmit); hostedSignIn ticks it the same way.
    await page.locator('#privacy-component-check').check({ force: true });
    await page.locator('#kc-login').click();
    // Login.tsx raises INVALID_LOGIN_CREDENTIALS as the theme's error toast.
    await expect(page.locator('#dg-toast[role="alert"]')).toBeVisible();
    const response = await page.request.get(`${BASE_URL}/identity/v1/session?surface=employee`);
    const session = await identityJson<{ authenticated: boolean; code: string }>(response, 401);
    expect(session.authenticated).toBe(false);
    expect(session.code).toBe('SESSION_REQUIRED');
  });

  test('API session injection loads employee home', { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
    await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    expect(page.url()).toContain('/employee');
    await expect(page).not.toHaveURL(/\/user\/login/);
    expect(await page.locator('body').innerText()).not.toContain('Something went wrong');
    expect(await page.evaluate(() => Boolean(localStorage.getItem('Employee.token')))).toBe(true);
  });
});
