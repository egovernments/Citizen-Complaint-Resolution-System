/**
 * Employee profile — country prefix regression (CCRS #444 sub-1).
 *
 * The Edit Profile mobile-number field used to render a hardcoded
 * `+91` prefix block regardless of tenant. On a Kenya deployment this
 * is wrong cosmetically AND functionally — a save attempt would then
 * fail validation (sub-3), because the Kenya MDMS rule expects a
 * +254 / 0-prefixed number.
 *
 * Fix (PR #30, 2f6008c) reads the country code out of tenantInfo and
 * renders it in the `.citizen-card-input--front` block. On naipepea
 * the tenant is `ke.nairobi` so the prefix must be `+254`.
 *
 * We deliberately stop short of submitting the form — the logged-in
 * ADMIN is a shared principal and we don't want a passing test to
 * mutate their profile.
 */
import { test, expect } from '@playwright/test';

import { BASE_URL } from '../utils/env';

test.describe('employee profile — country prefix #444', () => {
  test('mobile prefix renders +254 on Kenya tenant (not +91)', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/employee/user/profile`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Profile form mounts after the HRMS self-lookup; wait for the
    // mobile input to appear so we know the page settled.
    const mobileInput = page
      .locator('input[name="mobileNumber"], input[type="tel"], input[pattern*="0-9"]')
      .first();
    await mobileInput.waitFor({ state: 'visible', timeout: 20_000 });

    // The prefix block sits to the left of the mobile input. The
    // `.citizen-card-input--front` class is the DIGIT UI convention;
    // if that class gets renamed we'd rather fail loudly than silently
    // pick up the wrong element.
    const prefix = page.locator('.citizen-card-input--front').first();
    await expect(prefix).toBeVisible({ timeout: 10_000 });

    const prefixText = (await prefix.innerText()).trim();
    expect(prefixText).toBe('+254');
    expect(prefixText).not.toBe('+91');
  });
});
