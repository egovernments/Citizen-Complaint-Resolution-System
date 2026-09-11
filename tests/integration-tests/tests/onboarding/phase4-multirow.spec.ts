/**
 * Onboarding — Phase 4 multi-row mixed valid/invalid employees
 * (master ticket #21, enrichment #5 of the validation/error pass).
 *
 * Verifies the wizard's preview correctly counts a mix of valid and
 * invalid employee rows: 3 valid + 2 invalid (one with a bad
 * department, one with a bad role). The "Create N Employees" button
 * must show 3 (the valid count), the validation Alert must list both
 * invalid rows, and the summary must read "5 total | 3 valid | 2 errors".
 *
 * Per CLAUDE.md the body is UI-only. Teardown deactivates the tenant
 * via API (no UI delete affordance — tracked in #21).
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

async function writeMixedEmployeesFixture(
  file: string, ids: OnboardingIds, ghostDept: string, ghostRole: string,
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
  // Distinct 9-digit mobiles derived from the env-configured employee
  // phone (no hardcoded country literal) — vary the last digit per row.
  const base = generateEmployeePhone();
  const mobileFor = (i: number) => `${base.slice(0, -1)}${i}`;
  // Three valid rows.
  for (let i = 1; i <= 3; i++) {
    sheet.addRow({
      employeeCode: `PWE${i}_${ids.SUFFIX}`,
      name: `Valid ${i} ${ids.SUFFIX}`,
      mobileNumber: mobileFor(i),
      dob: '1990-01-01',
      department: ids.DEPT_CODE,
      designation: ids.DESIG_CODE,
      roles: 'EMPLOYEE',
      jurisdictions: ids.BOUNDARY_ROOT,
      dateOfAppointment: '2024-01-01',
    });
  }
  // Invalid row: bad department.
  sheet.addRow({
    employeeCode: `PWE4_${ids.SUFFIX}`, name: `BadDept ${ids.SUFFIX}`,
    mobileNumber: mobileFor(4), dob: '1990-01-01',
    department: ghostDept, designation: ids.DESIG_CODE,
    roles: 'EMPLOYEE', jurisdictions: ids.BOUNDARY_ROOT, dateOfAppointment: '2024-01-01',
  });
  // Invalid row: bad role.
  sheet.addRow({
    employeeCode: `PWE5_${ids.SUFFIX}`, name: `BadRole ${ids.SUFFIX}`,
    mobileNumber: mobileFor(5), dob: '1990-01-01',
    department: ids.DEPT_CODE, designation: ids.DESIG_CODE,
    roles: ghostRole, jurisdictions: ids.BOUNDARY_ROOT, dateOfAppointment: '2024-01-01',
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

test.describe('Onboarding — Phase 4 multi-row mixed', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('3 valid + 2 invalid → preview reports 5 total / 3 valid / 2 errors and Create button reads 3', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);
    const ids = freshOnboardingIds();
    const ghostDept = `GHOSTDEPT_${ids.SUFFIX}`;
    const ghostRole = `GHOSTROLE_${ids.SUFFIX}`;
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = tmpXlsx('tenant-p4mr', ids.SUFFIX);
    const boundaryFixture = tmpXlsx('boundary-p4mr', ids.SUFFIX);
    const mastersFixture = tmpXlsx('masters-p4mr', ids.SUFFIX);
    const hierarchyFixture = tmpXlsx('hierarchy-p4mr', ids.SUFFIX);
    const employeesFixture = tmpXlsx('employees-p4mr', ids.SUFFIX);
    await writeTenantFixture(tenantFixture, ids);
    await writeBoundaryFixture(boundaryFixture, ids);
    await writeMastersSingle(mastersFixture, ids);
    await writeComplaintHierarchyFixture(hierarchyFixture, ids);
    await writeMixedEmployeesFixture(employeesFixture, ids, ghostDept, ghostRole);
    tempFiles.push(tenantFixture, boundaryFixture, mastersFixture, hierarchyFixture, employeesFixture);

    await completePhases123(page, ids, {
      tenant: tenantFixture,
      boundary: boundaryFixture,
      masters: mastersFixture,
      hierarchy: hierarchyFixture,
    });
    await gotoPhase4Generate(page);
    await page.locator('#employee-file-upload').setInputFiles(employeesFixture);

    // Preview lands. Summary line + Create button reflect the split.
    await expect(page.getByText(/5 total/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/3 valid/).first()).toBeVisible();
    await expect(page.getByText(/2 errors/).first()).toBeVisible();

    // Validation alert lists both invalid row's user-facing names.
    await expect(page.getByText(new RegExp(`Department "${ghostDept}" not found`)).first())
      .toBeVisible();
    await expect(page.getByText(new RegExp(`Role "${ghostRole}" not valid`)).first())
      .toBeVisible();

    // The Create button reads the validCount.
    const createBtn = page.getByRole('button', { name: /Create 3 Employees?/i }).first();
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeEnabled();
  });
});
