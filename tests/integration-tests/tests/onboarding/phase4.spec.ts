/**
 * Onboarding — Phase 4: Employee Onboarding (master ticket #21, gap B).
 *
 * Drives the Phase 4 wizard through the UI:
 *   landing ("Start Phase 4")
 *     → generate (Step 4.1: Generate Employee Template — upload xlsx)
 *     → preview (assert validCount, "Create N Employees")
 *     → confirm dialog (Create N Employees)
 *     → creating (progress bar)
 *     → complete (Banner "Employees Created Successfully!")
 *
 * Phase 4 reads reference data from the active targetTenant (departments,
 * designations, boundaries, roles, mobile-validation rule) on mount, so
 * the spec walks Phase 1 + 2 + 3 first (including the Step 3.2 complaint-
 * hierarchy sub-flow) to seed those records into the freshly-created
 * child tenant.
 *
 * Per CLAUDE.md the body of the test is UI-only. The afterAll teardown
 * deactivates the freshly-created tenant via API because the configurator
 * has no UI delete affordance for tenants today.
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

const ids = freshOnboardingIds();
const TENANT_FIXTURE = tmpXlsx('tenant-p4', ids.SUFFIX);
const BOUNDARY_FIXTURE = tmpXlsx('boundary-p4', ids.SUFFIX);
const MASTERS_FIXTURE = tmpXlsx('masters-p4', ids.SUFFIX);
const HIERARCHY_FIXTURE = tmpXlsx('hierarchy-p4', ids.SUFFIX);
const EMPLOYEES_FIXTURE = tmpXlsx('employees-p4', ids.SUFFIX);

/** From the "Phase 3 Complete!" gate, walk into the Phase 4 generate step. */
async function gotoPhase4Generate(page: Page): Promise<void> {
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/4/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Continue to Phase 4/i }).click(),
  ]);
  await expect(page.getByText('Phase 4: Employee Onboarding')).toBeVisible();
  // Reference-data fetch happens on mount; "Start Phase 4" is disabled
  // while loadingRefs is true. Wait until the wizard is ready.
  const startBtn = page.getByRole('button', { name: /Start Phase 4/i });
  await expect(startBtn).toBeEnabled({ timeout: 30_000 });
  await startBtn.click();
  await expect(page.getByText('Step 4.1: Generate Employee Template')).toBeVisible({ timeout: 30_000 });
}

test.describe('Onboarding — Phase 4: Employee Onboarding', () => {
  test.beforeAll(async () => {
    await writeTenantFixture(TENANT_FIXTURE, ids);
    await writeBoundaryFixture(BOUNDARY_FIXTURE, ids);
    await writeMastersSingle(MASTERS_FIXTURE, ids);
    await writeComplaintHierarchyFixture(HIERARCHY_FIXTURE, ids);
    await writeEmployeesFixture(EMPLOYEES_FIXTURE, ids, generateEmployeePhone());
  });

  test.afterAll(async () => {
    [TENANT_FIXTURE, BOUNDARY_FIXTURE, MASTERS_FIXTURE, HIERARCHY_FIXTURE, EMPLOYEES_FIXTURE]
      .forEach((p) => fs.rmSync(p, { force: true }));
    await deactivateTenantViaApi(ids.TENANT_CODE);
  });

  test('Phase 1 → 2 → 3 setup, then Phase 4 employee xlsx → confirm → success', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);

    await completePhases123(page, ids, {
      tenant: TENANT_FIXTURE,
      boundary: BOUNDARY_FIXTURE,
      masters: MASTERS_FIXTURE,
      hierarchy: HIERARCHY_FIXTURE,
    });
    await gotoPhase4Generate(page);

    // The page renders the reference counts inline; assert they reflect
    // the data we seeded. This also gates progression — if Phase 3's
    // depts/designations didn't land, the count would be 0 here.
    await expect(page.getByText(/Departments:\s*1\s*loaded/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Designations:\s*1\s*loaded/)).toBeVisible();

    // Upload the employee xlsx through the file picker.
    await page.locator('input[type="file"]').first().setInputFiles(EMPLOYEES_FIXTURE);

    // Preview lands. The "Create N Employees" button label carries the
    // valid-row count derived client-side from validateEmployees().
    const createBtn = page.getByRole('button', { name: /Create 1 Employees?/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 30_000 });
    await createBtn.click();

    // Confirm dialog renders the same label.
    const dialogConfirm = page.getByRole('dialog').getByRole('button', { name: /Create 1 Employees?/i });
    await expect(dialogConfirm).toBeVisible({ timeout: 10_000 });
    await dialogConfirm.click();

    // The 'creating' progress step is transient; assert on the final
    // success banner so the test isn't flaky on the loader state.
    await expect(page.getByText('Employees Created Successfully!')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('button', { name: /Complete Setup/i })).toBeVisible();
  });
});
