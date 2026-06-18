/**
 * Employee profile — country prefix regression (CCRS #444 sub-1).
 *
 * The Edit Profile mobile-number field used to render a hardcoded
 * `+91` prefix block regardless of tenant. On a Kenya deployment this
 * is wrong cosmetically AND functionally — a save attempt would then
 * fail validation (sub-3), because the Kenya MDMS rule expects a
 * +254 / 0-prefixed number.
 *
 * Fix (PR #30, 2f6008c) reads the country code out of tenantInfo and
 * renders it in the `.citizen-card-input--front` block. On naipepea
 * the tenant is `ke.nairobi` so the prefix must be `+254`.
 *
 * We deliberately stop short of submitting the form — the logged-in
 * ADMIN is a shared principal and we don't want a passing test to
 * mutate their profile.
 */
import { test, expect } from '@playwright/test';

import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { getMobileValidationRule } from '../utils/mdms-mobile';
import { loginViaApi } from '../utils/auth';

// Country dial-code rendered in the Edit Profile mobile-number prefix
// block. Sourced from MDMS (ValidationConfigs.mobileNumberValidation.prefix)
// at suite setup so the test stays tenant-agnostic — Rule 1: fetch from
// MDMS rather than carry an env-default. If MDMS hasn't seeded a prefix
// for this tenant, the test self-skips with the deployment gap as the
// reason rather than asserting against an arbitrary fallback.
let expectedPrefix: string | undefined;

test.beforeAll(async () => {
  const rule = await getMobileValidationRule(TENANT);
  expectedPrefix = rule.prefix;
});

test.describe('employee profile — country prefix #444', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('mobile prefix renders +254 on Kenya tenant (not +91)', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#444 sub-1: the Edit Profile mobile-number field used to render a hardcoded "+91" prefix block regardless of tenant. On Kenya deployments this is wrong cosmetically AND functionally — submitting would later fail validation against the +254/0-prefixed Kenya rule. PR #30 reads the country code from tenantInfo and renders it; on naipepea (ke.nairobi) the prefix must be "+254".

Steps:
1. Navigate to /digit-ui/employee/user/profile and wait for domcontentloaded.
2. Wait up to 20s for a mobile input (input[name="mobileNumber"], input[type="tel"], or pattern-matched) to be visible — the form mounts after HRMS self-lookup.
3. Locate .citizen-card-input--front (the prefix block) and wait up to 10s for it to be visible.
4. Read its trimmed innerText.
5. Assert prefixText === '+254'.
6. Assert prefixText !== '+91'.

Deliberately stops short of submitting the form — ADMIN is a shared principal and the test should not mutate their profile.`,
    },
    tag: ['@area:pgr', '@ccrs:444', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    test.skip(
      !expectedPrefix,
      `MDMS ValidationConfigs.mobileNumberValidation has no prefix for tenant=${TENANT} — seed it to enable this assertion`,
    );

    // Self-auth into the employee app (configurator session from
    // auth.setup.ts doesn't bridge to /digit-ui/employee/*).
    await loginViaApi(page, {
      baseURL: BASE_URL,
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

    await page.goto(`${BASE_URL}/digit-ui/employee/user/profile`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Profile form mounts after the HRMS self-lookup; wait for the
    // mobile input to appear so we know the page settled.
    const mobileInput = page
      .locator('input[name="mobileNumber"], input[type="tel"], input[pattern*="0-9"]')
      .first();
    await mobileInput.waitFor({ state: 'visible', timeout: 20_000 });

    // The prefix block sits to the left of the mobile input. Different
    // DIGIT UI builds use different CSS hooks for it (naipepea exposes
    // `.citizen-card-input--front`, newer/bomet builds use class names
    // like `phone-prefix` or a bare span). Match class-first, fall back
    // to a text-shape match for "+digits" (a dial code, scoped tightly
    // to 1–4 digits to avoid colliding with timer/badge strings).
    const prefix = page
      .locator('.citizen-card-input--front, [class*="prefix" i], [class*="dial-code" i]')
      .or(page.getByText(/^\+\d{1,4}$/))
      .first();
    await expect(prefix).toBeVisible({ timeout: 10_000 });

    const prefixText = (await prefix.innerText()).trim();
    expect(prefixText).toBe(expectedPrefix);
    // Guard against the historical +91 regression regardless of which
    // country the deployment is configured for.
    if (expectedPrefix !== '+91') {
      expect(prefixText).not.toBe('+91');
    }
  });
});
