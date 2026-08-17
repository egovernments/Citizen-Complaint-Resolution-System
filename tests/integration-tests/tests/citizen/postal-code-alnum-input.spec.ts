/**
 * Citizen v2 wizard — postal-code input accepts alnum/dash characters.
 *
 * Regression guard for a review comment on PR #1315 (CCRS#722 postal-code
 * consolidation): CreatePGRFlowV2.tsx's Step2Location postal-code `Input`
 * used to hard-strip every non-digit keystroke (`replace(/\D/g, "")`) and
 * cap the value at `maxLength={7}`, while the field's validation was wired
 * to the shared `isPostalCodeValid()`/`getPostalCodeErrorMessage()`
 * helpers (utils/postalCode.js) — which validate the FULL configured
 * `CORE_POSTAL_CONFIGS.postalCodePattern`, including alnum shapes like the
 * UK example documented in local-setup/ansible/inventory/host_vars/_example.yml
 * (`^[A-Z]{1,2}[0-9R][0-9A-Z]? ?[0-9][A-Z-[CIKMOV]]{2}$`, e.g. "SW1A 1AA")
 * and dash-suffixed shapes like the US example
 * (`^[0-9]{5}(-[0-9]{4})?$`, e.g. "12345-6789").
 *
 * Before the fix: every letter/dash typed into the field was silently
 * dropped and the value truncated at 7 characters, so an alnum or
 * dash-suffixed postal code could never be entered — the field was
 * permanently unfillable on such a tenant, regardless of what the
 * validator itself accepted.
 *
 * This spec is deployment-pattern-agnostic: it asserts the DOM input
 * preserves whatever the citizen typed (letters, digits, space, dash)
 * verbatim, which the fix guarantees unconditionally — independent of
 * which `postalCodePattern` the current tenant happens to have configured.
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';

test.describe('Citizen v2 postal-code input — alnum/dash regression (PR #1315)', () => {
  test.slow();

  /**
   * Navigate from the wizard's landing step through Step 1 (Complaint
   * Details) and Step 2 (Pin Location) to Step 3 (Location Details), where
   * the postal-code input lives. Mirrors the same generic, hierarchy-depth-
   * agnostic walk used by file-complaint-wizard.spec.ts and
   * wizard-pin-and-boundary-cascade.spec.ts.
   */
  async function reachLocationDetailsStep(page: Page): Promise<void> {
    const clickNext = async () => {
      const btn = page.locator('button:visible').filter({ hasText: /^NEXT$/ }).first();
      await btn.waitFor({ state: 'visible', timeout: 10_000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(2500);
    };

    const dropdowns = page.locator(
      'button[role="combobox"], input.digit-dropdown-employee-select-wrap--elipses',
    );

    // ── Step 1: Complaint Details — walk every hierarchy level ──────
    await dropdowns.first().waitFor({ state: 'visible', timeout: 15_000 });
    for (let level = 0; level < 8; level++) {
      const combobox = dropdowns.nth(level);
      const visible = await combobox
        .isVisible({ timeout: level === 0 ? 5000 : 3000 })
        .catch(() => false);
      if (!visible) break;
      await expect(combobox).toBeEnabled({ timeout: 8000 }).catch(() => {});
      if (!(await combobox.isEnabled().catch(() => false))) break;
      const hasPlaceholder = await combobox
        .evaluate((el) => /^Select/i.test((el as HTMLElement).innerText.trim()))
        .catch(() => true);
      if (!hasPlaceholder) continue;
      await combobox.click();
      await page.waitForTimeout(800);
      const option = page
        .locator('[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible')
        .first();
      if (!(await option.isVisible({ timeout: 5000 }).catch(() => false))) break;
      await option.click();
      await page.waitForTimeout(1500);
    }
    await clickNext();

    // ── Step 2: optional Pin Location — continue without a pin ──────
    await page.waitForTimeout(2500);
    await clickNext();
  }

  test('postal-code field retains alnum + dash characters instead of stripping them', {
    annotation: {
      type: 'description',
      description: `Confirms the Step2Location postal-code Input no longer digit-filters keystrokes or caps length at 7 — the fix that landed on PR #1315 after a review comment flagged the field as permanently unfillable on alnum/dash-postal-code tenants.

Steps:
1. OTP-login as the provisioned citizen.
2. Navigate to /digit-ui/citizen/pgr/create-complaint/complaint-type and walk Steps 1-2 (complaint type, then continue without the optional pin).
3. On Step 3 (Location Details), locate #postal-code and type an alnum probe with a space ("SW1A 1AA", the UK example from _example.yml).
4. Assert the input's value is exactly "SW1A 1AA" — not stripped to only its digits ("11").
5. Clear and type a dash-suffixed 10-char probe ("12345-6789", the US example from _example.yml).
6. Assert the input's value is exactly "12345-6789" — not truncated at 7 chars nor stripped of the dash.

Catches a regression where the field silently mangles input before the shared isPostalCodeValid()/getPostalCodeErrorMessage() validators ever see it.`,
    },
    tag: ['@area:pgr', '@ccrs:722', '@kind:regression', '@layer:ui', '@persona:citizen', '@pr:1315'] }, async ({ page }) => {
    test.setTimeout(120_000);

    await citizenOtpLogin(page);

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    await reachLocationDetailsStep(page);

    const postalInput = page.locator('#postal-code');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // UK-style probe: letters + digits + a space. Pre-fix, every non-digit
    // keystroke was stripped (replace(/\D/g, "")), so this would have
    // collapsed to "11".
    const ukProbe = 'SW1A 1AA';
    await postalInput.click();
    await postalInput.fill('');
    await postalInput.pressSequentially(ukProbe, { delay: 50 });
    await expect(postalInput).toHaveValue(ukProbe);

    // US-style probe: 10 characters including a dash. Pre-fix, maxLength={7}
    // would have truncated this and the dash would have been stripped.
    const usProbe = '12345-6789';
    await postalInput.fill('');
    await postalInput.pressSequentially(usProbe, { delay: 50 });
    await expect(postalInput).toHaveValue(usProbe);
  });

  test('invalid postal code renders the length-interpolated localized error', {
    annotation: {
      type: 'description',
      description: `Proves the actual #722 deliverable end-to-end: the visible error message states the digit count derived from the tenant's configured postalCodePattern, rendered through the real i18next pipeline (CS_COMPLAINT_POSTALCODE_INVALID_ERROR_LEN with a {{length}} interpolation — the first interpolated key in rainmaker-pgr, so this path has no other coverage in the repo).

Steps:
1. OTP-login as the provisioned citizen and walk to Step 3 (Location Details).
2. Read the tenant's effective postalCodePattern from the page (same resolution order as utils/postalCode.js).
3. Skip unless the pattern is a plain ^[0-9]{N}$ shape (the interpolated-length message only applies to digit-only tenants).
4. Type N+1 digits into #postal-code — guaranteed invalid for a ^[0-9]{N}$ pattern.
5. Assert the visible error text reads "…valid N-digit postal code" with the tenant's actual N.

Catches: a broken i18next interpolation (post-processors mangling the {{length}} placeholder), a missing/mis-seeded localization key surfacing as a raw key, or a digit count derived from the wrong part of the pattern.`,
    },
    tag: ['@area:pgr', '@ccrs:722', '@kind:regression', '@layer:ui', '@persona:citizen', '@pr:1315'] }, async ({ page }) => {
    test.setTimeout(120_000);

    await citizenOtpLogin(page);

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    await reachLocationDetailsStep(page);

    const postalInput = page.locator('#postal-code');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Resolve the tenant's effective pattern exactly the way the app does
    // (utils/postalCode.js): MDMS window channel first, then
    // CORE_POSTAL_CONFIGS / legacy CORE_POSTAL_CODE_CONFIGS by field,
    // then the 5-digit default.
    const pattern = await page.evaluate(() => {
      const w = window as any;
      const mdms = w.__DIGIT_FORM_VALIDATIONS?.postalCode?.pattern;
      if (mdms) return String(mdms);
      const getConfig = w.globalConfigs?.getConfig;
      const cfg = [getConfig?.('CORE_POSTAL_CONFIGS'), getConfig?.('CORE_POSTAL_CODE_CONFIGS')]
        .find((c: any) => c?.postalCodePattern);
      return String(cfg?.postalCodePattern || '^[0-9]{5}$');
    });

    const lenMatch = pattern.match(/^\^?\[0-9\]\{\s*(\d+)\s*\}\$?$/);
    test.skip(!lenMatch, `tenant pattern "${pattern}" is not ^[0-9]{N}$-shaped — length-interpolated message doesn't apply`);
    const n = Number(lenMatch![1]);

    // N+1 digits can never satisfy ^[0-9]{N}$, so the field must flag it.
    await postalInput.click();
    await postalInput.fill('');
    await postalInput.pressSequentially('1'.repeat(n + 1), { delay: 50 });

    // The visible error must carry the tenant's real digit count — not a raw
    // localization key, not a mangled "{{length}}" placeholder, and not a
    // hardcoded count from some other tenant's pattern. `.first()` because
    // getByText is strict-mode: if the message ever also surfaces in a toast
    // or summary step, one visible occurrence should still pass rather than
    // failing as a strict-mode violation.
    const errorText = page.getByText(new RegExp(`valid\\s+${n}[\\s-]?digit postal code`, 'i')).first();
    await expect(errorText).toBeVisible({ timeout: 10_000 });
  });
});
