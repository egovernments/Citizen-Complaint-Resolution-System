/**
 * Employee profile — null-safe validationConfig regex access (CCRS #445).
 *
 * The pre-fix bug: digit-ui's `UserProfile.js` crashed on mount + on
 * onChange when MDMS `UserProfileValidationConfig` omitted a field and
 * its regex was undefined ("Cannot read properties of undefined
 * (reading 'test')"). PR commit 9750beb1 optional-chains the six
 * `.test()` call sites.
 *
 * Drives the post-auth mount AND a keystroke on a validator-gated
 * field — the onChange path is where the original crash actually
 * fired. The route is wrapped in PrivateRoute, so unauth visits 302
 * to /login without mounting UserProfile.js — auth is required for an
 * honest drive.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, EMPLOYEE_USER, EMPLOYEE_PASS, TENANT_LABEL } from '../utils/env';

const LOGIN_URL = '/digit-ui/employee/user/login';
const PROFILE_URL = '/digit-ui/employee/user/profile';
const CRASH_PATTERNS = [
  /Cannot read properties of (undefined|null) \(reading ['"]test['"]\)/i,
  /validationConfig.*(undefined|null)/i,
  /TypeError.*test/i,
];

test.describe('employee profile — validationConfig null-safety #445', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('post-auth UserProfile mount + onChange do not throw', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(`${err.name}: ${err.message}`);
    });

    // ============ UI login ============
    await page.goto(`${BASE_URL}${LOGIN_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_500);

    await page.locator('input[type="text"]').first().pressSequentially(EMPLOYEE_USER, { delay: 60 });
    await page.locator('input[type="password"]').first().pressSequentially(EMPLOYEE_PASS, { delay: 60 });
    const cityCombo = page.getByRole('combobox', { name: /City/i });
    if (!(await cityCombo.textContent())?.includes(TENANT_LABEL)) {
      await cityCombo.click();
      await page.waitForTimeout(700);
      await page.getByRole('option', { name: new RegExp(TENANT_LABEL, 'i') }).first().click();
      await page.waitForTimeout(700);
    }
    await page.getByText(/I agree to the DIGIT/i).click();
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: /^Login$/i }).click();
    await page.waitForURL(/\/digit-ui\/employee(?!\/user\/login)/, { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // Drop pre-profile errors so the spec only fails on errors that
    // happen during the post-auth profile mount.
    pageErrors.length = 0;

    // ============ Navigate to Edit Profile ============
    await page.goto(`${BASE_URL}${PROFILE_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_500);

    const bodyText = (await page.textContent('body')) ?? '';
    for (const pattern of CRASH_PATTERNS) {
      expect(bodyText, `crash text matched ${pattern} — #445 regression?`).not.toMatch(pattern);
    }

    const mountRelevant = pageErrors.filter((m) => CRASH_PATTERNS.some((p) => p.test(m)));
    expect(
      mountRelevant,
      `uncaught pageerror on mount:\n${mountRelevant.join('\n')}`,
    ).toEqual([]);

    // ============ Keystroke on a validator-gated field ============
    const editableField = page
      .locator('input[name*="mobile" i], input[name*="email" i], input[type="tel"]')
      .first();
    if (await editableField.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await editableField.click();
      await page.keyboard.type('7', { delay: 80 });
      await page.waitForTimeout(800);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);

      const onChangeRelevant = pageErrors.filter((m) => CRASH_PATTERNS.some((p) => p.test(m)));
      expect(
        onChangeRelevant,
        `keystroke fired a validationConfig crash:\n${onChangeRelevant.join('\n')}`,
      ).toEqual([]);
    }
  });
});
