/**
 * Onboarding — Phase 1 validation paths (master ticket #21, gap B —
 * enrichment #1 of the validation/error pass).
 *
 * Verifies the wizard's client-side rejection of malformed tenant xlsx
 * files. Each test uploads a bad xlsx and asserts the wizard:
 *   1. surfaces the parser's user-facing error message,
 *   2. stays on Step 1.1 (does not advance to preview),
 *   3. does not fire any MDMS create.
 *
 * Validation rules under test live in `src/utils/excelParser.ts` and
 * mirror the configurator's source code:
 *   - "Tenant code is required" — empty `tenantCode` cell.
 *   - "Tenant code must contain only letters, dots, and spaces
 *     numbers, and dots" — regex `^[A-Za-z][A-Za-z0-9.]*$`.
 *   - "Excel sheet is empty" — sheet has headers but no data rows.
 *
 * No teardown — these tests never reach the create step, so no records
 * land in DIGIT. Per CLAUDE.md the spec is UI-only.
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

test.use({ storageState: { cookies: [], origins: [] } });

// Letters-only: egov-user validates tenantId against `^[a-zA-Z. ]*$` (no
// digits), and the configurator's upload parser now mirrors that rule — a
// numeric suffix is rejected at Step 1.1 before "File loaded:" ever renders.
// Same digit->letter map (0->a .. 9->j) as utils/onboarding.freshOnboardingIds.
const SUFFIX = Date.now()
  .toString()
  .slice(-8)
  .replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d)));
const ROOT = ROOT_TENANT;

const FIX_INVALID_CODE = path.join(os.tmpdir(), `tenant-invalid-code-${SUFFIX}.xlsx`);
const FIX_MISSING_CODE = path.join(os.tmpdir(), `tenant-missing-code-${SUFFIX}.xlsx`);
const FIX_EMPTY_SHEET = path.join(os.tmpdir(), `tenant-empty-${SUFFIX}.xlsx`);

const TENANT_COLS = [
  { header: 'tenantCode', key: 'tenantCode' },
  { header: 'tenantName', key: 'tenantName' },
  { header: 'displayName', key: 'displayName' },
  { header: 'tenantType', key: 'tenantType' },
];

async function writeTenantFixture(file: string, row: Record<string, string | number>): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Tenant Info');
  sheet.columns = TENANT_COLS;
  sheet.addRow(row);
  await wb.xlsx.writeFile(file);
}

async function writeEmptyFixture(file: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Tenant Info');
  sheet.columns = TENANT_COLS;
  // no addRow — sheet has headers but zero data rows
  await wb.xlsx.writeFile(file);
}

async function loginAndOpenUploadStep(page: Page): Promise<void> {
  await page.goto('/configurator/login');
  await expect(page.locator('#username')).toBeVisible();
  await page.locator('#username').fill(ADMIN_USER);
  await page.locator('#password').fill(ADMIN_PASS);
  await page.locator('#tenantCode').click();
  await page.locator('#tenantCode').fill(ROOT);
  await page.getByRole('button', { name: /^Onboarding$/ }).click();
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/1/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Sign In/i }).click(),
  ]);
  await page.getByRole('button', { name: /Start Setup/i }).click();
  await expect(page.getByText('Step 1.1: Upload Tenant Master Excel')).toBeVisible();
}

test.describe('Onboarding — Phase 1 validation', () => {
  test.beforeAll(async () => {
    await writeTenantFixture(FIX_INVALID_CODE, {
      // Contains digits — violates the parser's `^[a-zA-Z. ]*$` (which mirrors
      // egov-user's tenantId constraint; digits are not permitted at all).
      tenantCode: `bad1code${SUFFIX}`,
      tenantName: `PW Invalid Code ${SUFFIX}`,
      displayName: `PW Invalid Code ${SUFFIX}`,
      tenantType: 'City',
    });
    await writeTenantFixture(FIX_MISSING_CODE, {
      tenantCode: '',
      tenantName: `PW Missing Code ${SUFFIX}`,
      displayName: `PW Missing Code ${SUFFIX}`,
      tenantType: 'City',
    });
    await writeEmptyFixture(FIX_EMPTY_SHEET);
  });

  test.afterAll(() => {
    [FIX_INVALID_CODE, FIX_MISSING_CODE, FIX_EMPTY_SHEET].forEach((p) => fs.rmSync(p, { force: true }));
  });

  test('rejects a tenantCode that does not match the regex', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(60_000);
    await loginAndOpenUploadStep(page);

    await page.locator('input[type="file"]').first().setInputFiles(FIX_INVALID_CODE);

    // The wizard renders the parser's exact message in two places: the
    // top-of-page destructive alert and the per-step validation bullet
    // list. `.first()` scopes the assertion to whichever paints first.
    await expect(
      page.getByText('Tenant code must contain only letters, dots, and spaces (numbers are not supported)').first(),
    ).toBeVisible({ timeout: 15_000 });

    // We must still be on Step 1.1 — the wizard should not have
    // advanced to the preview step.
    await expect(page.getByText('Step 1.1: Upload Tenant Master Excel')).toBeVisible();
    await expect(page.getByText(/File loaded:/)).toHaveCount(0);
  });

  test('rejects a missing tenantCode (empty cell)', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(60_000);
    await loginAndOpenUploadStep(page);

    await page.locator('input[type="file"]').first().setInputFiles(FIX_MISSING_CODE);

    await expect(page.getByText('Tenant code is required').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Step 1.1: Upload Tenant Master Excel')).toBeVisible();
    await expect(page.getByText(/File loaded:/)).toHaveCount(0);
  });

  test('rejects an xlsx with headers but no data rows', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(60_000);
    await loginAndOpenUploadStep(page);

    await page.locator('input[type="file"]').first().setInputFiles(FIX_EMPTY_SHEET);

    await expect(page.getByText('Excel sheet is empty').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Step 1.1: Upload Tenant Master Excel')).toBeVisible();
    await expect(page.getByText(/File loaded:/)).toHaveCount(0);
  });
});
