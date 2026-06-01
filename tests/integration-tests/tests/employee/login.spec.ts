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
  test('valid credentials return access token', async () => {
    const tokenResponse = await getDigitToken({
      tenant: ROOT_TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });
    expect(tokenResponse.access_token).toBeTruthy();
  });

  test('bad credentials are rejected', async () => {
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
  test('API session injection loads employee home', async ({ page }) => {
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
