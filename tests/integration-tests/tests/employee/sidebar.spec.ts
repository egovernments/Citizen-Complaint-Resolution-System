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

import { BASE_URL } from '../utils/env';

test.describe('employee sidebar — IM filter #446', () => {
  test('IM options hidden; HRMS + Complaint Registry visible', async ({ page }) => {
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
