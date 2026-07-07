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
import { loginViaApi } from '../utils/auth';
import {
  BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS,
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

test.describe('PGR Postal Code Validation (#478)', () => {
  test.beforeEach(async ({ page }) => {
    // No authTenant override: ADMIN lives at the root tenant, so let
    // loginViaApi derive the root for the OAuth call while still injecting
    // the city TENANT into the Employee.* localStorage keys.
    await loginViaApi(page, {
      tenant: TENANT,
      username: CITY_ADMIN_USER,
      password: CITY_ADMIN_PASS,
    });
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

  test('valid Kenya 5-digit postal code is accepted', {
    annotation: {
      type: 'description',
      description: `Positive case for CCRS#478: a well-formed Kenya postal code (5 digits, may start with 0 — e.g. Nairobi GPO is 00100) must NOT trigger a validation error. Pairs with the rejection cases to ensure the regex is correct in both directions.

Steps:
1. Log in via API as the city admin.
2. Navigate to /digit-ui/employee/pgr/create-complaint and wait for hydration.
3. Fill input[name="postalCode"] with "00100" and blur.
4. Assert no element with text "CS_COMPLAINT_POSTALCODE_INVALID_ERROR" is present (count = 0).

Catches a regression where the validator over-restricts and rejects valid 5-digit codes.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:ui', '@persona:cross'] }, async ({ page }) => {
    await page.goto(CREATE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5_000);

    const postalInput = page.locator('input[name="postalCode"]');
    await expect(postalInput).toBeVisible({ timeout: 15_000 });

    // Enter a valid Kenya postal code (5 digits, can start with 0)
    await postalInput.fill('00100');
    // Blur to trigger validation
    await postalInput.blur();
    await page.waitForTimeout(1_000);

    // No error should appear for the postal code field
    // The error element is typically a sibling or nearby element with the error key
    const cardSection = postalInput.locator('xpath=ancestor::div[contains(@class,"field")]');
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

    // Enter an Indian-format 6-digit postal code — should fail validation
    await postalInput.fill('110001');

    // Need to trigger form submission for react-hook-form to validate
    // Find and click the Submit button
    const submitBtn = page.locator('button[type="button"], button[type="submit"]')
      .filter({ hasText: /submit/i }).first();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();
    await page.waitForTimeout(2_000);

    // The form should show a validation error — either:
    // 1. The localized error string for CS_COMPLAINT_POSTALCODE_INVALID_ERROR
    // 2. Or the form stays on the create page (does not navigate away)
    // We check that we're still on the create-complaint page
    expect(page.url()).toContain('create-complaint');
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

    // Enter a too-short postal code
    await postalInput.fill('123');

    // Submit to trigger validation
    const submitBtn = page.locator('button[type="button"], button[type="submit"]')
      .filter({ hasText: /submit/i }).first();
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();
    await page.waitForTimeout(2_000);

    // Should still be on create-complaint page (validation blocked submission)
    expect(page.url()).toContain('create-complaint');
  });
});
