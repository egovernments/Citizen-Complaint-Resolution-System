/**
 * Onboarding — Phase 4 re-upload recovery (master ticket #21,
 * enrichment #2 of the validation/error pass).
 *
 * Verifies the realistic recovery path after a bad employee xlsx:
 * upload xlsx with errors → preview shows row-level errors + Create
 * disabled → click "← Back" to the generate step → upload a valid
 * xlsx → preview shows all valid → Create N Employees fires.
 *
 * Note: the "Re-upload Fixed File" button on the preview step appears
 * non-functional today (clicks `document.getElementById('employee-
 * file-upload')` but that input only exists in the 'generate' step's
 * conditional render). This spec exercises the Back-button recovery
 * path instead — the user-visible workaround. Track the broken Re-
 * upload button separately.
 *
 * Per CLAUDE.md the body is UI-only. Teardown deactivates the tenant
 * via API (no UI delete affordance — #21).
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import {
  freshOnboardingIds,
  tmpXlsx,
  writeTenantFixture,
  writeBoundaryFixture,
  writeMastersSingle,
  writeComplaintHierarchyFixture,
  deactivateTenantViaApi,
  completePhases123,
  type OnboardingIds,
} from '../utils/onboarding';
import { generateEmployeePhone } from '../utils/env';

test.use({ storageState: { cookies: [], origins: [] } });

const createdTenants: string[] = [];
const tempFiles: string[] = [];

/** A single-row employee workbook parametrised on department. */
async function writeEmployeesFixtureDept(
  file: string, ids: OnboardingIds, dept: string, mobile: string,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Employee');
  sheet.columns = [
    { header: 'employeeCode', key: 'employeeCode' }, { header: 'name', key: 'name' },
    { header: 'mobileNumber', key: 'mobileNumber' }, { header: 'dob', key: 'dob' },
    { header: 'department', key: 'department' }, { header: 'designation', key: 'designation' },
    { header: 'roles', key: 'roles' }, { header: 'jurisdictions', key: 'jurisdictions' },
    { header: 'dateOfAppointment', key: 'dateOfAppointment' },
  ];
  sheet.addRow({
    employeeCode: ids.EMPLOYEE_CODE, name: `PW Employee ${ids.SUFFIX}`,
    mobileNumber: mobile, dob: '1990-01-01',
    department: dept, designation: ids.DESIG_CODE,
    roles: 'EMPLOYEE', jurisdictions: ids.BOUNDARY_ROOT, dateOfAppointment: '2024-01-01',
  });
  await wb.xlsx.writeFile(file);
}

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

test.describe('Onboarding — Phase 4 re-upload after row errors', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('Back from preview → re-upload corrected xlsx → preview shows valid', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);
    const ids = freshOnboardingIds();
    const ghostDept = `GHOSTDEPT_${ids.SUFFIX}`;
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = tmpXlsx('tenant-p4re', ids.SUFFIX);
    const boundaryFixture = tmpXlsx('boundary-p4re', ids.SUFFIX);
    const mastersFixture = tmpXlsx('masters-p4re', ids.SUFFIX);
    const hierarchyFixture = tmpXlsx('hierarchy-p4re', ids.SUFFIX);
    const badFixture = tmpXlsx('employees-bad-p4re', ids.SUFFIX);
    const goodFixture = tmpXlsx('employees-good-p4re', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    await writeBoundaryFixture(boundaryFixture, ids);
    await writeMastersSingle(mastersFixture, ids);
    await writeComplaintHierarchyFixture(hierarchyFixture, ids);
    await writeEmployeesFixtureDept(badFixture, ids, ghostDept, generateEmployeePhone());
    await writeEmployeesFixtureDept(goodFixture, ids, ids.DEPT_CODE, generateEmployeePhone());
    tempFiles.push(tenantFixture, boundaryFixture, mastersFixture, hierarchyFixture, badFixture, goodFixture);

    await completePhases123(page, ids, {
      tenant: tenantFixture,
      boundary: boundaryFixture,
      masters: mastersFixture,
      hierarchy: hierarchyFixture,
    });
    await gotoPhase4Generate(page);

    // First upload: bad department → preview shows row error + disabled
    // Create button.
    await page.locator('#employee-file-upload').setInputFiles(badFixture);
    await expect(page.getByText(new RegExp(`Department "${ghostDept}" not found`)).first())
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Create 0 Employees?/i }).first()).toBeDisabled();

    // Recovery: ← Back to the generate step where the file input lives,
    // then upload the corrected xlsx.
    await page.getByRole('button', { name: /^← Back$/ }).click();
    await expect(page.getByText('Step 4.1: Generate Employee Template')).toBeVisible({ timeout: 15_000 });
    await page.locator('#employee-file-upload').setInputFiles(goodFixture);

    // Preview re-renders with no errors and the Create button enabled.
    await expect(page.getByText(/Validation errors found:/)).toHaveCount(0);
    const createBtn = page.getByRole('button', { name: /Create 1 Employees?/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await expect(createBtn).toBeEnabled();
  });
});
