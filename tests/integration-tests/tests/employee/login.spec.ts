/**
 * Employee Login E2E
 *
 * Tests employee authentication:
 *   1. API token acquisition (valid + invalid credentials)
 *   2. API session injection → employee home page loads
 */
import { test, expect } from '@playwright/test';
import { getDigitToken, loginViaApi } from '../utils/auth';
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

test.describe('Employee Login — API', () => {
  test('valid credentials return access token', {
    annotation: {
      type: 'description',
      description: `Smoke check that the OAuth password grant returns a usable access_token for the seeded ADMIN principal at root tenant. If this fails, every test that needs an admin token (most of the suite) will fail downstream.

Steps:
1. Call getDigitToken with ROOT_TENANT, ADMIN_USER, ADMIN_PASS.
2. Assert the response.access_token is truthy.

Pairs with the bad-credentials negative case to bracket login behavior.`,
    },
    tag: ['@area:auth', '@kind:regression', '@layer:api', '@persona:employee'] }, async () => {
    const tokenResponse = await getDigitToken({
      tenant: ROOT_TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });
    expect(tokenResponse.access_token).toBeTruthy();
  });

  test('bad credentials are rejected', {
    annotation: {
      type: 'description',
      description: `Negative case — wrong password must throw. Catches a regression where the OAuth endpoint silently returns a token for an invalid password (which would mean any user could impersonate any other).

Steps:
1. Call getDigitToken with ROOT_TENANT, ADMIN_USER, password 'wrong-password'.
2. Assert the promise rejects.

Pairs with the positive case to ensure the auth surface fails closed.`,
    },
    tag: ['@area:auth', '@kind:edge-case', '@layer:api', '@persona:employee'] }, async () => {
    await expect(
      getDigitToken({
        tenant: ROOT_TENANT,
        username: ADMIN_USER,
        password: 'wrong-password',
      }),
    ).rejects.toThrow();
  });
});

test.describe('Employee Login — UI', () => {
  test('API session injection loads employee home', {
    annotation: {
      type: 'description',
      description: `Confirms the loginViaApi helper (used by most tests) can put a Playwright page into a logged-in state without driving the UI form: it acquires a token, injects it into localStorage, and lands on /employee/. Asserts the home page renders without a generic error banner.

Steps:
1. loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS }).
2. Assert page.url() contains '/employee'.
3. Read body innerText and assert it does NOT contain 'Something went wrong'.

This is a layer-api setup test even though it ends with a UI assertion — the login is the API call; the page check is just confirming the helper actually worked.`,
    },
    tag: ['@area:auth', '@kind:regression', '@layer:api', '@persona:employee'] }, async ({ page }) => {
    await loginViaApi(page, {
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

    expect(page.url()).toContain('/employee');

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('Something went wrong');
  });
});
