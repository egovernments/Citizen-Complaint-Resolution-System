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
import { BASE_URL, ROOT_TENANT, LOCALES } from '../utils/env';
import { fetchLocalizedMessage } from '../utils/probes';

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

  test('invalid postal code renders the error the tenant\'s own pattern implies', {
    annotation: {
      type: 'description',
      description: `Proves the actual #722 deliverable end-to-end on ANY deployment: the visible error is the one utils/postalCode.js's own contract selects for this tenant's configured postalCodePattern, rendered through the real i18next pipeline.

The app has two branches and this exercises whichever one applies here:
  • plain ^[0-9]{N}$ pattern -> CS_COMPLAINT_POSTALCODE_INVALID_ERROR_LEN with a {{length}} interpolation (the only interpolated key in rainmaker-pgr).
  • anything else (India's ^[1-9][0-9]{5}$, MZ's dash shape, UK alnum) -> CS_COMPLAINT_POSTALCODE_INVALID_ERROR_GENERIC, no count.

Steps:
1. OTP-login as the provisioned citizen and walk to Step 3 (Location Details).
2. Read the tenant's effective postalCodePattern from the page (same resolution order as utils/postalCode.js).
3. Derive the app's own branch from it, and derive an invalid probe value the pattern is guaranteed to reject.
4. Ask the localization service whether the branch's key is seeded here, so the expected copy is the seeded translation where there is one and the code's English fallback where there is not.
5. Type the probe and assert that exact copy is visible, and that no raw CS_COMPLAINT_POSTALCODE_* key leaked to the citizen.

Previously skipped on any tenant whose pattern was not literally ^[0-9]{N}$, which left the GENERIC branch — the one an Indian, Mozambican or UK tenant actually hits — with no coverage anywhere in the repo.

Catches: a broken i18next interpolation (post-processors mangling {{length}}), a missing key surfacing as a raw code, a digit count derived from the wrong part of the pattern, and a validator that fails to flag an invalid value at all.`,
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

    // Same regex getPostalCodeDigitLength() uses, so the test picks the SAME
    // branch the app does. Deliberately strict: a `{N}` quantifier found
    // elsewhere in a compound pattern is not this pattern's digit count, which
    // is exactly why the app refuses to interpolate one there.
    const lenMatch = pattern.match(/^\^?\[0-9\]\{\s*(\d+)\s*\}\$?$/);
    const digitLength = lenMatch ? lenMatch[1] : null;

    // An invalid probe derived from the tenant's own rule rather than assumed
    // from its shape. For ^[0-9]{N}$, N+1 digits is the minimal violation; for
    // everything else, walk a ladder and take the first candidate the pattern
    // rejects. Never empty — an empty postal code is VALID (optional field), so
    // an empty probe would assert that no error appears.
    const compiled = new RegExp(pattern);
    const probe = digitLength
      ? '1'.repeat(Number(digitLength) + 1)
      : ['1', '12', '1234567890123', 'ZZ ZZZ', '00000-0000-0000'].find((c) => !compiled.test(c));
    expect(
      probe,
      `could not derive a value that pattern ${pattern} rejects — the probe ladder needs a candidate for this shape`,
    ).toBeTruthy();

    // What copy SHOULD appear, mirroring getPostalCodeErrorMessage(t): the
    // seeded translation when the deployment has one, otherwise the hardcoded
    // English fallback the helper falls through to. `pg` seeds neither key, so
    // there the expectation is the fallback — and asserting the fallback is
    // still worth doing: it is the string real citizens read on that tenant.
    const key = digitLength
      ? 'CS_COMPLAINT_POSTALCODE_INVALID_ERROR_LEN'
      : 'CS_COMPLAINT_POSTALCODE_INVALID_ERROR_GENERIC';
    const seeded = await fetchLocalizedMessage(ROOT_TENANT, LOCALES[0], key, { module: 'rainmaker-pgr' });
    const expected = seeded
      ? seeded.replace(/\{\{\s*length\s*\}\}/g, digitLength ?? '')
      : digitLength
        ? `Please enter a valid ${digitLength}-digit postal code`
        : 'Please enter a valid postal code';

    await postalInput.click();
    await postalInput.fill('');
    await postalInput.pressSequentially(probe!, { delay: 50 });

    // `.first()` because getByText is strict-mode: if the message ever also
    // surfaces in a toast or on the summary step, one visible occurrence should
    // still pass rather than failing as a strict-mode violation.
    await expect(
      page.getByText(expected, { exact: false }).first(),
      `typing ${probe} (invalid under ${pattern}) must surface "${expected}"`,
    ).toBeVisible({ timeout: 10_000 });

    // Whichever branch ran, a citizen must never be shown the raw key — the
    // failure mode when the localization row is missing AND the code-level
    // fallback is removed.
    expect(
      await page.getByText(/CS_COMPLAINT_POSTALCODE_INVALID_ERROR/).count(),
      'no raw localization key may leak into the rendered error',
    ).toBe(0);
  });
});
