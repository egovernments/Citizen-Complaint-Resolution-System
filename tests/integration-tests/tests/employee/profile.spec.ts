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
 * renders it as the dial-code prefix. The v2 UserProfile.js no longer
 * uses the old `.citizen-card-input--front` block (0 occurrences) — the
 * prefix is now an inline `<span>` chip (Phone icon + countryCode) sitting
 * immediately before the `#profile-mobile` local-digits input. On
 * ke.nairobi the MDMS countryCode is `+254`.
 *
 * We deliberately stop short of submitting the form — the logged-in
 * ADMIN is a shared principal and we don't want a passing test to
 * mutate their profile.
 */
import { test, expect } from '@playwright/test';

import { BASE_URL, TENANT } from '../utils/env';
import { getMobileValidationRule } from '../utils/mdms-mobile';

// Expected dial code. Prefer an explicit override, else derive it from
// the tenant's MDMS mobile rule (rule.prefix === the countryCode, e.g.
// "+254" on ke.nairobi). When neither is available the test falls back to
// asserting a generic "+<digits>" shape so it stays tenant-agnostic.
const MOBILE_PREFIX_OVERRIDE = process.env.MOBILE_PREFIX || null;

test.describe('employee profile — country prefix #444', () => {
  test('mobile prefix chip renders the tenant dial code (not hardcoded +91)', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#444 sub-1: the Edit Profile mobile-number field used to render a hardcoded "+91" prefix regardless of tenant. On Kenya deployments this is wrong cosmetically AND functionally — submitting would later fail validation against the +254/0-prefixed Kenya rule. PR #30 reads the country code from MDMS/tenantInfo and renders it as a dial-code chip. The v2 UserProfile.js renders this as an inline <span> chip immediately before #profile-mobile (the old .citizen-card-input--front block is gone).

Steps:
1. Derive the expected dial code from the tenant MDMS mobile rule (or MOBILE_PREFIX override).
2. Navigate to /digit-ui/employee/user/profile and wait for domcontentloaded.
3. Wait up to 20s for #profile-mobile to be visible — the form mounts after HRMS self-lookup.
4. Read the trimmed innerText of the <span> chip immediately preceding the input.
5. Assert it is a "+<digits>" dial code, and not "+91" (unless the tenant genuinely uses +91).
6. When a concrete expected dial code is known, assert an exact match.

Deliberately stops short of submitting the form — ADMIN is a shared principal and the test should not mutate their profile.`,
    },
    tag: ['@area:pgr', '@ccrs:444', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    // Derive the expected dial code from the tenant's MDMS mobile rule so
    // the spec stays tenant-agnostic (was hardcoded +254 for naipepea).
    const rule = await getMobileValidationRule(TENANT).catch(() => null);
    const expectedPrefix = MOBILE_PREFIX_OVERRIDE || rule?.prefix || null;

    await page.goto(`${BASE_URL}/digit-ui/employee/user/profile`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Profile form mounts after the HRMS self-lookup; wait for the v2
    // mobile input (#profile-mobile) to appear so we know it settled.
    const mobileInput = page.locator('#profile-mobile');
    await mobileInput.waitFor({ state: 'visible', timeout: 20_000 });

    // The dial-code chip is the <span> (Phone icon + countryCode) sitting
    // immediately before the input inside the pill container. v2 replaced
    // the old `.citizen-card-input--front` block, which no longer exists.
    const prefix = mobileInput.locator('xpath=preceding-sibling::span[1]');
    await expect(prefix).toBeVisible({ timeout: 10_000 });

    const prefixText = (await prefix.innerText()).trim();
    // Must be a "+"-prefixed numeric dial code (e.g. +254), never a raw
    // enum or empty. Guards the historical +91 regression except where
    // the deployment genuinely uses +91.
    expect(prefixText).toMatch(/^\+\d+$/);
    if (expectedPrefix !== '+91') {
      expect(prefixText).not.toBe('+91');
    }
    // When we know the tenant's configured dial code, pin to it exactly.
    if (expectedPrefix) {
      expect(prefixText).toBe(expectedPrefix);
    }
  });
});
