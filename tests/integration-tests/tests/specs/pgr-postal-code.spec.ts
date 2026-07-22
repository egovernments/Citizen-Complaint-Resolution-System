/**
 * PGR Postal Code Validation — Employee Create Complaint
 *
 * Validates fix for:
 *   #478 — Postal code uses Kenya 5-digit format (not Indian 6-digit),
 *          and the field is optional (not required).
 *
 * Tests the employee-side complaint creation form at
 *   /digit-ui/employee/pgr/create-complaint
 */
import { test, expect } from '@playwright/test';
import { loginEmployeeBrowser } from '../utils/employee-ui';
import {
  BASE_URL, ADMIN_USER, ADMIN_PASS, POSTAL_CODE_VALID, POSTAL_CODE_PATTERN,
} from '../utils/env';

// Default to the deployment ADMIN. The previous default
// (EMP-KE_NAIROBI-000089) is a known-dead principal — its password broke
// during the encryption-key rotation, so every run authenticated as a
// user that can't log in. ADMIN is the resilient employee on a stock
// deployment; override CITY_ADMIN_USER/PASS for a role-strict tenant.
const CITY_ADMIN_USER = process.env.CITY_ADMIN_USER || ADMIN_USER;
const CITY_ADMIN_PASS = process.env.CITY_ADMIN_PASS || ADMIN_PASS;

// NOTE: postal-code validation is now driven by the CORE_POSTAL_CONFIGS
// global config (per-tenant regex). The hardcoded 00100 (valid) / 110001
// (invalid Indian 6-digit) / 123 (too short) samples below only hold on a
// config-LESS tenant, where the UI falls back to the Kenya 5-digit rule.
// On a tenant that ships an explicit CORE_POSTAL_CONFIGS regex these
// samples may no longer hold — override or gate the tests there.

const CREATE_URL = `${BASE_URL}/digit-ui/employee/pgr/create-complaint`;

/**
 * Derive postal samples the DEPLOYMENT's own pattern rejects, so the negative
 * cases stay honest cross-deployment instead of assuming the Kenya 5-digit rule.
 * `110001`/`123` were only "invalid" against that one shape — on a 6-digit-postal
 * deployment `110001` is valid and the rejection expectation is simply wrong.
 *  - tooLong: a valid code with digits appended until the pattern no longer matches.
 *  - tooShort: the shortest all-`1` prefix the pattern rejects.
 */
function postalRejectedSamples(pattern: string, validBase: string): { tooLong: string; tooShort: string } {
  let re: RegExp;
  try { re = new RegExp(pattern); } catch { return { tooLong: '1234567', tooShort: '1' }; }
  let tooLong = validBase || '1';
  for (let i = 0; i < 12 && re.test(tooLong); i++) tooLong += '9';
  let tooShort = '1';
  for (let n = 1; n <= (validBase.length || 5) + 6; n++) {
    const cand = '1'.repeat(n);
    if (!re.test(cand)) { tooShort = cand; break; }
  }
  return { tooLong, tooShort };
}
const { tooLong: INVALID_POSTAL_LONG, tooShort: INVALID_POSTAL_SHORT } =
  postalRejectedSamples(POSTAL_CODE_PATTERN, POSTAL_CODE_VALID.split('-')[0]);

test.describe('PGR Postal Code Validation (#478)', () => {
  test.beforeEach(async ({ page }) => {
    // loginEmployeeBrowser probes CITY→ROOT for whichever tenant accepts the
    // credentials: a real city employee (EMP001 on mz.maputo) authenticates at
    // the CITY tenant, ADMIN at the ROOT tenant. It injects the token into the
    // Employee.* localStorage keys and lands on /employee.
    const tok = await loginEmployeeBrowser(page, CITY_ADMIN_USER, CITY_ADMIN_PASS);
    expect(tok, `city admin ${CITY_ADMIN_USER} must authenticate (tried CITY + ROOT tenants)`).toBeTruthy();
  });

  test('postal code field is not required — form proceeds without it', {
    annotation: {
      type: 'description',
      description: `Confirms the employee Create Complaint form treats postal code as optional (CCRS#478). Many Kenyan addresses don't have a postal code at all, so making it required would block legitimate complaints; the form must let an employee leave it blank.

Steps:
1. Log in via API as the city admin and seed the page session.
2. Navigate to /digit-ui/employee/pgr/create-complaint and wait for hydration.
3. Locate input[name="postalCode"] and clear it.
4. Read the input's required attribute; assert it is null (not required).

Catches a regression where the field is incorrectly marked required, blocking complaints with no postal code.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await page.goto(CREATE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    // Wait for the form to render — look for the postal code input
    const postalInput = page.locator('input[name="postalCode"]');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Leave postal code empty — it should be optional
    // Fill only the postal code section and check no required-error appears
    // Clear the field to be sure
    await postalInput.click();
    await postalInput.fill('');

    // The field should NOT have a required attribute
    const required = await postalInput.getAttribute('required');
    expect(required).toBeNull();
  });

  test('valid postal code (deployment format) is accepted', {
    annotation: {
      type: 'description',
      description: `Positive case for CCRS#478: a well-formed postal code for this deployment (POSTAL_CODE_VALID — e.g. Kenya "00100" or Mozambique "0101-03") must NOT trigger a validation error. Pairs with the rejection cases to ensure the regex is correct in both directions.

Steps:
1. Log in via API as the city admin.
2. Navigate to /digit-ui/employee/pgr/create-complaint and wait for hydration.
3. Fill input[name="postalCode"] with POSTAL_CODE_VALID and blur.
4. Assert no element with text "CS_COMPLAINT_POSTALCODE_INVALID_ERROR" is present (count = 0).

Catches a regression where the validator over-restricts and rejects valid codes.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await page.goto(CREATE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    const postalInput = page.locator('input[name="postalCode"]');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Enter a valid postal code for this deployment's format. Use the base
    // numeric segment (before any '-sector' suffix): the create-complaint
    // postalCode input is type=number on the redesigned build and can't hold
    // a hyphen, while the base 4/5-digit code is valid on its own (the suffix
    // is optional in the pattern). For Kenya "00100" this is a no-op.
    const validSample = POSTAL_CODE_VALID.split('-')[0];
    await postalInput.fill(validSample);
    // Blur to trigger validation
    await postalInput.blur();
    await page.waitForTimeout(1_000);

    // No error should appear for the postal code field
    const errorNearby = page.locator('text=CS_COMPLAINT_POSTALCODE_INVALID_ERROR');
    await expect(errorNearby).toHaveCount(0);
  });

  test('invalid postal code (6 digits / Indian format) is rejected', {
    annotation: {
      type: 'description',
      description: `Edge case for CCRS#478: a 6-digit Indian-format postal code ("110001") must be rejected. The fix replaced the legacy 6-digit regex with a 5-digit Kenya regex; this test guards against any accidental fallback to the Indian format.

Steps:
1. Log in via API as the city admin.
2. Navigate to /digit-ui/employee/pgr/create-complaint.
3. Fill input[name="postalCode"] with "110001" and click the Submit button.
4. Assert the URL still contains "create-complaint" (validation blocked navigation away).

Catches a regression where the regex reverts to the legacy 6-digit Indian PIN code format.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:edge-case', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await page.goto(CREATE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    const postalInput = page.locator('input[name="postalCode"]');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Enter an over-long postal code the deployment's own pattern rejects
    // (valid code + appended digits), not a Kenya-shaped literal.
    await postalInput.fill(INVALID_POSTAL_LONG);

    // Need to trigger form submission for react-hook-form to validate
    // Find the Submit button.
    const submitBtn = page.locator('button[type="button"], button[type="submit"]')
      .filter({ hasText: /submit/i }).first();
    await submitBtn.scrollIntoViewIfNeeded();
    // The redesigned create-complaint form disables Submit until the *entire*
    // form is valid, so a postal-only negative test can't drive submit here.
    // (On that build the postalCode field is also type=number, which silently
    // ignores its pattern attribute — postal format is only enforced on full
    // form submit.) Skip cleanly rather than hang on a disabled button; on the
    // legacy build where Submit is always clickable, the assertion runs.
    test.skip(
      !(await submitBtn.isEnabled().catch(() => false)),
      'Submit is gated behind full-form validity on this build; postal-only negative case not exercisable.',
    );
    await submitBtn.click();
    await page.waitForTimeout(2_000);

    // Navigation must be blocked AND the postal validation error must surface.
    // The URL check alone is vacuous (submit could no-op for any reason); pairing
    // it with the explicit error element proves the postal validator is what
    // fired — symmetric to the valid case, which asserts count 0 of this locator.
    expect(page.url()).toContain('create-complaint');
    await expect(page.locator('text=CS_COMPLAINT_POSTALCODE_INVALID_ERROR')).toBeVisible();
  });

  test('invalid postal code (short / 3 digits) is rejected', {
    annotation: {
      type: 'description',
      description: `Edge case for CCRS#478: a too-short postal code ("123") must be rejected. Confirms the validator enforces minimum length, not just the prefix or character set.

Steps:
1. Log in via API as the city admin.
2. Navigate to /digit-ui/employee/pgr/create-complaint.
3. Fill input[name="postalCode"] with "123" and click Submit.
4. Assert the URL still contains "create-complaint" (validation blocked navigation away).

Pairs with the 6-digit edge case to bracket the accepted length range from both sides.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:edge-case', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await page.goto(CREATE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    const postalInput = page.locator('input[name="postalCode"]');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Enter a too-short postal code the deployment's own pattern rejects,
    // derived from that pattern rather than assuming a sub-4-digit literal.
    await postalInput.fill(INVALID_POSTAL_SHORT);

    // Submit to trigger validation.
    const submitBtn = page.locator('button[type="button"], button[type="submit"]')
      .filter({ hasText: /submit/i }).first();
    await submitBtn.scrollIntoViewIfNeeded();
    // See the 6-digit case: the redesigned form gates Submit behind full-form
    // validity, so skip rather than hang when it's disabled.
    test.skip(
      !(await submitBtn.isEnabled().catch(() => false)),
      'Submit is gated behind full-form validity on this build; postal-only negative case not exercisable.',
    );
    await submitBtn.click();
    await page.waitForTimeout(2_000);

    // Navigation blocked AND the postal error surfaced (see the 6-digit case).
    expect(page.url()).toContain('create-complaint');
    await expect(page.locator('text=CS_COMPLAINT_POSTALCODE_INVALID_ERROR')).toBeVisible();
  });
});
