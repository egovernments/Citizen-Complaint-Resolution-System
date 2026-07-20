/**
 * Onboarding — Phase 4 confirm-dialog cancel (master ticket #21,
 * enrichment #6 of the validation/error pass).
 *
 * Verifies the "Cancel" button on the Phase 4 confirm dialog truly
 * dismisses without firing any creates and leaves the wizard on the
 * preview step. A regression here would have a real operator
 * accidentally creating employees on every dialog open.
 *
 * Walks Phase 1+2+3 to land at Phase 4 with a valid 1-row employee
 * xlsx, then opens the confirm dialog, clicks Cancel, and re-asserts
 * the preview-step state. Per CLAUDE.md the body is UI-only. Teardown
 * deactivates the tenant via API (no UI delete affordance — #21).
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import {
  freshOnboardingIds,
  tmpXlsx,
  writeTenantFixture,
  writeBoundaryFixture,
  writeMastersSingle,
  writeComplaintHierarchyFixture,
  writeEmployeesFixture,
  deactivateTenantViaApi,
  completePhases123,
} from '../utils/onboarding';
import { generateEmployeePhone } from '../utils/env';

test.use({ storageState: { cookies: [], origins: [] } });

const createdTenants: string[] = [];
const tempFiles: string[] = [];

/** From the "Phase 3 Complete!" gate, walk into the Phase 4 generate step. */
async function gotoPhase4Generate(page: Page): Promise<void> {
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/4/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Continue to Phase 4/i }).click(),
  ]);
  await expect(page.getByText('Phase 4: Employee Onboarding')).toBeVisible();
  const startBtn = page.getByRole('button', { name: /Start Phase 4/i });
  await expect(startBtn).toBeEnabled({ timeout: 30_000 });
  await startBtn.click();
  await expect(page.getByText('Step 4.1: Generate Employee Template')).toBeVisible({ timeout: 30_000 });
}

test.describe('Onboarding — Phase 4 confirm dialog', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('Cancel on the confirm dialog dismisses without firing creates', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);
    const ids = freshOnboardingIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = tmpXlsx('tenant-p4cancel', ids.SUFFIX);
    const boundaryFixture = tmpXlsx('boundary-p4cancel', ids.SUFFIX);
    const mastersFixture = tmpXlsx('masters-p4cancel', ids.SUFFIX);
    const hierarchyFixture = tmpXlsx('hierarchy-p4cancel', ids.SUFFIX);
    const employeesFixture = tmpXlsx('employees-p4cancel', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    await writeBoundaryFixture(boundaryFixture, ids);
    await writeMastersSingle(mastersFixture, ids);
    await writeComplaintHierarchyFixture(hierarchyFixture, ids);
    await writeEmployeesFixture(employeesFixture, ids, generateEmployeePhone());
    tempFiles.push(tenantFixture, boundaryFixture, mastersFixture, hierarchyFixture, employeesFixture);

    await completePhases123(page, ids, {
      tenant: tenantFixture,
      boundary: boundaryFixture,
      masters: mastersFixture,
      hierarchy: hierarchyFixture,
    });
    await gotoPhase4Generate(page);
    await page.locator('input[type="file"]').first().setInputFiles(employeesFixture);

    const createBtn = page.getByRole('button', { name: /Create 1 Employees?/i }).first();
    await expect(createBtn).toBeEnabled({ timeout: 30_000 });
    await createBtn.click();

    // Confirm dialog opens.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Click Cancel.
    await dialog.getByRole('button', { name: /^Cancel$/ }).click();

    // Dialog dismisses. We must still be on the preview step — the
    // "Create N Employees" button stays visible and the "Step 4.3:
    // Creating Employees" header (the 'creating' step) must NOT appear.
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Create 1 Employees?/i }).first()).toBeVisible();
    await expect(page.getByText('Step 4.3: Creating Employees')).toHaveCount(0);
    await expect(page.getByText('Employees Created Successfully!')).toHaveCount(0);
  });
});
