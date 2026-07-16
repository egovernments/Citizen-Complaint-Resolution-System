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
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { loginViaApi } from '../utils/auth';

const PROFILE_URL = '/digit-ui/employee/user/profile';
const CRASH_PATTERNS = [
  /Cannot read properties of (undefined|null) \(reading ['"]test['"]\)/i,
  /validationConfig.*(undefined|null)/i,
  /TypeError.*test/i,
];

test.describe('employee profile — validationConfig null-safety #445', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('post-auth UserProfile mount + onChange do not throw', { tag: ['@persona:employee'] }, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(`${err.name}: ${err.message}`);
    });

    // ============ Auth ============
    // The profile route is behind PrivateRoute in the digit-ui EMPLOYEE
    // shell (reads its own `Employee.token`); a bare navigation lands on
    // the login gate and UserProfile.js never mounts. Inject an employee
    // session via the tenant-agnostic loginViaApi helper (ADMIN — always
    // present at the root tenant post-bootstrap). We deliberately do NOT
    // walk the login form here: this spec exercises UserProfile null-safety
    // (#445), not the login surface, and the form's City picker renders the
    // tenant's short name ("Maputo") rather than the configured display
    // label on deployments whose tenant-name localization is unseeded,
    // which made the form-driven variant hang.
    await loginViaApi(page, {
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

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
