/**
 * Onboarding — Phase 2 Option 2: Use Existing Hierarchy (master ticket
 * #21, enrichment #3 of the validation/error pass).
 *
 * Verifies the "Use Existing Hierarchy" path:
 *   1. Walk Phase 1, then enter the Excel path ("Upload from Excel" on
 *      the "Choose Your Data Source" landing) and create a hierarchy via
 *      Option 1 (this leaves the wizard on the Boundary Data Upload step).
 *   2. Click ← Back to return to the "Choose Your Path" excel landing.
 *   3. Click "Option 2: Use Existing Hierarchy" — the list reads from
 *      `boundaryService.getHierarchies(targetTenant)` so our freshly-
 *      created hierarchy must appear.
 *   4. Select it and click "Use Selected Hierarchy" — wizard advances
 *      to the same Boundary Data Upload step Option 1 lands at.
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
  deactivateTenantViaApi,
  loginOnboarding,
  completePhase1,
  enterPhase2ExcelLanding,
  createHierarchyOption1,
} from '../utils/onboarding';

test.use({ storageState: { cookies: [], origins: [] } });

const createdTenants: string[] = [];
const tempFiles: string[] = [];

test.describe('Onboarding — Phase 2 Option 2: Use Existing Hierarchy', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('hierarchy created via Option 1 is selectable via Option 2', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshOnboardingIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = tmpXlsx('tenant-p2opt2', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    tempFiles.push(tenantFixture);

    await loginOnboarding(page);
    await completePhase1(page, ids, tenantFixture);

    // Enter the Excel path and create the hierarchy (Option 1).
    await enterPhase2ExcelLanding(page);
    await createHierarchyOption1(page, ids);

    // ← Back returns to the "Choose Your Path" excel landing.
    await page.getByRole('button', { name: /^← Back$/ }).click();
    await expect(page.getByText('Choose Your Path')).toBeVisible({ timeout: 15_000 });

    // Option 2 path.
    await page.getByRole('button', { name: /Option 2: Use Existing Hierarchy/i }).click();
    await expect(page.getByRole('heading', { name: /Select Existing Hierarchy/i })).toBeVisible({ timeout: 15_000 });

    // The list reads from boundaryService.getHierarchies(targetTenant).
    // Our freshly-created hierarchy should appear by name.
    const hierarchyCard = page.getByRole('button').filter({ hasText: ids.HIERARCHY_TYPE }).first();
    await expect(hierarchyCard).toBeVisible({ timeout: 15_000 });
    await hierarchyCard.click();

    // Use Selected Hierarchy → advance to the Boundary Data Upload step.
    await page.getByRole('button', { name: /Use Selected Hierarchy/i }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 30_000 });
  });
});
