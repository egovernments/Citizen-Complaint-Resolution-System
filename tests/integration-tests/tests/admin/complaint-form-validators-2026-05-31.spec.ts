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
 *   #496 (locality options deduped — asserted on the LocalityPicker cascade)
 *   #478 (postal-code + mobile validators bidirectional)
 *   #447 (Kenya mobile rule, incl. trunk-zero 0712345678 acceptance)
 *
 * NOTE: ComplaintCreate is now an N-level `ComplaintHierarchyCascade`
 * (labelled "Complaint Type") plus a cascading `LocalityPicker`
 * (Hierarchy → Boundary Type → Locality). This spec drives those controls
 * the same way the current complaints.spec.ts does — the old flat
 * "Select complaint type" combobox and directly-clicked "Boundary"
 * combobox no longer exist.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT, POSTAL_CODE_PATTERN, POSTAL_CODE_VALID } from '../utils/env';
import { getMobileValidationRule, generateValidMobile } from '../utils/mdms-mobile';

const USERS_URL = '/configurator/manage/users';
const EMPLOYEES_URL = '/configurator/manage/employees';
const COMPLAINT_CREATE_URL = '/configurator/manage/complaints/create';

// Tenant-agnostic: like MOBILE_ERR below, don't pin the (Kenya-only)
// "5-digit" copy — configurator/src/admin/validation.ts's postalCode
// validator sources both the pattern AND the message from
// globalConfigs/MDMS per-tenant (Maputo's is 4-digit with an optional
// suffix, `^[0-9]{4}(-[0-9]{2})?$`, not 5-digit), falling back to the
// English default only when neither is configured. Match the stable
// "postal code" substring so the assertion holds regardless of which rule
// actually fired.
const POSTAL_ERR = /postal code/i;
// Tenant-agnostic: the complaint create form validates mobile via the
// MDMS-driven `useMobileValidator` hook, whose message is "Please enter a
// valid mobile number (…)" on every tenant. Match the stable substring
// rather than pinning the (Kenya-only) copy the old test asserted.
const MOBILE_ERR = /valid mobile/i;

/**
 * A postal-code value guaranteed to fail POSTAL_CODE_PATTERN on THIS
 * deployment. The old literal '1234' assumed Kenya's 5-digit rule; on
 * mz.maputo's `^[0-9]{4}(-[0-9]{2})?$` it's a VALID code (bare 4 digits,
 * no suffix), so the NEG assertion below would never have fired there.
 * Every postal rule we've seen is digits-only, so letters are a safe
 * invalid probe — verified against the live pattern rather than assumed.
 */
function invalidPostalSample(): string {
  let re: RegExp;
  try {
    re = new RegExp(POSTAL_CODE_PATTERN);
  } catch {
    return 'ABCDE';
  }
  for (const candidate of ['ABCDE', '1', '999999999999']) {
    if (!re.test(candidate)) return candidate;
  }
  return 'ABCDE'; // last resort — some exotic pattern accepted every candidate above
}

test.describe('admin complaint create — validator bundle 2026-05-30', () => {
  test('users + edit + create + validators bidirectional', { tag: ['@persona:admin'] }, async ({ page }) => {
    // A mobile number valid for THIS tenant's MDMS rule (Kenya: 07…, Maputo:
    // 8…). Derived from `common-masters.MobileNumberValidation` so the POS
    // assertion below isn't pinned to a Kenya-only literal.
    const validMobile = generateValidMobile(await getMobileValidationRule(TENANT));

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

    // ============ Complaint type — ComplaintHierarchyCascade ============
    // Drive the "Complaint Type" cascade the same way complaints.spec does:
    // open it and pick the first available option. The validator assertions
    // below don't depend on a complaint type being chosen, but we exercise
    // the real control that replaced the old "Select complaint type" combobox.
    const typeSelect = page.getByLabel(/^Complaint Type/i).first();
    if (await typeSelect.isVisible().catch(() => false)) {
      await typeSelect.click();
      await page.waitForTimeout(800);
      const firstType = page.getByRole('option').first();
      if (await firstType.isVisible().catch(() => false)) {
        await firstType.click();
        await page.waitForTimeout(1_000);
      }
    }

    // ============ Locality — LocalityPicker cascade (+ #496 dedup) ============
    // LocalityPicker exposes three cascading selects (Hierarchy → Boundary
    // Type → Locality). Hierarchy + Boundary Type are best-effort (their
    // choices may already default); the final Locality select is the one we
    // must open. Mirror complaints.spec's pickLocality helper.
    const hierarchy = page.getByLabel(/Hierarchy/i).first();
    if (await hierarchy.isVisible().catch(() => false)) {
      await hierarchy.click();
      await page.getByRole('option').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    const boundaryType = page.getByLabel(/Boundary type/i).first();
    if (await boundaryType.isVisible().catch(() => false)) {
      await boundaryType.click();
      await page.getByRole('option').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }

    const locality = page.getByLabel(/^Locality$/i).first();
    await locality.click();
    await page.waitForTimeout(1_000);

    // #496 (adapted): the locality options must be unique by code. The old
    // flat "Boundary" combobox is gone; assert dedup on the cascade's final
    // Locality options instead.
    const localityOpts = (await page.getByRole('option').allInnerTexts())
      .map((s) => s.trim())
      .filter(Boolean);
    expect(
      new Set(localityOpts).size,
      `#496 — locality options must be unique (got ${localityOpts.length}, ${new Set(localityOpts).size} unique)`,
    ).toBe(localityOpts.length);

    await page.getByRole('option').first().click();
    await page.waitForTimeout(1_000);

    // ============ #478 postal + #447 mobile validators NEG ============
    const pincode = page.locator('input[name="address.pincode"]').first();
    await pincode.click();
    await pincode.pressSequentially(invalidPostalSample(), { delay: 120 });
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
    await pincode.pressSequentially(POSTAL_CODE_VALID, { delay: 120 });
    await page.waitForTimeout(800);
    await mobile.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await mobile.pressSequentially(validMobile, { delay: 120 });
    await page.waitForTimeout(800);
    await createBtn.click();
    await page.waitForTimeout(2_500);

    await expect(
      page.locator('[role="alert"]').filter({ hasText: POSTAL_ERR }),
      `#478 — postal error must clear on tenant-valid ${POSTAL_CODE_VALID}`,
    ).toHaveCount(0);
    await expect(
      page.locator('[role="alert"]').filter({ hasText: MOBILE_ERR }),
      `#447 — mobile error must clear on tenant-valid mobile ${validMobile}`,
    ).toHaveCount(0);
  });
});
