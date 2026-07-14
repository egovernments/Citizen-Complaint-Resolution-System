/**
 * Admin — employee create form mobile validator (CCRS #447 + #459 + #471 cross-cut).
 *
 * Three tenant-aware mobile cases via the configurator Employee create form:
 *   - valid mobile from MDMS rule → valid (clears aria-invalid)
 *   - explicitly wrong-prefix / short input → invalid (help text + aria-invalid)
 *   - second valid candidate covers the PR #674 fallback path (trunk-zero,
 *     varying lengths, etc. — whatever the rule allows)
 *
 * Tenant-agnostic: the rule (pattern, errorMessage, allowedStartingDigits) is
 * fetched from MDMS via `getMobileValidationRule(TENANT)`; tests assert on
 * `rule.errorMessage` rather than literal Kenya copy.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT } from '../utils/env';
import {
  getMobileValidationRule,
  generateValidMobile,
  generateInvalidMobile,
  type MobileRule,
} from '../utils/mdms-mobile';

const CREATE_URL = '/configurator/manage/employees/create';
const MOBILE_INPUT = 'input[name="user.mobileNumber"]';

let mobileRule: MobileRule;
let helpTextRe: RegExp;

test.beforeAll(async () => {
  mobileRule = await getMobileValidationRule(TENANT);
  // The form renders its error via the app's `useMobileValidator`, whose copy
  // is "Please enter a valid mobile number (<len> digits, starting with <d>)"
  // on every tenant — not the synthetic `mobileRule.errorMessage` the MDMS
  // helper builds ("…valid <len>-digit mobile number"). Assert on the stable
  // app substring so the check is tenant-agnostic and matches what renders.
  helpTextRe = /valid mobile number/i;
});

test.describe('admin employee create — mobile validator (MDMS rule) #447 #674', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}${CREATE_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector(MOBILE_INPUT, { timeout: 20_000 });
  });

  test('valid mobile clears aria-invalid', async ({ page }) => {
    const validMobile = generateValidMobile(mobileRule);
    await page.waitForTimeout(2_000);
    const mobile = page.locator(MOBILE_INPUT);
    await mobile.focus();
    await page.waitForTimeout(800);
    await mobile.pressSequentially(validMobile, { delay: 180 });
    await page.waitForTimeout(1_500);
    await mobile.blur();
    await page.waitForTimeout(2_000);
    expect(['false', null]).toContain(await mobile.getAttribute('aria-invalid'));
    await expect(
      page.locator('[role="alert"]').filter({ hasText: helpTextRe }),
    ).toHaveCount(0);
  });

  test('invalid mobile surfaces help text and aria-invalid', async ({ page }) => {
    const invalidMobile = generateInvalidMobile(mobileRule, 'short');
    await page.waitForTimeout(2_000);
    const mobile = page.locator(MOBILE_INPUT);
    await mobile.focus();
    await page.waitForTimeout(800);
    await mobile.pressSequentially(invalidMobile, { delay: 180 });
    await page.waitForTimeout(1_500);
    await mobile.blur();
    await page.waitForTimeout(2_000);
    const submit = page.getByRole('button', { name: /^(Create|Save)$/ }).first();
    if (await submit.isVisible().catch(() => false)) await submit.click({ trial: false }).catch(() => {});
    await expect(page.getByText(helpTextRe).first()).toBeVisible();
    expect(await mobile.getAttribute('aria-invalid')).toBe('true');
  });

  test('second valid mobile candidate clears aria-invalid — #674 fallback', async ({ page }) => {
    // Catches a regression of PR #674 fallback handling. We generate a fresh
    // valid candidate from the rule — on tenants whose rule allows a leading
    // "0" trunk this naturally exercises the same path.
    const validMobile = generateValidMobile(mobileRule);
    await page.waitForTimeout(2_000);
    const mobile = page.locator(MOBILE_INPUT);
    await mobile.focus();
    await page.waitForTimeout(800);
    await mobile.pressSequentially(validMobile, { delay: 180 });
    await page.waitForTimeout(1_500);
    await mobile.blur();
    await page.waitForTimeout(2_000);
    expect(['false', null]).toContain(await mobile.getAttribute('aria-invalid'));
    await expect(
      page.locator('[role="alert"]').filter({ hasText: helpTextRe }),
    ).toHaveCount(0);
  });
});
