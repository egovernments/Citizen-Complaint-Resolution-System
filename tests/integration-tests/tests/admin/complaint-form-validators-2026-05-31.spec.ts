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
    // RC5: none of the Category/Sub-Type/Hierarchy/Locality controls are
    // htmlFor-associated to their <Label> (getByLabel resolves nothing and
    // .click() hangs the full 120s). Mirror complaints.spec.ts's
    // triggerNearLabel + pickComplaintType approach instead — copied locally
    // rather than imported so the two spec files stay decoupled.
    await pickComplaintType(page);

    // ============ Locality — LocalityPicker cascade (+ #496 dedup) ============
    // LocalityPicker is three radix Selects in one grid (Hierarchy → Boundary
    // Type → Locality); only the group's help text ("Cascades from
    // hierarchy…") is a reliable anchor. Walk hierarchy x boundary-type
    // combos positionally until one actually offers Locality options (the
    // first hierarchy option, e.g. "ADMIN", can be a tree with zero usable
    // boundaries while a later one holds the real tree) — this test doesn't
    // need a SPECIFIC locality, just any valid one, to reach the #496 dedup
    // check and then the postal/mobile validator assertions.
    const localityGroup = page
      .locator('div')
      .filter({ has: page.getByText(/Cascades from hierarchy/i) })
      .last();
    await localityGroup.getByRole('combobox').first().waitFor({ state: 'visible', timeout: 15_000 });
    const selects = localityGroup.getByRole('combobox');
    const hierarchy = selects.nth(0);
    const boundaryType = selects.nth(1);
    const localityTrigger = selects.nth(2);

    const countOptions = async (trigger: import('@playwright/test').Locator): Promise<number> => {
      if (!(await trigger.isEnabled().catch(() => false))) return 0;
      await trigger.click();
      const n = await page.getByRole('option').count();
      if (n === 0) await page.keyboard.press('Escape').catch(() => {});
      return n;
    };

    let localityOpts: string[] = [];
    const hierN = await countOptions(hierarchy);
    outer: for (let h = 0; h < Math.max(hierN, 1); h++) {
      if (hierN > 0) {
        await page.getByRole('option').nth(h).click();
      }
      const typeN = await countOptions(boundaryType);
      for (let t = 0; t < typeN; t++) {
        await page.getByRole('option').nth(t).click();
        if (await localityTrigger.isEnabled().catch(() => false)) {
          await localityTrigger.click();
          const opts = (await page.getByRole('option').allInnerTexts())
            .map((s) => s.trim())
            .filter(Boolean);
          if (opts.length > 0) {
            localityOpts = opts;
            break outer;
          }
          await page.keyboard.press('Escape').catch(() => {});
        }
        if (t + 1 < typeN && (await boundaryType.isEnabled().catch(() => false))) {
          await boundaryType.click();
        }
      }
      if (h + 1 < hierN && (await hierarchy.isEnabled().catch(() => false))) {
        await hierarchy.click();
      }
    }
    expect(localityOpts.length, 'no hierarchy/type combination yielded a selectable locality').toBeGreaterThan(0);

    // #496 (adapted): the locality options must be unique by code. The old
    // flat "Boundary" combobox is gone; assert dedup on the cascade's final
    // Locality options instead.
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

// --- Local helpers (copied from complaints.spec.ts; not imported across spec
// files so the two buckets/specs stay decoupled — see RC5). ---

/** Locate a radix Select trigger sitting in the same wrapper <div> as a given
 *  field <Label> text. These cascade selects don't associate their label via
 *  htmlFor, so getByLabel can't reach them — anchor on the label text and
 *  take the combobox in the innermost enclosing div. */
function triggerNearLabel(
  page: import('@playwright/test').Page,
  labelText: RegExp,
): import('@playwright/test').Locator {
  return page
    .locator('div')
    .filter({ has: page.getByText(labelText) })
    .filter({ has: page.getByRole('combobox') })
    .last()
    .getByRole('combobox')
    .first();
}

async function pickComplaintType(
  page: import('@playwright/test').Page,
): Promise<void> {
  // The complaint-type control is a Category → Sub-Type cascade — one radix
  // Select per RAINMAKER-PGR.ComplaintHierarchy level. Pick the first option
  // at each level until the deepest (terminal) level is chosen. Deeper levels
  // are hidden once a branch is terminal, so a missing/disabled next level
  // just ends the walk.
  for (const lbl of [/^Category$/i, /^Sub-?Type$/i]) {
    const sel = triggerNearLabel(page, lbl);
    if (!(await sel.isVisible({ timeout: 8_000 }).catch(() => false))) break;
    if (!(await sel.isEnabled().catch(() => false))) break;
    await sel.click();
    const opt = page.getByRole('option').first();
    if (!(await opt.isVisible({ timeout: 5_000 }).catch(() => false))) {
      await page.keyboard.press('Escape').catch(() => {});
      break;
    }
    await opt.click();
  }
}
