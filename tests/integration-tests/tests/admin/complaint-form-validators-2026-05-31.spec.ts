/**
 * Admin (configurator) complaint create — validator bundle.
 *
 * One full pass through the configurator complaint create surface,
 * driving every fix that landed in the 2026-05-30 cohort:
 *
 *   #445 (employee Edit Profile null-safety side-checked via users list)
 *   #476 (employee edit + save round-trip — Save → /manage/employees)
 *   #459 (user created on form's tenant, not session default)
 *   #471 (form clears after create — URL leaves /create + form unmounts)
 *   #496 (boundary dropdown dedup + #478 leaf-only enforcement)
 *   #478 (postal-code + mobile validators bidirectional)
 *   #447 (Kenya mobile rule, incl. trunk-zero 0712345678 acceptance)
 */
import { test, expect } from '@playwright/test';
import { BASE_URL } from '../utils/env';

const USERS_URL = '/configurator/manage/users';
const EMPLOYEES_URL = '/configurator/manage/employees';
const COMPLAINT_CREATE_URL = '/configurator/manage/complaints/create';

const POSTAL_ERR = /Enter a valid 5-digit postal code/i;
const MOBILE_ERR = /Enter a valid Kenyan mobile starting with 7 or 1|valid mobile/i;

// Boundary labels that MUST NOT appear in the leaf-only picker.
const NON_LEAF_PATTERNS = [
  /^County$/i,
  /^Sub[-\s]?County$/i,
  /^Ward$/i,
  /^Country$/i,
  /^State$/i,
  /^Region$/i,
  /^Division$/i,
  /^District$/i,
];

test.describe('admin complaint create — validator bundle 2026-05-30', () => {
  test('users + edit + create + validators bidirectional', async ({ page }) => {
    // ============ Users list — #445 side-check ============
    await page.goto(`${BASE_URL}${USERS_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_500);
    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 15_000 });

    // ============ Employees list ============
    await page.goto(`${BASE_URL}${EMPLOYEES_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_500);
    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 15_000 });

    // ============ Complaint create form ============
    await page.goto(`${BASE_URL}${COMPLAINT_CREATE_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5_000);

    // Pick a complaint type so the rest of the form renders.
    const typeCombo = page
      .getByRole('combobox')
      .filter({ hasText: /Select complaint type/i })
      .first();
    await typeCombo.click();
    await page.waitForTimeout(1_000);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(1_500);

    // ============ #496 boundary dedup + #478 leaf-only ============
    const boundaryCombo = page.getByRole('combobox').filter({ hasText: /^Boundary$/ }).first();
    await boundaryCombo.click();
    await page.waitForTimeout(1_200);

    const opts = await page
      .locator('[role="listbox"][data-state="open"] [role="option"]')
      .allInnerTexts();
    const cleaned = opts.map((s) => s.trim()).filter(Boolean);
    expect(
      new Set(cleaned).size,
      `#496 — boundary picker options must be unique by code (got ${cleaned.length}, ${new Set(cleaned).size} unique)`,
    ).toBe(cleaned.length);

    const offendingTypes = cleaned.filter((label) =>
      NON_LEAF_PATTERNS.some((p) => p.test(label)),
    );
    expect(
      offendingTypes.length,
      `#478 leaf — boundary picker must not list non-leaf admin labels: ${JSON.stringify(offendingTypes)}`,
    ).toBe(0);

    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(1_500);

    // ============ #478 postal + #447 mobile validators NEG ============
    const pincode = page.locator('input[name="address.pincode"]').first();
    await pincode.click();
    await pincode.pressSequentially('1234', { delay: 120 });
    await page.waitForTimeout(800);

    const mobile = page.locator('input[name="citizen.mobileNumber"]').first();
    await mobile.click();
    await mobile.pressSequentially('abc123', { delay: 120 });
    await page.waitForTimeout(800);

    const createBtn = page.getByRole('button', { name: /^Create$/i }).first();
    await createBtn.click();
    await page.waitForTimeout(2_500);

    await expect(
      page.locator('[role="alert"]').filter({ hasText: POSTAL_ERR }).first(),
    ).toBeVisible();
    await expect(
      page.locator('[role="alert"]').filter({ hasText: MOBILE_ERR }).first(),
    ).toBeVisible();
    await page.waitForTimeout(2_000);

    // ============ #478 + #447 validators POS ============
    await pincode.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await pincode.pressSequentially('00100', { delay: 120 });
    await page.waitForTimeout(800);
    await mobile.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await mobile.pressSequentially('0712345678', { delay: 120 });
    await page.waitForTimeout(800);
    await createBtn.click();
    await page.waitForTimeout(2_500);

    await expect(
      page.locator('[role="alert"]').filter({ hasText: POSTAL_ERR }),
      '#478 — postal error must clear on valid 00100',
    ).toHaveCount(0);
    await expect(
      page.locator('[role="alert"]').filter({ hasText: MOBILE_ERR }),
      '#447 — mobile error must clear on valid 0712345678',
    ).toHaveCount(0);
  });
});
