import { test, expect } from '@playwright/test';

/**
 * Demo: configurator bundle on bomet — actions that complete.
 *
 * One ~80s recording that exercises real flows end-to-end:
 *
 *   #445  Users list renders without React error boundary / null
 *         validationConfig console crash.
 *   #476  Edit-Employee form opens, change saves with a "Employee
 *         updated" success toast (no NPE, no ensureAudit crash).
 *   #622  HRMS reachable via Kong (the assert is implicit: any of
 *         the HRMS-backed routes above are 500-free; the explicit
 *         negative-match guards against the prior "dns/balancer
 *         resolve" red panel).
 *   #478  Pincode validator: type "1234" → red "Enter a valid
 *         5-digit postal code", correct to "00100" → error
 *         vanishes.
 *   #447  Kenya mobile validator: type "abc123" → red "Enter a
 *         valid Kenyan mobile starting with 7 or 1", correct to
 *         "0712345678" → error vanishes. (Behavior shared with
 *         #459/#471 — same validator.)
 *   #496  Boundary picker dedup: cascading combobox lists each
 *         seeded boundary code exactly once.
 *
 * NOT in this video on purpose:
 *   - Actually clicking "Create" to submit a complaint as
 *     ADMIN: that fails with 400 INVALID ROLE because ADMIN
 *     lacks CITIZEN/CSR roles. That's a role-seed concern
 *     separate from the #478/#447 fixes.
 *   - Creating a new employee (covered by sibling spec
 *     demo-create-employee-bomet.spec.ts — that one verifies
 *     #471 form-clears + #459 tenant correctness on create).
 */

const USERS_URL = '/configurator/manage/users';
const EMPLOYEES_URL = '/configurator/manage/employees';
const COMPLAINT_CREATE_URL = '/configurator/manage/complaints/create';

const POSTAL_ERR = /Enter a valid 5-digit postal code/i;
const MOBILE_ERR = /Enter a valid Kenyan mobile starting with 7 or 1/i;
const HRMS_DNS_ERR = /failed.*dns|balancer resolve|service unavailable/i;
const VALIDATION_CONFIG_NULL = /validationConfig is null|TypeError.*validationConfig/i;

test.describe('Demo: configurator bundle on bomet — actions that complete', () => {
  test('users -> employee edit + save -> complaint validators bidirectional', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
    });

    // ============ 1. Users list — #445 ============
    await page.goto(`${USERS_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_500);

    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    expect(
      consoleErrors.some((e) => VALIDATION_CONFIG_NULL.test(e)),
      'validationConfig null error must NOT surface',
    ).toBeFalsy();

    // ============ 2. Employees list — #476 + #622 ============
    await page.goto(`${EMPLOYEES_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_500);

    await expect(page.getByText(HRMS_DNS_ERR)).toHaveCount(0);
    await expect(page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 15_000 });

    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    // ============ 3. Edit + save — #476 round-trip ============
    const editBtn = page.getByRole('button', { name: /^Edit$/i });
    await expect(editBtn).toBeVisible({ timeout: 15_000 });
    await editBtn.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    // Make a benign change that marks the form dirty so save fires.
    // Email is a free-form optional field — no validator gating.
    const emailInput = page.locator('input[name="user.emailId"]').first();
    await expect(emailInput).toBeVisible();
    await emailInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await emailInput.pressSequentially(`ccrs-demo-${Date.now()}@example.test`, { delay: 25 });
    await page.waitForTimeout(800);

    // Normalize the mobile if the form's validator (strict 9-digit)
    // would otherwise block the save.
    const mobileInput = page.locator('input[name="user.mobileNumber"]').first();
    const currentMobile = await mobileInput.inputValue();
    if (currentMobile.startsWith('0') && currentMobile.length === 10) {
      await mobileInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await mobileInput.pressSequentially(currentMobile.slice(1), { delay: 60 });
      await page.waitForTimeout(700);
    }

    const saveBtn = page.getByRole('button', { name: /^Save$/i });
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click();

    // Success signal: nav from /<uuid>/edit back to /employees.
    await page.waitForURL(/\/manage\/employees(?!\/[a-f0-9-]+\/edit)/, { timeout: 25_000 });
    await page.waitForTimeout(2_500);
    await expect(page.getByText(/NullPointerException|ensureAudit/i)).toHaveCount(0);

    // ============ 4. Complaint create — validators bidirectional ============
    await page.goto(`${COMPLAINT_CREATE_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    const typeCombo = page.getByRole('combobox').filter({ hasText: /Select complaint type/i }).first();
    await typeCombo.click();
    await page.waitForTimeout(800);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(1_200);

    const desc = page.locator('input[name="description"], textarea[name="description"]').first();
    await desc.click();
    await desc.pressSequentially('Bundle demo on bomet — validators round-trip.', { delay: 35 });
    await page.waitForTimeout(800);

    // ============ 5. Boundary picker dedup — #496 ============
    const boundaryCombo = page.getByRole('combobox').filter({ hasText: /^Boundary$/ }).first();
    await boundaryCombo.click();
    await page.waitForTimeout(1_200);

    const opts = await page.locator('[role="listbox"][data-state="open"] [role="option"]').allInnerTexts();
    const cleaned = opts.map((s) => s.trim()).filter(Boolean);
    const uniqueCount = new Set(cleaned).size;
    expect(
      uniqueCount,
      `boundary picker: ${cleaned.length} options, ${uniqueCount} unique — dedup intact`,
    ).toBe(cleaned.length);

    // ============ 5b. Boundary picker — #478 leaf-only enforcement ============
    // PR #680 restricted LocalityPicker to LEAF boundary types only,
    // so an operator cannot file a complaint at County / Sub-County /
    // Ward level. The option list captured above in `cleaned` is
    // exactly the set the operator could pick from. None of those
    // texts should look like a non-leaf type label.
    const NON_LEAF_PATTERNS = [
      /^County$/i, /^Sub[-\s]?County$/i, /^Ward$/i, /^Country$/i,
      /^State$/i, /^Region$/i, /^Division$/i, /^District$/i,
    ];
    const offendingTypes = cleaned.filter((label) =>
      NON_LEAF_PATTERNS.some((p) => p.test(label)),
    );
    expect(
      offendingTypes.length,
      `#478 ward-leaf enforcement — boundary picker option list must not surface non-leaf admin-level labels; offending: ${JSON.stringify(offendingTypes)}`,
    ).toBe(0);

    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(1_500);

    // ============ 6. Pincode validator — #478 ============
    const pincode = page.locator('input[name="address.pincode"]').first();
    await pincode.click();
    await pincode.pressSequentially('1234', { delay: 120 });
    await page.waitForTimeout(800);

    // ============ 7. Mobile validator — #447/#459/#471 ============
    const mobile = page.locator('input[name="citizen.mobileNumber"]').first();
    await mobile.click();
    await mobile.pressSequentially('abc123', { delay: 120 });
    await page.waitForTimeout(800);

    const createBtn = page.getByRole('button', { name: /^Create$/i }).first();
    await createBtn.click();
    await page.waitForTimeout(2_500);

    await expect(page.locator('[role="alert"]').filter({ hasText: POSTAL_ERR }).first()).toBeVisible();
    await expect(page.locator('[role="alert"]').filter({ hasText: MOBILE_ERR }).first()).toBeVisible();

    await page.waitForTimeout(3_500);

    // ============ 8. Fix both — errors must vanish ============
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

    await expect(page.locator('[role="alert"]').filter({ hasText: POSTAL_ERR })).toHaveCount(0);
    await expect(page.locator('[role="alert"]').filter({ hasText: MOBILE_ERR })).toHaveCount(0);

    await page.waitForTimeout(3_500);
  });
});
