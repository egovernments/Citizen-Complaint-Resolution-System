/**
 * Onboarding — Phase 2 re-upload recovery (master ticket #21,
 * enrichment #2 of the validation/error pass).
 *
 * Verifies the realistic recovery path after a bad boundary xlsx:
 * upload bad xlsx → verify step shows errors → click "← Back" to the
 * boundary-upload step → upload a valid xlsx → verify step lands with
 * all valid rows → submit.
 *
 * Note: post-CCRS#563 the boundary file input (`#boundary-file-upload`)
 * is hosted at the Phase2Page root, so it stays mounted across the
 * upload/verify steps and the "Re-upload Fixed File" affordance can
 * target it. This spec still exercises the ← Back recovery path — the
 * canonical user-visible workaround — which continues to work.
 *
 * Per CLAUDE.md the body is UI-only. Teardown deactivates the tenant
 * via API (no UI delete affordance — #21).
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
  enterPhase2ExcelLanding,
  createHierarchyOption1,
  type OnboardingIds,
} from '../utils/onboarding';

test.use({ storageState: { cookies: [], origins: [] } });

const createdTenants: string[] = [];
const tempFiles: string[] = [];

/** A boundary workbook whose child row points at a non-existent parent. */
async function writeBadBoundaryFixture(file: string, ids: OnboardingIds, ghost: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Boundary');
  sheet.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'boundaryType', key: 'boundaryType' }, { header: 'parentCode', key: 'parentCode' },
  ];
  sheet.addRow({ code: ids.BOUNDARY_ROOT, name: `Country ${ids.SUFFIX}`, boundaryType: 'Country', parentCode: '' });
  sheet.addRow({ code: ids.BOUNDARY_CHILD, name: `Orphan ${ids.SUFFIX}`, boundaryType: 'City', parentCode: ghost });
  await wb.xlsx.writeFile(file);
}

test.describe('Onboarding — Phase 2 re-upload after bad boundaries', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('Back from verify → re-upload valid xlsx → all valid', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(240_000);
    const ids = freshOnboardingIds();
    const ghost = `PWGHOST_${ids.SUFFIX}`;
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = tmpXlsx('tenant-p2re', ids.SUFFIX);
    const badFixture = tmpXlsx('boundary-bad-p2re', ids.SUFFIX);
    const goodFixture = tmpXlsx('boundary-good-p2re', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    await writeBadBoundaryFixture(badFixture, ids, ghost);
    await writeBoundaryFixture(goodFixture, ids);
    tempFiles.push(tenantFixture, badFixture, goodFixture);

    await loginOnboarding(page);
    await completePhase1(page, ids, tenantFixture);

    await enterPhase2ExcelLanding(page);
    await createHierarchyOption1(page, ids);

    // First upload: bad xlsx → verify with 1 error.
    await page.locator('#boundary-file-upload').setInputFiles(badFixture);
    await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /Errors\s*\(1\)/ })).toBeVisible();

    // Recovery: click ← Back to return to the boundary-upload step, then
    // upload the valid xlsx into the root-hosted file input.
    await page.getByRole('button', { name: /^← Back$/ }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 15_000 });
    await page.locator('#boundary-file-upload').setInputFiles(goodFixture);

    // Verify lands again with all rows valid.
    await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /Valid\s*\(2\)/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Errors\s*\(0\)/ })).toBeVisible();

    // Submit and assert Phase 2 completes.
    await page.getByRole('button', { name: /Upload \d+ Boundaries/i }).click();
    await expect(page.getByText('Boundaries Created Successfully!')).toBeVisible({ timeout: 60_000 });
  });
});
