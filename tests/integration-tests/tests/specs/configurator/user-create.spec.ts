/**
 * User Create E2E — Configurator
 *
 * Validates fixes for:
 *   #461 — Mobile validation uses Kenya-compatible regex (not Indian)
 *   #462 — Mobile field is required (not optional)
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../../utils/configurator-auth';

test.describe('User Create — mobile validation (#461/#462)', () => {
  test.beforeEach(async ({ page }) => {
    await loginConfigurator(page);
  });

  test('mobile field shows Kenya-format help text', {
    annotation: {
      type: 'description',
      description: `Verifies the User Create form's mobile field is wired to the Kenya-aware mobile validator (CCRS#461). The help text must mention the "7 or 1" prefix rule — that's how an admin learns the field accepts 9 digits starting with 7 or 1, not the legacy 10-digit Indian format.

Steps:
1. Log in as configurator admin and open /manage/users/create.
2. Wait for the Mobile Number label to render.
3. Assert the "7 or 1" help-text fragment is visible somewhere on the page.

Catches a regression where the form drops back to the default useMobileValidator (Indian) — which would silently reject every valid Kenyan number.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:461', '@ccrs:462', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/users/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for the form to mount — Mobile Number label must be visible
    await expect(page.getByLabel('Mobile Number')).toBeVisible({ timeout: 15_000 });

    // The help text should reference Kenyan mobile format (from useMobileValidator)
    // Current text: "9 digits starting with 7 or 1 (e.g. 712345678)..."
    await expect(page.getByText('7 or 1')).toBeVisible({ timeout: 10_000 });
  });

  test('mobile field is required — form stays on create page', {
    annotation: {
      type: 'description',
      description: `Enforces CCRS#462: a User cannot be created without a mobile number. Previously the field was treated as optional, so admins could create accounts that no OTP/SMS subsystem could ever reach. The test fills only Name, submits, and confirms the form did not navigate away — a visible signal that client-side validation blocked the submit.

Steps:
1. Log in as configurator admin and open /manage/users/create.
2. Fill the Name input with "Test Required" but leave Mobile blank.
3. Click Create.
4. Assert the URL still contains /users/create (no navigation = required validation fired).

Catches CCRS#462 regression where mobile was incorrectly treated as optional.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:461', '@ccrs:462', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/users/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for form to render — use input[name] locator since label has asterisk
    const nameInput = page.locator('input[name="name"]');
    await expect(nameInput).toBeVisible({ timeout: 15_000 });

    // Fill Name but leave mobile empty
    await nameInput.fill('Test Required');

    // Submit the form
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(2_000);

    // Form should NOT have navigated away — still on the create page
    // (validation prevents submission for empty required field)
    expect(page.url()).toContain('/users/create');
  });

  test('submit with invalid mobile shows format error', {
    annotation: {
      type: 'description',
      description: `Edge case for CCRS#461: a too-short mobile (4 digits) must be rejected with a user-readable error. The Kenya regex requires 9-10 digits with a 7-or-1 prefix; "1234" violates length, so the form must show an alert that mentions mobile/digit/format wording.

Steps:
1. Log in as configurator admin and open /manage/users/create.
2. Fill Name with "Test User" and Mobile with "1234".
3. Click Create.
4. Assert at least one role="alert" element is visible.
5. Assert the alert text matches /mobile|digit|7 or 1/i.

Confirms the validator surfaces the failure to the user instead of silently swallowing the submit.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:461', '@ccrs:462', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/users/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for form
    const mobileInput = page.locator('input[name="mobileNumber"]');
    await expect(mobileInput).toBeVisible({ timeout: 15_000 });

    // Fill all fields with an invalid short mobile
    await page.locator('input[name="name"]').fill('Test User');
    await mobileInput.fill('1234');

    // Submit the form
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1_000);

    // Should show validation error (alert role on the error p element)
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert.first()).toBeVisible({ timeout: 5_000 });
    // The error should mention the mobile format
    await expect(errorAlert.first()).toContainText(/mobile|digit|7 or 1/i);
  });

  test('valid Kenya mobile does not show validation error', {
    annotation: {
      type: 'description',
      description: `Positive case for CCRS#461: a well-formed Kenyan mobile (9 digits starting with 7) must NOT trigger a validation alert. Pairs with the "invalid mobile" edge case to ensure the validator's regex is correct in both directions, not just biased toward rejecting.

Steps:
1. Log in as configurator admin and open /manage/users/create.
2. Fill Mobile with "712345678".
3. Click into the Name input to blur the Mobile field and trigger validation.
4. Assert that no role="alert" elements matching /mobile|digit|7 or 1/i are visible (count = 0).

Catches a regression where the Kenya regex is over-strict and rejects valid numbers.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:461', '@ccrs:462', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/users/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for form
    const mobileInput = page.locator('input[name="mobileNumber"]');
    await expect(mobileInput).toBeVisible({ timeout: 15_000 });

    // Fill with a valid Kenyan mobile (9 digits starting with 7)
    await mobileInput.fill('712345678');
    // Blur to trigger validation
    await page.locator('input[name="name"]').click();
    await page.waitForTimeout(500);

    // No error alerts should be visible for the mobile field
    const mobileErrors = page.getByRole('alert').filter({ hasText: /mobile|digit|7 or 1/i });
    await expect(mobileErrors).toHaveCount(0);
  });
});
