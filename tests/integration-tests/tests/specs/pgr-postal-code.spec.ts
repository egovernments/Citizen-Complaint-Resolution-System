/**
 * PGR Postal Code — retired from intake (CCSD-2207)
 *
 * The postal-code input was REMOVED from both create forms (product call,
 * 2026-08-30): the boundary picker already pins every complaint to a ward,
 * pincodes added no routing value in Mozambique, and the field's partial
 * data corrupted the details-page Address row ("address, <pincode>").
 *
 * This spec used to validate the field's format rules (#478/#722). It now
 * asserts the OPPOSITE: the input must NOT render — a regression guard
 * against the field sneaking back in an upstream merge, which is exactly
 * how the old rules resurfaced twice before.
 *
 * Stored pincodes on pre-existing complaints remain untouched (the employee
 * details page still shows its Código Postal row for them).
 */
import { test, expect, type Page } from '@playwright/test';
import { loginEmployeeBrowser } from '../utils/employee-ui';
import { BASE_URL, ADMIN_USER, ADMIN_PASS } from '../utils/env';

const CITY_ADMIN_USER = process.env.CITY_ADMIN_USER || ADMIN_USER;
const CITY_ADMIN_PASS = process.env.CITY_ADMIN_PASS || ADMIN_PASS;

const CREATE_URL = `${BASE_URL}/digit-ui/employee/pgr/create-complaint`;

test.describe('PGR postal code retired from intake', () => {
  test.beforeEach(async ({ page }) => {
    await loginEmployeeBrowser(page, CITY_ADMIN_USER, CITY_ADMIN_PASS);
  });

  test('employee create form renders WITHOUT a postal-code input', async ({ page }: { page: Page }) => {
    await page.goto(CREATE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Anchor on a field that must exist, so the absence assertion below can't
    // pass vacuously against a broken/blank page.
    await expect(page.locator('form, [class*="form"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('input[name="complainantName"], input[name="ComplainantName"]').first())
      .toBeVisible({ timeout: 30_000 });

    // The retired field: input gone, label gone.
    await expect(page.locator('input[name="postalCode"]')).toHaveCount(0);
    await expect(page.locator('#postal-code')).toHaveCount(0);
  });
});
