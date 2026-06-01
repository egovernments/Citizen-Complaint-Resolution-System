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
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { getDigitToken } from '../utils/auth';

test.use({ storageState: { cookies: [], origins: [] } });

const ROOT = process.env.ROOT_TENANT || 'ke';
const ADMIN_USER = process.env.ADMIN_USER || 'ADMIN';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'eGov@123';
const BASE_URL = process.env.BASE_URL || 'https://naipepea.digit.org';

const createdTenants: string[] = [];
const tempFiles: string[] = [];

function freshIds() {
  const SUFFIX = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  return {
    SUFFIX,
    TENANT_CODE: `${ROOT}.pwt${SUFFIX}`,
    TENANT_NAME: `Playwright Test ${SUFFIX}`,
    HIERARCHY_TYPE: `PWHIER${SUFFIX}`,
    BOUNDARY_ROOT: `PWB1_${SUFFIX}`,
    BOUNDARY_CHILD: `PWB2_${SUFFIX}`,
    DEPT_CODE: `PWD_${SUFFIX}`,
    DESIG_CODE: `PWS_${SUFFIX}`,
    COMPLAINT_CODE: `PWC_${SUFFIX}`,
    GHOST_DEPT: `GHOSTDEPT_${SUFFIX}`,
    GHOST_ROLE: `GHOSTROLE_${SUFFIX}`,
    EMPLOYEE_MOBILE: `7${SUFFIX}`.slice(0, 9),
  };
}

type Ids = ReturnType<typeof freshIds>;

async function writeTenantFixture(file: string, ids: Ids): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Tenant Info');
  sheet.columns = [
    { header: 'tenantCode', key: 'tenantCode' }, { header: 'tenantName', key: 'tenantName' },
    { header: 'displayName', key: 'displayName' }, { header: 'tenantType', key: 'tenantType' },
    { header: 'cityName', key: 'cityName' }, { header: 'districtName', key: 'districtName' },
  ];
  sheet.addRow({
    tenantCode: ids.TENANT_CODE, tenantName: ids.TENANT_NAME, displayName: ids.TENANT_NAME,
    tenantType: 'City', cityName: ids.TENANT_NAME, districtName: 'Test District',
  });
  await wb.xlsx.writeFile(file);
}

async function writeBoundaryFixture(file: string, ids: Ids): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Boundary');
  sheet.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'boundaryType', key: 'boundaryType' }, { header: 'parentCode', key: 'parentCode' },
  ];
  sheet.addRow({ code: ids.BOUNDARY_ROOT, name: `Country ${ids.SUFFIX}`, boundaryType: 'Country', parentCode: '' });
  sheet.addRow({ code: ids.BOUNDARY_CHILD, name: `City ${ids.SUFFIX}`, boundaryType: 'City', parentCode: ids.BOUNDARY_ROOT });
  await wb.xlsx.writeFile(file);
}

async function writeMastersFixture(file: string, ids: Ids): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const dept = wb.addWorksheet('Departments');
  dept.columns = [{ header: 'code', key: 'code' }, { header: 'name', key: 'name' }, { header: 'active', key: 'active' }];
  dept.addRow({ code: ids.DEPT_CODE, name: `Dept ${ids.SUFFIX}`, active: true });

  const desig = wb.addWorksheet('Designations');
  desig.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'description', key: 'description' }, { header: 'department', key: 'department' },
    { header: 'active', key: 'active' },
  ];
  desig.addRow({ code: ids.DESIG_CODE, name: `Desig ${ids.SUFFIX}`, description: 'PW', department: ids.DEPT_CODE, active: true });

  const complaint = wb.addWorksheet('ComplaintType');
  complaint.columns = [
    { header: 'serviceCode', key: 'serviceCode' }, { header: 'name', key: 'name' },
    { header: 'keywords', key: 'keywords' }, { header: 'department', key: 'department' },
    { header: 'slaHours', key: 'slaHours' }, { header: 'active', key: 'active' },
  ];
  complaint.addRow({ serviceCode: ids.COMPLAINT_CODE, name: `Complaint ${ids.SUFFIX}`, keywords: 'pw', department: ids.DEPT_CODE, slaHours: 48, active: true });

  await wb.xlsx.writeFile(file);
}

async function writeEmployeesFixture(file: string, ids: Ids, dept: string, role: string): Promise<void> {
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
    employeeCode: `PWE_${ids.SUFFIX}`, name: `PW Bad Employee ${ids.SUFFIX}`,
    mobileNumber: ids.EMPLOYEE_MOBILE, dob: '1990-01-01',
    department: dept, designation: ids.DESIG_CODE,
    roles: role, jurisdictions: ids.BOUNDARY_ROOT, dateOfAppointment: '2024-01-01',
  });
  await wb.xlsx.writeFile(file);
}

async function deactivateTenantViaApi(code: string): Promise<void> {
  // NOTE: API teardown — no UI delete affordance for tenants today (#21).
  const token = await getDigitToken({ tenant: ROOT, username: ADMIN_USER, password: ADMIN_PASS });
  const ri = { apiId: 'Rainmaker', ver: '1.0', ts: Date.now(), msgId: `${Date.now()}|en_IN`, authToken: token.access_token };
  const searchResp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: ri, MdmsCriteria: { tenantId: ROOT, schemaCode: 'tenant.tenants', uniqueIdentifiers: [code] } }),
  });
  if (!searchResp.ok) return;
  const record = ((await searchResp.json()) as { mdms?: Array<Record<string, unknown>> }).mdms?.[0];
  if (!record) return;
  await fetch(`${BASE_URL}/mdms-v2/v2/_update/tenant.tenants`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: ri, Mdms: { ...record, isActive: false } }),
  });
}

async function loginAndCompletePhases123(
  page: Page, ids: Ids, tenantFixture: string, boundaryFixture: string, mastersFixture: string,
): Promise<void> {
  await page.goto('/configurator/login');
  await expect(page.locator('#username')).toBeVisible();
  await page.locator('#username').fill(ADMIN_USER);
  await page.locator('#password').fill(ADMIN_PASS);
  await page.locator('#tenantCode').click();
  await page.locator('#tenantCode').fill(ROOT);
  await page.getByRole('button', { name: /^Onboarding$/ }).click();
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/1/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Sign In/i }).click(),
  ]);

  // Phase 1
  await page.getByRole('button', { name: /Start Setup/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(tenantFixture);
  await expect(page.getByRole('cell', { name: ids.TENANT_CODE })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Upload to DIGIT/i }).click();
  await expect(page.getByText('Step 1.2: Branding assets')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await expect(page.getByText('Phase 1 Complete!')).toBeVisible({ timeout: 30_000 });
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/2/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Continue to Phase 2/i }).click(),
  ]);

  // Phase 2
  await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
  await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
  await page.locator('#hierarchyType').fill(ids.HIERARCHY_TYPE);
  await page.getByRole('button', { name: /Create Hierarchy/i }).click();
  await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });
  await page.locator('input[type="file"]').first().setInputFiles(boundaryFixture);
  await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Upload \d+ Boundaries/i }).click();
  await expect(page.getByText('Boundaries Created Successfully!')).toBeVisible({ timeout: 60_000 });
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/3/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Continue to Phase 3/i }).click(),
  ]);

  // Phase 3
  await page.getByRole('button', { name: /Start Setup/i }).click();
  await expect(page.getByText('Step 3.1: Upload Common Master Excel')).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(mastersFixture);
  await expect(page.getByText(ids.DEPT_CODE).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Create All$/ }).click();
  await expect(page.getByText('Phase 3 Complete!')).toBeVisible({ timeout: 120_000 });
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/4/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Continue to Phase 4/i }).click(),
  ]);

  // Land at Phase 4 generate step.
  await expect(page.getByText('Phase 4: Employee Onboarding')).toBeVisible();
  const startBtn = page.getByRole('button', { name: /Start Phase 4/i });
  await expect(startBtn).toBeEnabled({ timeout: 30_000 });
  await startBtn.click();
  await expect(page.getByText('Step 4.1: Generate Employee Template')).toBeVisible({ timeout: 30_000 });
}

async function setupForTest(
  ids: Ids, options: { dept: string; role: string },
): Promise<{ tenantFixture: string; boundaryFixture: string; mastersFixture: string; employeesFixture: string }> {
  const tenantFixture = path.join(os.tmpdir(), `tenant-p4v-${ids.SUFFIX}.xlsx`);
  const boundaryFixture = path.join(os.tmpdir(), `boundary-p4v-${ids.SUFFIX}.xlsx`);
  const mastersFixture = path.join(os.tmpdir(), `masters-p4v-${ids.SUFFIX}.xlsx`);
  const employeesFixture = path.join(os.tmpdir(), `employees-p4v-${ids.SUFFIX}-${options.dept}-${options.role}.xlsx`);
  await writeTenantFixture(tenantFixture, ids);
  await writeBoundaryFixture(boundaryFixture, ids);
  await writeMastersFixture(mastersFixture, ids);
  await writeEmployeesFixture(employeesFixture, ids, options.dept, options.role);
  tempFiles.push(tenantFixture, boundaryFixture, mastersFixture, employeesFixture);
  return { tenantFixture, boundaryFixture, mastersFixture, employeesFixture };
}

test.describe('Onboarding — Phase 4 validation', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('row with non-existent department code lands as Error + Create button disabled', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);
    const ids = freshIds();
    createdTenants.push(ids.TENANT_CODE);
    const { tenantFixture, boundaryFixture, mastersFixture, employeesFixture } =
      await setupForTest(ids, { dept: ids.GHOST_DEPT, role: 'EMPLOYEE' });

    await loginAndCompletePhases123(page, ids, tenantFixture, boundaryFixture, mastersFixture);
    await page.locator('input[type="file"]').first().setInputFiles(employeesFixture);

    await expect(page.getByText(new RegExp(`Department "${ids.GHOST_DEPT}" not found`)).first())
      .toBeVisible({ timeout: 30_000 });

    const createBtn = page.getByRole('button', { name: /Create 0 Employees?/i }).first();
    await expect(createBtn).toBeVisible();
    await expect(createBtn).toBeDisabled();
  });

  test('row with invalid role lands as Error', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);
    const ids = freshIds();
    createdTenants.push(ids.TENANT_CODE);
    const { tenantFixture, boundaryFixture, mastersFixture, employeesFixture } =
      await setupForTest(ids, { dept: ids.DEPT_CODE, role: ids.GHOST_ROLE });

    await loginAndCompletePhases123(page, ids, tenantFixture, boundaryFixture, mastersFixture);
    await page.locator('input[type="file"]').first().setInputFiles(employeesFixture);

    await expect(page.getByText(new RegExp(`Role "${ids.GHOST_ROLE}" not valid`)).first())
      .toBeVisible({ timeout: 30_000 });
  });
});
