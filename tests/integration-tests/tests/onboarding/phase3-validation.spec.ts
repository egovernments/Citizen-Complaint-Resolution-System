/**
 * Onboarding — Phase 3 validation paths (master ticket #21, gap B —
 * enrichment #1 of the validation/error pass).
 *
 * Phase 3 accepts any Common Master xlsx that yields at least one
 * parseable Department OR Designation row (complaint types are no longer
 * part of this workbook — they moved to the Step 3.2 hierarchy flow). It
 * only surfaces a top-level error when both sheets fail to yield any
 * rows. This spec covers that case so the "Phase 3 silently advanced on
 * garbage input" regression is caught.
 *
 * Setup walks Phase 1 + Phase 2 so the wizard has the prerequisites it
 * needs to even render Phase 3. Per CLAUDE.md the body is UI-only.
 * Teardown deactivates the freshly-created tenant via API (carve-out:
 * no UI delete affordance for tenants — tracked in #21).
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import {
  freshOnboardingIds,
  tmpXlsx,
  writeTenantFixture,
  writeBoundaryFixture,
  deactivateTenantViaApi,
  loginOnboarding,
  completePhase1,
  completePhase2,
} from '../utils/onboarding';

test.use({ storageState: { cookies: [], origins: [] } });

const ids = freshOnboardingIds();
const TENANT_FIXTURE = tmpXlsx('tenant-p3v', ids.SUFFIX);
const BOUNDARY_FIXTURE = tmpXlsx('boundary-p3v', ids.SUFFIX);
const MASTERS_NO_RECOGNIZED_SHEETS = tmpXlsx('masters-empty-p3v', ids.SUFFIX);

async function generateMastersWithNoRecognizedSheets(): Promise<void> {
  // The parsers under src/utils/excelParser.ts look for the 'Departments'
  // / 'Designations' sheet names. A workbook with only an unrecognized
  // sheet name yields zero rows from each parser, which trips the
  // wizard's "no departments or designations" branch.
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('SomeOtherSheet');
  sheet.columns = [{ header: 'col1', key: 'col1' }, { header: 'col2', key: 'col2' }];
  sheet.addRow({ col1: 'irrelevant', col2: 'data' });
  await wb.xlsx.writeFile(MASTERS_NO_RECOGNIZED_SHEETS);
}

test.describe('Onboarding — Phase 3 validation', () => {
  test.beforeAll(async () => {
    await writeTenantFixture(TENANT_FIXTURE, ids);
    await writeBoundaryFixture(BOUNDARY_FIXTURE, ids);
    await generateMastersWithNoRecognizedSheets();
  });

  test.afterAll(async () => {
    [TENANT_FIXTURE, BOUNDARY_FIXTURE, MASTERS_NO_RECOGNIZED_SHEETS].forEach((p) => fs.rmSync(p, { force: true }));
    await deactivateTenantViaApi(ids.TENANT_CODE);
  });

  test('xlsx with no recognized master sheets is rejected before preview', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    await loginOnboarding(page);
    await completePhase1(page, ids, TENANT_FIXTURE);
    await completePhase2(page, ids, BOUNDARY_FIXTURE);

    await expect(page.getByText('Phase 3: Common Masters')).toBeVisible();
    await page.getByRole('button', { name: /Start Setup/i }).click();
    await expect(page.getByText('Step 3.1: Upload Common Master Excel')).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(MASTERS_NO_RECOGNIZED_SHEETS);

    // The wizard should surface the "no departments or designations"
    // error and remain on Step 3.1 — never advance to the preview step.
    await expect(page.getByText('No departments or designations found in the file.').first())
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Step 3.1: Upload Common Master Excel')).toBeVisible();
    // No "Create & Continue" submit button should be on screen until preview lands.
    await expect(page.getByRole('button', { name: /^Create & Continue$/ })).toHaveCount(0);
  });
});
