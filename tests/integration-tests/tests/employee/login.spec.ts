import { test, expect, type Page } from '@playwright/test';
import { loginViaApi, staffContext } from '../utils/auth';
import { authorizeUrl, identityJson } from '../utils/identity-bff';
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

/**
 * The wrong-password target: a Keycloak login with no DIGIT user and no roles
 * (scripts/seed-personas.ts seeds LOGIN_PROBE_LOGIN and writes its password),
 * so brute-force protection counts these failures against it, never a persona.
 */
const PROBE_LOGIN = process.env.LOGIN_PROBE_LOGIN?.trim() ?? '';

/** Keycloak's refusal: the stock theme's field error and feedback, the employee theme's toast and field error. */
const REFUSAL = '#input-error, #input-error-password, .kc-feedback-text, #dg-toast[role="alert"], .dg-field-error';

/**
 * Post a pair through the hosted form the way hostedSignIn does, whichever
 * Keycloak theme: one page or identity-first (username, then password), the
 * consent box ticked only where the theme has one, #kc-login or the plain
 * submit. Then Keycloak's refusal must show, and no session may result.
 */
async function expectRefused(page: Page, username: string, password: string): Promise<void> {
  await page.goto(authorizeUrl(BASE_URL, 'employee'));
  await page.locator('#username').fill(username);
  const submit = page.locator('#kc-login, button[type="submit"]').first();
  const refusal = page.locator(REFUSAL).first();
  const passwordField = page.locator('#password');
  if (!(await passwordField.isVisible())) {
    await submit.click();
    // Identity-first: an unknown login may be refused on the username page.
    await expect(passwordField.or(refusal).first()).toBeVisible();
  }
  if (await passwordField.isVisible()) {
    await passwordField.fill(password);
    const consent = page.locator('#privacy-component-check');
    // The digit-employee theme keeps #kc-login disabled until consent is ticked.
    if (await consent.count()) await consent.check({ force: true });
    await submit.click();
  }
  await expect(refusal).toBeVisible();
  const response = await page.request.get(`${BASE_URL}/identity/v1/session?surface=employee`);
  const session = await identityJson<{ authenticated: boolean; code: string }>(response, 401);
  expect(session.authenticated).toBe(false);
  expect(session.code).toBe('SESSION_REQUIRED');
}

// Only wrong passwords are typed here; persona sign-ins are browserless.
test.use({ storageState: { cookies: [], origins: [] } });
test.describe('Employee Login — BFF', () => {
  test('valid credentials return access token', { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
    const context = await staffContext(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS }, 'employee');
    expect(Boolean(context.access_token)).toBe(true);
    expect(context.UserRequest.type).toBe('EMPLOYEE');
    expect(context.UserRequest.tenantId).toBe(TENANT);
    expect('refresh_token' in context).toBe(false);
  });

  test('an unknown login is rejected', { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
    await expectRefused(page, `pw-no-such-user-${Date.now()}@example.invalid`, 'wrong-password');
  });

  test('a real account with a wrong password is rejected', { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
    expect(PROBE_LOGIN, 'Set LOGIN_PROBE_LOGIN in the env profile and seed it with scripts/seed-personas.ts').not.toBe('');
    await expectRefused(page, PROBE_LOGIN, `wrong-${Date.now()}`);
  });

  test('API session injection loads employee home', { tag: ['@area:auth', '@persona:employee'] }, async ({ page }) => {
    await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    expect(page.url()).toContain('/employee');
    await expect(page).not.toHaveURL(/\/user\/login/);
    expect(await page.locator('body').innerText()).not.toContain('Something went wrong');
    expect(await page.evaluate(() => Boolean(localStorage.getItem('Employee.token')))).toBe(true);
  });
});
