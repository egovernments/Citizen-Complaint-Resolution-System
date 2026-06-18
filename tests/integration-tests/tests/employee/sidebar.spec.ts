/**
 * Employee sidebar — IM module filter (CCRS #446).
 *
 * The employee landing sidebar used to render every module the user
 * had access to, including the IM (Incident Management / ticketing)
 * options `New Ticket` and `Search Ticket`. For a PGR-focused Kenya
 * deployment these are confusing noise — the operator expects only
 * HRMS and Complaint Registry.
 *
 * Fix (PR #29, 500b4fa + globalConfig
 * `EMPLOYEE_MODULE_DENYLIST=["IM"]`) filters the sidebar options
 * through the denylist before rendering. This smoke asserts the
 * observable outcome: IM options are GONE, HRMS + Complaints are still
 * present.
 *
 * We reuse the ADMIN storageState written by auth.setup.ts so the
 * authenticated sidebar is available; this ADMIN has every role and
 * would have seen IM before the fix.
 */
import { test, expect } from '@playwright/test';

import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { loginViaApi } from '../utils/auth';

test.describe('employee sidebar — IM filter #446', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('IM options hidden; HRMS + Complaint Registry visible', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#446: the employee sidebar used to show every module the user had access to including IM (Incident Management) ticketing entries — confusing noise on a PGR-focused Kenya deployment. PR #29 + globalConfig EMPLOYEE_MODULE_DENYLIST=["IM"] filters them out. This test asserts both the negative (IM gone) and positive (HRMS + Complaints still visible) outcomes.

Steps:
1. Navigate to /digit-ui/employee, wait for domcontentloaded then networkidle (modules render after a tenant fetch).
2. Read body innerText and assert it does not match /Something went wrong/i.
3. Negative: getByText(/new ticket|search ticket/i) — assert count === 0.
4. Positive: assert HRMS and any element matching /complaint/i are both visible (within 10s each).

Uses the ADMIN storageState — ADMIN has every role, so before the fix would have seen IM. The /complaint/i regex stays loose because the registry tile's exact label varies by localization.`,
    },
    tag: ['@area:pgr', '@ccrs:446', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    // Self-auth: configurator session (from auth.setup.ts) doesn't bridge
    // to /digit-ui/employee/*. Inject an employee-scoped session via API.
    await loginViaApi(page, {
      baseURL: BASE_URL,
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

    await page.goto(`${BASE_URL}/digit-ui/employee`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Employee home renders module tiles client-side after a tenant
    // fetch — give the sidebar/module list time to mount.
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/Something went wrong/i);

    // Negative: the IM ticketing entries must not appear anywhere on
    // the landing surface. Scope to visible text; invisible bundle
    // strings (e.g. inside a hidden menu definition) don't count.
    const imEntries = page.getByText(/new ticket|search ticket/i);
    await expect(imEntries).toHaveCount(0);

    // Positive: both HRMS and Complaint Registry tiles/links must be
    // present. Complaint Registry's label varies by localization — the
    // fix guarantees SOMETHING containing "complaint" survives the
    // denylist filter.
    const hrms = page.getByText(/HRMS/i).first();
    await expect(hrms).toBeVisible({ timeout: 10_000 });

    const complaint = page.getByText(/complaint/i).first();
    await expect(complaint).toBeVisible({ timeout: 10_000 });
  });
});
