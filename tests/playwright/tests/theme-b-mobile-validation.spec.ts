import { test, expect } from '@playwright/test';

/**
 * Theme B — Kenya mobile validator on Create Employee.
 *
 * Source: configurator/src/admin/hrms/useMobileValidator.ts. The fallback
 * pattern is `^[17][0-9]{8}$`, min=max=9. Error text rendered into help
 * slot is "Please enter a valid Kenyan mobile number (9 digits starting with
 * 1 or 7)".
 *
 * Strategy:
 *   - `0712345678` — 10 chars, leading trunk-zero. The HRMS validator strips
 *     the trunk-zero in user-service but in the form layer this is exactly
 *     9 + 1 = 10 chars, which is OUTSIDE the min/maxLength=9 bound. Reading
 *     `useMobileValidator.ts`, the bound check fires `errorMessage`. So we
 *     can only assert "field reached invalid state" if we strip the zero.
 *     The user spec calls out asserting `aria-invalid !== "true"` after
 *     blurring `0712345678` — but the configurator's validator actively
 *     rejects 10-digit input. We therefore type `712345678` (the canonical
 *     9-digit form that matches `^[17][0-9]{8}$` directly) for the PASS leg.
 *     Documented in the test body so future readers don't get confused by
 *     "but the spec said 0712345678".
 *   - `9876543210` — 10 chars starting with 9; fails pattern AND length. The
 *     help text appears in the field's `help` block — assert it's visible.
 */

// BrowserRouter basename `/configurator` (App.tsx) + CoreAdminContext
// basename `/manage` => clean `/configurator/manage/<resource>/create`.
const EMPLOYEE_CREATE_URL = '/configurator/manage/employees/create';
const MOBILE_INPUT = 'input[name="user.mobileNumber"]';
const HELP_TEXT = /Please enter a valid Kenyan mobile number/i;

test.describe('Theme B — Configurator Employee mobile validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EMPLOYEE_CREATE_URL);
    // The configurator hash routes through react-admin; the create form
    // mounts the Employee Info fieldset asynchronously. Wait for the mobile
    // input to exist instead of relying on networkidle (the bridge keeps
    // long-poll-ish refetches alive).
    await page.waitForSelector(MOBILE_INPUT, { timeout: 20_000 });
  });

  test('valid Kenya mobile clears aria-invalid', async ({ page }) => {
    await page.waitForTimeout(2_000);
    const mobile = page.locator(MOBILE_INPUT);
    // Type character-by-character so the recorded video shows the digits
    // being entered rather than a single-frame paste.
    await mobile.focus();
    await page.waitForTimeout(800);
    await mobile.pressSequentially('712345678', { delay: 180 });
    await page.waitForTimeout(1_500);
    await mobile.blur();
    await page.waitForTimeout(2_000);
    // Material-UI flips aria-invalid on the underlying input when the
    // composed validator returns a string. PASS = either unset or 'false'.
    const ariaInvalid = await mobile.getAttribute('aria-invalid');
    expect(['false', null]).toContain(ariaInvalid);
    // Defence-in-depth: the Kenya help text must NOT render in the error
    // slot. EmployeeCreate.tsx mirrors the validator's errorMessage into a
    // muted `help` prop ("…optional leading 0)" stays visible even on a
    // valid value), so a naive getByText() always matches. The error
    // rendering is the one tagged `role="alert"` (DigitFormInput.tsx) —
    // assert *that* is absent. If the validator stops firing or the
    // wiring breaks, the alert reappears and this flips red.
    await expect(
      page.locator('[role="alert"]').filter({ hasText: HELP_TEXT }),
    ).toHaveCount(0);
    await page.waitForTimeout(1_500);
  });

  test('invalid mobile surfaces Kenya help text and aria-invalid', async ({ page }) => {
    await page.waitForTimeout(2_000);
    const mobile = page.locator(MOBILE_INPUT);
    await mobile.focus();
    await page.waitForTimeout(800);
    await mobile.pressSequentially('9876543210', { delay: 180 });
    await page.waitForTimeout(1_500);
    await mobile.blur();
    await page.waitForTimeout(2_000);
    // ra-core only surfaces validation errors after a submit attempt OR on
    // blur with `mode: 'onBlur'`. DigitFormInput is configured for onBlur;
    // we still trigger Create submit to be defensive — the form is
    // intentionally incomplete (no tenant/name/dob) so the submit is a no-op
    // but it forces a validation pass.
    const submit = page
      .getByRole('button', { name: /^(Create|Save)$/ })
      .first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click({ trial: false }).catch(() => {});
    }
    // The mobile validator's error message must render somewhere on the
    // page (DigitFormInput renders it via the `helperText` of the
    // underlying MUI TextField). We don't tie the assertion to a specific
    // ancestor — the user task said "rendered as an error somewhere".
    await expect(page.getByText(HELP_TEXT).first()).toBeVisible();
    const ariaInvalid = await mobile.getAttribute('aria-invalid');
    expect(ariaInvalid).toBe('true');
    await page.waitForTimeout(2_500);
  });

  test('valid trunk-zero Kenya mobile (0712345678) clears aria-invalid — #447 + #674', async ({
    page,
  }) => {
    // The everyday Kenyan writing form: 0712345678 (10 chars with the
    // trunk-0). The configurator's fallback validator was hardened in
    // PR #674 to accept this form by stripping the leading zero before
    // checking the [17]\d{8} pattern. Without this drive, a regression
    // of #674 stays green because the other two tests only exercise
    // the bare 9-digit form and the digits-but-wrong-prefix form.
    await page.waitForTimeout(2_000);
    const mobile = page.locator(MOBILE_INPUT);
    await mobile.focus();
    await page.waitForTimeout(800);
    await mobile.pressSequentially('0712345678', { delay: 180 });
    await page.waitForTimeout(1_500);
    await mobile.blur();
    await page.waitForTimeout(2_000);

    const ariaInvalid = await mobile.getAttribute('aria-invalid');
    expect(
      ['false', null],
      `0712345678 (trunk-zero KE form) must clear aria-invalid; got "${ariaInvalid}". Regression of #674 trunk-zero acceptance.`,
    ).toContain(ariaInvalid);
    await expect(
      page.locator('[role="alert"]').filter({ hasText: HELP_TEXT }),
    ).toHaveCount(0);
    await page.waitForTimeout(1_500);
  });
});
