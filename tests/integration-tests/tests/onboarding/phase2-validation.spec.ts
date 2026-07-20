/**
 * Onboarding — Phase 2 validation paths (master ticket #21, gap B —
 * enrichment #1 of the validation/error pass).
 *
 * Verifies the wizard's client-side rejection of bad Phase 2 inputs:
 *   1. Empty hierarchyType — handleCreateHierarchy refuses to fire,
 *      destructive Alert surfaces "Hierarchy type name is required".
 *   2. Boundary xlsx with a row whose parentCode references a code that
 *      isn't in the dataset — verify step lands but the row appears in
 *      the Errors tab with "Parent ... not found".
 *
 * The create-hierarchy form is reached via the Excel path — "Upload from
 * Excel" on the "Choose Your Data Source" landing → Option 1 — so each
 * test goes through `enterPhase2ExcelLanding` first.
 *
 * Each test creates its own disposable child tenant via Phase 1 to avoid
 * MDMS phantom-200 collisions on the second test re-creating the same
 * code. Per CLAUDE.md the body is UI-only. Teardown deactivates each
 * tenant via API (carve-out: no UI delete affordance for tenants — #21).
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import {
  freshOnboardingIds,
  tmpXlsx,
  writeTenantFixture,
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

/** A boundary workbook whose child row points at a parentCode not in the set. */
async function writeBoundaryBadParentFixture(file: string, ids: OnboardingIds, ghost: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Boundary');
  sheet.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'boundaryType', key: 'boundaryType' }, { header: 'parentCode', key: 'parentCode' },
  ];
  sheet.addRow({ code: ids.BOUNDARY_ROOT, name: `Test Country ${ids.SUFFIX}`, boundaryType: 'Country', parentCode: '' });
  // parentCode references a code that does NOT exist anywhere in the
  // dataset — validateBoundaries should flag this row as invalid.
  sheet.addRow({ code: ids.BOUNDARY_CHILD, name: `Orphan ${ids.SUFFIX}`, boundaryType: 'City', parentCode: ghost });
  await wb.xlsx.writeFile(file);
}

test.describe('Onboarding — Phase 2 validation', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('empty hierarchyType blocks "Create Hierarchy"', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshOnboardingIds();
    const tenantFixture = tmpXlsx('tenant-p2v', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    tempFiles.push(tenantFixture);
    createdTenants.push(ids.TENANT_CODE);

    await loginOnboarding(page);
    await completePhase1(page, ids, tenantFixture);

    await enterPhase2ExcelLanding(page);
    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    // The form's React state initialises hierarchyType to 'ADMIN' (not
    // empty — see Phase2Page.tsx:50). Clear it explicitly to test the
    // empty-name guard.
    await page.locator('#hierarchyType').fill('');
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();

    await expect(page.getByText('Hierarchy type name is required').first()).toBeVisible({ timeout: 10_000 });
    // We must still be on the create-hierarchy step — never advanced
    // to template/upload/verify.
    await expect(page.getByText('Boundary Data Upload')).toHaveCount(0);
    await expect(page.locator('#hierarchyType')).toBeVisible();
  });

  test('boundary xlsx with a missing parentCode lands the row in the Errors tab', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshOnboardingIds();
    const ghost = `PWGHOST_${ids.SUFFIX}`;
    const tenantFixture = tmpXlsx('tenant-p2v', ids.SUFFIX);
    const boundaryFixture = tmpXlsx('boundary-bad-parent-p2v', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    await writeBoundaryBadParentFixture(boundaryFixture, ids, ghost);
    tempFiles.push(tenantFixture, boundaryFixture);
    createdTenants.push(ids.TENANT_CODE);

    await loginOnboarding(page);
    await completePhase1(page, ids, tenantFixture);

    await enterPhase2ExcelLanding(page);
    await createHierarchyOption1(page, ids);
    await page.locator('input[type="file"]').first().setInputFiles(boundaryFixture);

    // Verify step lands. Tab counts: All=2, Valid=1, Errors=1.
    await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /Errors\s*\(1\)/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Valid\s*\(1\)/ })).toBeVisible();

    // Click into the Errors tab and assert the row's parent-not-found
    // message renders with the ghost code.
    await page.getByRole('tab', { name: /Errors\s*\(1\)/ }).click();
    await expect(page.getByText(`Parent "${ghost}" not found`).first()).toBeVisible({ timeout: 10_000 });
  });
});
