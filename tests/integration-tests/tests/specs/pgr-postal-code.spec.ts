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
import { test, expect, type Page } from '@playwright/test';
import { loginEmployeeBrowser } from '../utils/employee-ui';
import {
  BASE_URL, ADMIN_USER, ADMIN_PASS, POSTAL_CODE_VALID, POSTAL_CODE_PATTERN,
  ROOT_TENANT, TENANT, LOCALES,
} from '../utils/env';

// Default to the deployment ADMIN. The previous default
// (EMP-KE_NAIROBI-000089) is a known-dead principal — its password broke
// during the encryption-key rotation, so every run authenticated as a
// user that can't log in. ADMIN is the resilient employee on a stock
// deployment; override CITY_ADMIN_USER/PASS for a role-strict tenant.
const CITY_ADMIN_USER = process.env.CITY_ADMIN_USER || ADMIN_USER;
const CITY_ADMIN_PASS = process.env.CITY_ADMIN_PASS || ADMIN_PASS;

// NOTE: postal-code validation is config-driven per tenant (MDMS
// FormValidations postalCode row first, then the CORE_POSTAL_CONFIGS global
// config — see utils/postalCode.js). CreateComplaintConfig.js enforces it
// through a react-hook-form `validate` rule (NOT a `pattern`, which would leak
// onto the native input and trigger the browser's own unlocalized bubble), and
// createComplaintForm.js additionally re-checks it on every keystroke so the
// error shows in real time, not only on submit. Nothing below hardcodes a
// country's postal shape: the accepted sample comes from POSTAL_CODE_VALID and
// the rejected ones are derived from POSTAL_CODE_PATTERN — both resolved
// env var -> deployment-profile.json -> legacy default by utils/env.ts, and
// the profile reads the pattern out of the SPA's own globalConfigs. So these
// specs compare the form to its own config.

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
  postalRejectedSamples(POSTAL_CODE_PATTERN, POSTAL_CODE_VALID);

/**
 * The deployment's valid sample, verbatim. The create-complaint postalCode
 * input is `type=text` (PR #1315 flipped it from `number` so the field can
 * hold every shape the configured pattern accepts), so a dash-suffixed
 * sample like mz.maputo's '0101-03' is enterable as-is.
 */
const VALID_POSTAL = POSTAL_CODE_VALID;

/**
 * The digit count for a plain ^[0-9]{N}$-shaped pattern, or null — the same
 * anchored derivation utils/postalCode.js uses (a bare {N} scrape would match
 * an unrelated quantifier in an alnum pattern).
 */
function postalDigitLength(pattern: string): string | null {
  const m = pattern.match(/^\^?\[0-9\]\{\s*(\d+)\s*\}\$?$/);
  return m ? m[1] : null;
}

/**
 * Resolve what the postal error actually RENDERS AS on this deployment.
 *
 * The employee form (createComplaintForm.js) overrides the field's error with
 * `getPostalCodeErrorMessage(t)` — the SAME dynamic, length-aware message the
 * citizen flows show. So the expected inline text is:
 *   - digit-only pattern: the localized CS_COMPLAINT_POSTALCODE_INVALID_ERROR_LEN
 *     with {{length}} interpolated (English fallback "Please enter a valid
 *     N-digit postal code" when the key is unseeded);
 *   - anything else: the localized ..._GENERIC key (English fallback
 *     "Please enter a valid postal code").
 * A raw key never appears in the DOM — getPostalCodeErrorMessage falls back to
 * final English text, not the key, so the fallback expectation here mirrors
 * that exactly.
 */
async function resolvePostalErrorText(page: Page): Promise<string> {
  const len = postalDigitLength(POSTAL_CODE_PATTERN);
  const key = len
    ? 'CS_COMPLAINT_POSTALCODE_INVALID_ERROR_LEN'
    : 'CS_COMPLAINT_POSTALCODE_INVALID_ERROR_GENERIC';
  const fallback = len
    ? `Please enter a valid ${len}-digit postal code`
    : 'Please enter a valid postal code';

  // The locale the employee SPA booted with — the same one t() reads. LOCALES[0]
  // (profile-discovered) is the floor for the case where the key is absent.
  const locale =
    (await page.evaluate(() => localStorage.getItem('Employee.locale')).catch(() => null)) ||
    LOCALES[0];

  // Search the root tenant first (localization is seeded state-wide), then the
  // city tenant for deployments that scope messages per city.
  for (const tenantId of Array.from(new Set([ROOT_TENANT, TENANT]))) {
    try {
      const url =
        `${BASE_URL}/localization/messages/v1/_search` +
        `?locale=${encodeURIComponent(locale)}&tenantId=${encodeURIComponent(tenantId)}` +
        `&module=rainmaker-pgr`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker' } }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { messages?: { code?: string; message?: string }[] };
      const hit = (body.messages || []).find(
        (m) => m.code === key && (m.message || '').trim(),
      );
      if (hit) {
        // Same {{length}} interpolation i18next performs for the LEN key.
        return (hit.message as string).trim().replace(/\{\{\s*length\s*\}\}/g, len ?? '');
      }
    } catch {
      // Try the next tenant; an unreachable localization service falls through
      // to the English fallback, which is what getPostalCodeErrorMessage
      // renders when the key can't resolve.
    }
  }
  return fallback;
}

/**
 * The postal field's OWN container — the nearest `*-label-field-pair` ancestor of
 * the input (`digit-label-field-pair` on the redesigned build, `label-field-pair`
 * on the legacy react-components build).
 *
 * Every assertion below is scoped to this so it cannot be satisfied by
 * absence-everywhere: a create-complaint form that renders no errors at all would
 * still fail the rejection cases, and the acceptance case measures THIS field
 * rather than the page.
 */
function postalFieldContainer(page: Page) {
  return page.locator('xpath=//input[@name="postalCode"]/ancestor::*[contains(@class,"label-field-pair")][1]');
}

/**
 * The postal validation error, scoped to the postal field.
 *
 * Two shapes, because the two UI builds place it differently:
 *  - redesigned (digit-ui-components): `div.digit-error-message` INSIDE the pair.
 *  - legacy (react-components FormComposerV2): `h2.card-label-error` rendered as
 *    the pair's immediate next sibling.
 */
function postalErrorLocator(page: Page, message: string) {
  const inside = postalFieldContainer(page).getByText(message, { exact: false });
  const sibling = page
    .locator(
      'xpath=//input[@name="postalCode"]/ancestor::*[contains(@class,"label-field-pair")][1]' +
        '/following-sibling::*[1][contains(@class,"card-label-error")]',
    )
    .filter({ hasText: message });
  return inside.or(sibling);
}

/**
 * Run the form's validation pass.
 *
 * The redesigned create-complaint form keeps Submit `disabled` until EVERY
 * `isMandatory` populator has a value (createComplaintForm.js submitDisabled →
 * FormComposerV2 isDisabled → SubmitBar `<button disabled>`), so clicking it is
 * impossible from a postal-only test — that is why these cases used to skip.
 * The button is not what validates, though: react-hook-form 6 defaults to
 * `mode: "onSubmit"` and validates on the form's SUBMIT EVENT. `requestSubmit()`
 * fires exactly that event and exercises the identical validation pass, with no
 * dependence on the button's enabled state.
 */
async function submitForm(page: Page): Promise<void> {
  await page.locator('form').first().evaluate((f: HTMLFormElement) => f.requestSubmit());
}

/** Log in, open the create-complaint form, and return its postal input. */
async function openCreateComplaint(page: Page) {
  await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const postalInput = page.locator('input[name="postalCode"]');
  await expect(postalInput).toBeVisible({ timeout: 30_000 });
  // The field's container must resolve, or every scoped assertion below would be
  // vacuously satisfied by a dead locator.
  await expect(postalFieldContainer(page)).toHaveCount(1);
  return postalInput;
}

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
    const postalInput = await openCreateComplaint(page);

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

This case used to be VACUOUS twice over: it asserted count 0 of a raw localization key that is never in the DOM (the UI renders t(key)), and it only blurred the field — react-hook-form validates on the SUBMIT event, so nothing had validated when the count was taken. Both defects are removed by (a) asserting on the localization-resolved message, scoped to the postal field's own container, and (b) proving the locator is live before trusting its absence: submit an invalid code first, watch the error appear, then correct the value and watch it clear.

Steps:
1. Log in via API as the city admin.
2. Navigate to /digit-ui/employee/pgr/create-complaint and wait for hydration.
3. Resolve the expected error text from /localization/messages/v1/_search (module rainmaker-pgr, the SPA's own locale), falling back to the English getPostalCodeErrorMessage() text when unseeded.
4. Fill an invalid code, dispatch form.requestSubmit(), assert the scoped postal error IS visible — this proves the assertion locator can match.
5. Fill POSTAL_CODE_VALID verbatim, dispatch form.requestSubmit(), assert the scoped postal error clears (count = 0).

Catches a regression where the validator over-restricts and rejects valid codes.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    const postalInput = await openCreateComplaint(page);
    const expectedError = await resolvePostalErrorText(page);
    const postalError = postalErrorLocator(page, expectedError);

    // Arm the assertion: drive the field into the rejected state first, so the
    // count-0 below is a MEASURED transition rather than an absence that would
    // hold even with the postal validator ripped out.
    await postalInput.fill(INVALID_POSTAL_LONG);
    await submitForm(page);
    await expect(
      postalError.first(),
      `postal error "${expectedError}" must render for the rejected sample ${INVALID_POSTAL_LONG} — ` +
        'without it the count-0 assertion below would be vacuous',
    ).toBeVisible({ timeout: 15_000 });

    // Now the deployment's own valid sample must clear it. react-hook-form
    // re-validates on change after the first submit, and the second submit
    // forces the full pass regardless.
    await postalInput.fill(VALID_POSTAL);
    await submitForm(page);
    await expect(
      postalError,
      `valid postal code ${VALID_POSTAL} (pattern ${POSTAL_CODE_PATTERN}) must not raise a postal error`,
    ).toHaveCount(0);
  });

  test('postal error shows in real time while typing, without submit', {
    annotation: {
      type: 'description',
      description: `Real-time validation regression guard (PR #1315 follow-up): the postal error must appear AS THE USER TYPES an invalid value and clear the moment the value becomes valid — with NO submit dispatched at any point. react-hook-form 6 runs in its default mode:"onSubmit", so the field's own validate rule is submit-only; createComplaintForm.js's onFormValueChange re-checks isPostalCodeValid() on every keystroke and drives the error through the same guarded setError/clearErrors pattern the mobile field uses.

Steps:
1. Log in via API as the city admin and open /digit-ui/employee/pgr/create-complaint.
2. Resolve the expected error text (same dynamic, length-aware message as the citizen flows).
3. Type an invalid sample into input[name="postalCode"] — do NOT submit.
4. Assert the scoped, localized error is visible (and that the browser's native validation bubble is not the mechanism: the input must carry no pattern attribute).
5. Replace the value with POSTAL_CODE_VALID — still no submit — and assert the error clears.
6. Clear the field entirely and assert it stays error-free (optional field).

Catches: the field silently reverting to submit-only validation, the native pattern attribute sneaking back onto the input (browser bubble instead of the localized message), and an error that fails to clear once corrected.`,
    },
    tag: ['@area:pgr', '@ccrs:722', '@kind:regression', '@layer:ui', '@persona:cross', '@pr:1315'] }, async ({ page }) => {
    const postalInput = await openCreateComplaint(page);
    const expectedError = await resolvePostalErrorText(page);
    const postalError = postalErrorLocator(page, expectedError);

    // The native pattern attribute must NOT be on the input — its presence
    // would mean the browser's own "Please match the requested format" bubble
    // gates submit before any localized validation runs (the original bug).
    expect(await postalInput.getAttribute('pattern')).toBeNull();

    // Type an invalid value keystroke-by-keystroke; the error must appear
    // without any submit.
    await postalInput.click();
    await postalInput.pressSequentially(INVALID_POSTAL_LONG, { delay: 40 });
    await expect(
      postalError.first(),
      `postal error "${expectedError}" must appear while typing ${INVALID_POSTAL_LONG}, before any submit`,
    ).toBeVisible({ timeout: 10_000 });

    // Correcting the value must clear it immediately — still no submit.
    await postalInput.fill(VALID_POSTAL);
    await expect(
      postalError,
      `postal error must clear as soon as the value becomes valid (${VALID_POSTAL})`,
    ).toHaveCount(0);

    // Optional field: emptying it must not raise an error either.
    await postalInput.fill('');
    await expect(postalError).toHaveCount(0);
  });

  test('invalid postal code (6 digits / Indian format) is rejected', {
    annotation: {
      type: 'description',
      description: `Edge case for CCRS#478: a postal code that is too LONG for the deployment's own pattern (POSTAL_CODE_VALID with digits appended until the regex stops matching — e.g. the legacy 6-digit Indian PIN shape on a 5-digit deployment) must be rejected. Guards against an accidental fallback to a looser/longer format.

Previously skipped: it tried to click Submit, which the redesigned form keeps disabled until every mandatory populator is filled. The button is not the validator — react-hook-form 6 validates on the form's submit EVENT — so this dispatches form.requestSubmit() instead and exercises the identical validation pass.

Steps:
1. Log in via API as the city admin.
2. Navigate to /digit-ui/employee/pgr/create-complaint.
3. Resolve the expected error text from /localization/messages/v1/_search (module rainmaker-pgr), falling back to the English getPostalCodeErrorMessage() text when unseeded.
4. Fill input[name="postalCode"] with the over-long sample and dispatch form.requestSubmit().
5. Assert the error renders inside the postal field's own container, and that the URL still contains "create-complaint".

Catches a regression where the regex reverts to a longer format (e.g. the legacy 6-digit Indian PIN code).`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:edge-case', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    const postalInput = await openCreateComplaint(page);
    const expectedError = await resolvePostalErrorText(page);

    // Enter an over-long postal code the deployment's own pattern rejects
    // (valid code + appended digits), not a Kenya-shaped literal.
    await postalInput.fill(INVALID_POSTAL_LONG);
    await submitForm(page);

    // The postal validation error must surface ON THE POSTAL FIELD, and
    // navigation must be blocked. The URL check alone is vacuous (submit could
    // no-op for any reason); the scoped error element proves the postal
    // validator is what fired — symmetric to the acceptance case, which asserts
    // count 0 of this same locator.
    await expect(
      postalErrorLocator(page, expectedError).first(),
      `${INVALID_POSTAL_LONG} must be rejected by pattern ${POSTAL_CODE_PATTERN} with "${expectedError}"`,
    ).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('create-complaint');
  });

  test('invalid postal code (short / 3 digits) is rejected', {
    annotation: {
      type: 'description',
      description: `Edge case for CCRS#478: a too-SHORT postal code (the shortest all-'1' prefix the deployment's own pattern rejects) must be rejected. Confirms the validator enforces minimum length, not just the prefix or character set.

Previously skipped for the same reason as the over-long case — it clicked a Submit button the redesigned form keeps disabled until every mandatory populator is filled. Uses form.requestSubmit() instead, which is what react-hook-form actually validates on.

Steps:
1. Log in via API as the city admin.
2. Navigate to /digit-ui/employee/pgr/create-complaint.
3. Resolve the expected error text from /localization/messages/v1/_search (module rainmaker-pgr), falling back to the English getPostalCodeErrorMessage() text when unseeded.
4. Fill input[name="postalCode"] with the too-short sample and dispatch form.requestSubmit().
5. Assert the error renders inside the postal field's own container, and that the URL still contains "create-complaint".

Pairs with the over-long edge case to bracket the accepted length range from both sides.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:edge-case', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    const postalInput = await openCreateComplaint(page);
    const expectedError = await resolvePostalErrorText(page);

    // Enter a too-short postal code the deployment's own pattern rejects,
    // derived from that pattern rather than assuming a sub-4-digit literal.
    await postalInput.fill(INVALID_POSTAL_SHORT);
    await submitForm(page);

    // Scoped error + blocked navigation (see the over-long case).
    await expect(
      postalErrorLocator(page, expectedError).first(),
      `${INVALID_POSTAL_SHORT} must be rejected by pattern ${POSTAL_CODE_PATTERN} with "${expectedError}"`,
    ).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('create-complaint');
  });
});
