/**
 * Admin — employee create form mobile validator (CCRS #447 + #459 + #471 cross-cut).
 *
 * Three Kenya-mobile cases via the configurator Employee create form:
 *   - bare 9-digit `712345678` → valid (clears aria-invalid)
 *   - 10-digit wrong-prefix `9876543210` → invalid (help text + aria-invalid)
 *   - trunk-zero `0712345678` → valid (KE-everyday form, PR #674 fallback fix)
 */
import { test, expect } from '@playwright/test';
import { BASE_URL } from '../utils/env';

const CREATE_URL = '/configurator/manage/employees/create';
const MOBILE_INPUT = 'input[name="user.mobileNumber"]';
const HELP_TEXT = /Enter a valid Kenyan mobile|optional leading 0/i;

test.describe('admin employee create — mobile validator KE rule #447 #674', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}${CREATE_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector(MOBILE_INPUT, { timeout: 20_000 });
  });

  test('valid bare-9 mobile clears aria-invalid', async ({ page }) => {
    await page.waitForTimeout(2_000);
    const mobile = page.locator(MOBILE_INPUT);
    await mobile.focus();
    await page.waitForTimeout(800);
    await mobile.pressSequentially('712345678', { delay: 180 });
    await page.waitForTimeout(1_500);
    await mobile.blur();
    await page.waitForTimeout(2_000);
    expect(['false', null]).toContain(await mobile.getAttribute('aria-invalid'));
    await expect(
      page.locator('[role="alert"]').filter({ hasText: HELP_TEXT }),
    ).toHaveCount(0);
  });

  test('invalid mobile surfaces Kenya help text and aria-invalid', async ({ page }) => {
    await page.waitForTimeout(2_000);
    const mobile = page.locator(MOBILE_INPUT);
    await mobile.focus();
    await page.waitForTimeout(800);
    await mobile.pressSequentially('9876543210', { delay: 180 });
    await page.waitForTimeout(1_500);
    await mobile.blur();
    await page.waitForTimeout(2_000);
    const submit = page.getByRole('button', { name: /^(Create|Save)$/ }).first();
    if (await submit.isVisible().catch(() => false)) await submit.click({ trial: false }).catch(() => {});
    await expect(page.getByText(HELP_TEXT).first()).toBeVisible();
    expect(await mobile.getAttribute('aria-invalid')).toBe('true');
  });

  test('valid trunk-zero KE mobile (0712345678) clears aria-invalid — #674', async ({ page }) => {
    // Catches a regression of PR #674 trunk-zero fallback. Without this
    // case the suite stays green if the validator stops stripping the
    // leading 0 before checking the [17]\d{8} pattern.
    await page.waitForTimeout(2_000);
    const mobile = page.locator(MOBILE_INPUT);
    await mobile.focus();
    await page.waitForTimeout(800);
    await mobile.pressSequentially('0712345678', { delay: 180 });
    await page.waitForTimeout(1_500);
    await mobile.blur();
    await page.waitForTimeout(2_000);
    expect(['false', null]).toContain(await mobile.getAttribute('aria-invalid'));
    await expect(
      page.locator('[role="alert"]').filter({ hasText: HELP_TEXT }),
    ).toHaveCount(0);
  });
});
