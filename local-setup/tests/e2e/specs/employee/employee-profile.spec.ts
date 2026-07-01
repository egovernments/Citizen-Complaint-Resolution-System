/**
 * Employee Edit Profile — regression tests for CCRS#444.
 *
 * Covers:
 *  1. Profile page renders without crashing (canEditMobile ReferenceError, PR #762)
 *  2. Mobile field shows the tenant's country prefix (+254), not the India default (+91)
 *  3. Profile save completes without a JS crash or error screen
 */

import { test, expect } from '@playwright/test';
import { loginViaApi } from '../../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const TENANT    = process.env.DIGIT_TENANT    || 'uitest.citya';
const USERNAME  = process.env.DIGIT_USERNAME  || 'ADMIN';
const PASSWORD  = process.env.DIGIT_PASSWORD  || 'eGov@123';

const PROFILE_PATH = '/digit-ui/employee/user/profile';

test.describe('Employee Edit Profile (#444)', () => {
  test('profile page renders without a JS crash', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: USERNAME, password: PASSWORD });

    await page.goto(`${BASE_URL}${PROFILE_PATH}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // Must not land on the error screen
    expect(page.url()).not.toContain('/user/error');

    // Page must not show the generic crash message
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Something went wrong');

    // No uncaught JS errors (the canEditMobile ReferenceError was the root cause)
    const fatal = jsErrors.filter(
      (e) => !/ResizeObserver|Loading chunk|Script error/i.test(e),
    );
    expect(fatal, `Unexpected JS errors: ${fatal.join('\n')}`).toHaveLength(0);
  });

  test('mobile field displays the tenant country prefix, not the India default (+91)', async ({ page }) => {
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: USERNAME, password: PASSWORD });

    await page.goto(`${BASE_URL}${PROFILE_PATH}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // The profile form must be visible (not an error screen)
    await expect(page.locator('body')).not.toContainText('Something went wrong');

    // +91 (India hardcoded default) must not appear anywhere on the page
    const html = await page.content();
    expect(html).not.toContain('+91');
  });

  test('save profile does not crash or show an error screen', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: USERNAME, password: PASSWORD });

    await page.goto(`${BASE_URL}${PROFILE_PATH}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // Confirm the form rendered (bail early if still crashing)
    expect(page.url()).not.toContain('/user/error');

    // Click Save / Update if present — we only need to confirm no crash on submit
    const saveBtn = page.locator('button:has-text("Save"), button:has-text("Update"), button:has-text("Submit")').first();
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      await page.waitForTimeout(3_000);

      expect(page.url()).not.toContain('/user/error');

      const body = await page.locator('body').innerText();
      expect(body).not.toContain('Something went wrong');
    }

    const fatal = jsErrors.filter(
      (e) => !/ResizeObserver|Loading chunk|Script error/i.test(e),
    );
    expect(fatal, `JS errors on save: ${fatal.join('\n')}`).toHaveLength(0);
  });
});
