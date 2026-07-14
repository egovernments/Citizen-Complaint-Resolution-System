/**
 * Onboarding — Phase 4 validation paths (master ticket #21, gap B —
 * enrichment #1 of the validation/error pass).
 *
 * Verifies the wizard's row-level employee xlsx validation in
 * Phase4Page.validateEmployees():
 *   1. Department code that is not in the wizard's reference list →
 *      `Department "X" not found` row error + Create button disabled.
 *   2. Role code that is not seeded in MDMS roles →
 *      `Role "X" not valid`.
 *
 * Each test creates its own disposable child tenant via Phase 1+2+3 to
 * avoid MDMS phantom-200 collisions. Per CLAUDE.md the body is UI-only.
 * Teardown deactivates each tenant via API (carve-out: no UI delete
 * affordance for tenants — tracked in #21).
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

/** A single-row employee workbook parametrised on department + role. */
async function writeEmployeesFixtureBad(
  file: string, ids: OnboardingIds, dept: string, role: string, mobile: string,
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
    employeeCode: ids.EMPLOYEE_CODE, name: `PW Bad Employee ${ids.SUFFIX}`,
    mobileNumber: mobile, dob: '1990-01-01',
    department: dept, designation: ids.DESIG_CODE,
    roles: role, jurisdictions: ids.BOUNDARY_ROOT, dateOfAppointment: '2024-01-01',
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

interface Fixtures {
  tenant: string; boundary: string; masters: string; hierarchy: string; employees: string;
}

async function setupForTest(ids: OnboardingIds, opts: { dept: string; role: string }): Promise<Fixtures> {
  const tenant = tmpXlsx('tenant-p4v', ids.SUFFIX);
  const boundary = tmpXlsx('boundary-p4v', ids.SUFFIX);
  const masters = tmpXlsx('masters-p4v', ids.SUFFIX);
  const hierarchy = tmpXlsx('hierarchy-p4v', ids.SUFFIX);
  const employees = tmpXlsx(`employees-p4v-${opts.dept}-${opts.role}`, ids.SUFFIX);
  await writeTenantFixture(tenant, ids);
  await writeBoundaryFixture(boundary, ids);
  await writeMastersSingle(masters, ids);
  await writeComplaintHierarchyFixture(hierarchy, ids);
  await writeEmployeesFixtureBad(employees, ids, opts.dept, opts.role, generateEmployeePhone());
  tempFiles.push(tenant, boundary, masters, hierarchy, employees);
  return { tenant, boundary, masters, hierarchy, employees };
}

test.describe('Onboarding — Phase 4 validation', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('row with non-existent department code lands as Error + Create button disabled', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);
    const ids = freshOnboardingIds();
    const ghostDept = `GHOSTDEPT_${ids.SUFFIX}`;
    createdTenants.push(ids.TENANT_CODE);
    const fx = await setupForTest(ids, { dept: ghostDept, role: 'EMPLOYEE' });

    await completePhases123(page, ids, fx);
    await gotoPhase4Generate(page);
    await page.locator('input[type="file"]').first().setInputFiles(fx.employees);

    await expect(page.getByText(new RegExp(`Department "${ghostDept}" not found`)).first())
      .toBeVisible({ timeout: 30_000 });

    const createBtn = page.getByRole('button', { name: /Create 0 Employees?/i }).first();
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeDisabled();
  });

  test('row with invalid role lands as Error', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);
    const ids = freshOnboardingIds();
    const ghostRole = `GHOSTROLE_${ids.SUFFIX}`;
    createdTenants.push(ids.TENANT_CODE);
    const fx = await setupForTest(ids, { dept: ids.DEPT_CODE, role: ghostRole });

    await completePhases123(page, ids, fx);
    await gotoPhase4Generate(page);
    await page.locator('input[type="file"]').first().setInputFiles(fx.employees);

    await expect(page.getByText(new RegExp(`Role "${ghostRole}" not valid`)).first())
      .toBeVisible({ timeout: 30_000 });
  });
});
