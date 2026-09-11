/**
 * Onboarding — Phase 3 multi-row masters xlsx (master ticket #21,
 * enrichment #5 of the validation/error pass).
 *
 * Verifies the wizard handles a Common Master xlsx with multiple rows
 * per sheet — 3 departments, 2 designations referencing them — and the
 * preview accurately reports the parsed counts before the user submits.
 * Post-`019b1594` the Common Master workbook carries only Departments +
 * Designations (complaint types moved to the Step 3.2 hierarchy flow),
 * so there is no complaint-type count to assert here.
 *
 * This spec stays fast: it asserts the preview counts and that
 * "Create & Continue" advances into "Step 3.2: Define Complaint
 * Hierarchy" — it does NOT drive the Step 3.2 sub-flow to completion
 * (that is covered by walkthrough / phase4 specs).
 *
 * Per CLAUDE.md the body is UI-only. Teardown deactivates the tenant
 * via API (no UI delete affordance — tracked in #21).
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import {
  freshOnboardingIds,
  tmpXlsx,
  writeTenantFixture,
  writeBoundaryFixture,
  writeMastersFixture,
  deactivateTenantViaApi,
  loginOnboarding,
  completePhase1,
  completePhase2,
  phase3UploadMasters,
} from '../utils/onboarding';

test.use({ storageState: { cookies: [], origins: [] } });

const createdTenants: string[] = [];
const tempFiles: string[] = [];

test.describe('Onboarding — Phase 3 multi-row masters', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('preview reports counts for 3 depts + 2 designations, then advances to Step 3.2', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshOnboardingIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = tmpXlsx('tenant-p3mr', ids.SUFFIX);
    const boundaryFixture = tmpXlsx('boundary-p3mr', ids.SUFFIX);
    const mastersFixture = tmpXlsx('masters-p3mr', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    await writeBoundaryFixture(boundaryFixture, ids);
    await writeMastersFixture(mastersFixture, ids, { deptCount: 3, desigCount: 2 });
    tempFiles.push(tenantFixture, boundaryFixture, mastersFixture);

    await loginOnboarding(page);
    await completePhase1(page, ids, tenantFixture);
    await completePhase2(page, ids, boundaryFixture);
    await phase3UploadMasters(page, mastersFixture);

    // Preview summary line reads:
    //   "Summary: 3 departments • 2 designations"
    await expect(page.getByText(/3 departments/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/2 designations/).first()).toBeVisible();

    // "Create & Continue" (was "Create All") advances into the mandatory
    // Step 3.2 complaint-hierarchy sub-flow.
    await page.getByRole('button', { name: /^Create & Continue$/ }).click();
    await expect(page.getByText('Step 3.2: Define Complaint Hierarchy')).toBeVisible({ timeout: 120_000 });
  });
});
