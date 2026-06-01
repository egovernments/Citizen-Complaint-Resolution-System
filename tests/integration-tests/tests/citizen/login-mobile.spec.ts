/**
 * Citizen login mobile-number validation (CCRS #429).
 *
 * A citizen typing a 5-digit number used to see a toast-style generic
 * error with no indication of what a valid number looks like. Three
 * things had to change (PR #28, 3b7c917):
 *
 * 1. The citizen login now reads `ValidationConfigs.mobileNumberValidation`
 *    from MDMS rather than the hardcoded Indian 10-digit regex. On
 *    naipepea this resolves to the Kenya rule (`^0?[17][0-9]{8}$`) with
 *    its own `errorMessage`.
 * 2. A helper hint renders under the field even in the idle state, so the
 *    citizen knows what length to type before they type anything.
 * 3. The error renders inline under the input, not just as a toast.
 *
 * This smoke spec walks the citizen login surface with NO prior session,
 * types a deliberately-too-short number, and asserts the inline error
 * plus the persistent helper hint — without coupling to the exact
 * translation (which lives in MDMS and may move).
 */
import { test, expect } from '@playwright/test';

import { BASE_URL } from '../utils/env';

// Citizen login is public and must render fresh. Drop the admin
// storageState so we don't land on the authenticated citizen home.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('citizen login mobile validation — #429', () => {
  test('5-digit number shows inline error + helper hint', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen/login`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const mobileInput = page.locator('input[name="mobileNumber"]');
    await mobileInput.waitFor({ state: 'visible', timeout: 20_000 });

    // Helper hint must be visible BEFORE the user touches the field —
    // that's the whole point of the fix. Accept both the raw template
    // ("N-digit") and the interpolated form ("10-digit") because MDMS
    // may or may not have the substitution wired yet.
    const helper = page.getByText(/10-digit|N-digit mobile number/i).first();
    await expect(helper).toBeVisible({ timeout: 10_000 });

    // Type a number that's too short to satisfy either the Kenya or
    // legacy Indian rule, then proceed so the validator fires.
    await mobileInput.click();
    await mobileInput.type('12345', { delay: 30 });
    await page.locator('button:visible')
      .filter({ hasText: /NEXT|Next|CS_COMMONS_NEXT/ })
      .first()
      .click();

    // The inline error lives in the MDMS `errorMessage` field — we
    // don't hardcode the exact copy, only that it asserts "valid" and
    // carries no India-specific vocabulary (the regression we're
    // guarding against).
    const errorCandidate = page
      .locator('body')
      .getByText(/valid/i)
      .first();
    await expect(errorCandidate).toBeVisible({ timeout: 10_000 });

    const errorText = (await errorCandidate.innerText()).toLowerCase();
    expect(errorText).not.toContain('india');
    expect(errorText).not.toContain('indian');
    expect(errorText).not.toContain('+91');
  });
});
