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
 * the spec walks Phase 1 + 2 + 3 first to seed those records into the
 * freshly-created child tenant. A future end-to-end spec under #21 will
 * subsume both this and walkthrough.spec.ts.
 *
 * Per CLAUDE.md the body of the test is UI-only. The afterAll teardown
 * deactivates the freshly-created tenant via API because the configurator
 * has no UI delete affordance for tenants today.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { getDigitToken } from '../utils/auth';

test.use({ storageState: { cookies: [], origins: [] } });

const SUFFIX = Date.now().toString().slice(-8);
const ROOT = process.env.ROOT_TENANT || 'ke';
const TENANT_CODE = `${ROOT}.pwt${SUFFIX}`;
const TENANT_NAME = `Playwright Test ${SUFFIX}`;
const HIERARCHY_TYPE = `PWHIER${SUFFIX}`;
const BOUNDARY_ROOT = `PWB1_${SUFFIX}`;
const BOUNDARY_CHILD = `PWB2_${SUFFIX}`;
const DEPT_CODE = `PWD_${SUFFIX}`;
const DESIG_CODE = `PWS_${SUFFIX}`;
const COMPLAINT_CODE = `PWC_${SUFFIX}`;
const EMPLOYEE_CODE = `PWE_${SUFFIX}`;
// Kenya mobile pattern from MEMORY.md: ^0?[17][0-9]{8}$ — start with 7,
// 9 digits is a safe MDMS-rule baseline.
const EMPLOYEE_MOBILE = `7${SUFFIX}`.slice(0, 9);

const TENANT_FIXTURE = path.join(os.tmpdir(), `tenant-p4-${SUFFIX}.xlsx`);
const BOUNDARY_FIXTURE = path.join(os.tmpdir(), `boundary-p4-${SUFFIX}.xlsx`);
const MASTERS_FIXTURE = path.join(os.tmpdir(), `masters-p4-${SUFFIX}.xlsx`);
const EMPLOYEES_FIXTURE = path.join(os.tmpdir(), `employees-p4-${SUFFIX}.xlsx`);

const ADMIN_USER = process.env.ADMIN_USER || 'ADMIN';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'eGov@123';
const BASE_URL = process.env.BASE_URL || 'https://naipepea.digit.org';

async function generateTenantFixture(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Tenant Info');
  sheet.columns = [
    { header: 'tenantCode', key: 'tenantCode' },
    { header: 'tenantName', key: 'tenantName' },
    { header: 'displayName', key: 'displayName' },
    { header: 'tenantType', key: 'tenantType' },
    { header: 'cityName', key: 'cityName' },
    { header: 'districtName', key: 'districtName' },
    { header: 'latitude', key: 'latitude' },
    { header: 'longitude', key: 'longitude' },
  ];
  sheet.addRow({
    tenantCode: TENANT_CODE, tenantName: TENANT_NAME, displayName: TENANT_NAME,
    tenantType: 'City', cityName: TENANT_NAME, districtName: 'Test District',
    latitude: 0.1, longitude: 0.1,
  });
  await wb.xlsx.writeFile(TENANT_FIXTURE);
}

async function generateBoundaryFixture(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Boundary');
  sheet.columns = [
    { header: 'code', key: 'code' },
    { header: 'name', key: 'name' },
    { header: 'boundaryType', key: 'boundaryType' },
    { header: 'parentCode', key: 'parentCode' },
    { header: 'latitude', key: 'latitude' },
    { header: 'longitude', key: 'longitude' },
  ];
  sheet.addRow({ code: BOUNDARY_ROOT, name: `Test Country ${SUFFIX}`, boundaryType: 'Country', parentCode: '', latitude: 0.1, longitude: 0.1 });
  sheet.addRow({ code: BOUNDARY_CHILD, name: `Test City ${SUFFIX}`, boundaryType: 'City', parentCode: BOUNDARY_ROOT, latitude: 0.1, longitude: 0.1 });
  await wb.xlsx.writeFile(BOUNDARY_FIXTURE);
}

async function generateMastersFixture(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const dept = wb.addWorksheet('Departments');
  dept.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' }, { header: 'active', key: 'active' },
  ];
  dept.addRow({ code: DEPT_CODE, name: `Test Dept ${SUFFIX}`, active: true });

  const desig = wb.addWorksheet('Designations');
  desig.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'description', key: 'description' }, { header: 'department', key: 'department' },
    { header: 'active', key: 'active' },
  ];
  desig.addRow({ code: DESIG_CODE, name: `Test Desig ${SUFFIX}`, description: 'PW', department: DEPT_CODE, active: true });

  const complaint = wb.addWorksheet('ComplaintType');
  complaint.columns = [
    { header: 'serviceCode', key: 'serviceCode' }, { header: 'name', key: 'name' },
    { header: 'keywords', key: 'keywords' }, { header: 'department', key: 'department' },
    { header: 'slaHours', key: 'slaHours' }, { header: 'active', key: 'active' },
  ];
  complaint.addRow({ serviceCode: COMPLAINT_CODE, name: `Test Complaint ${SUFFIX}`, keywords: 'pw,test', department: DEPT_CODE, slaHours: 48, active: true });

  await wb.xlsx.writeFile(MASTERS_FIXTURE);
}

async function generateEmployeesFixture(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Employee');
  sheet.columns = [
    { header: 'employeeCode', key: 'employeeCode' },
    { header: 'name', key: 'name' },
    { header: 'mobileNumber', key: 'mobileNumber' },
    { header: 'dob', key: 'dob' },
    { header: 'department', key: 'department' },
    { header: 'designation', key: 'designation' },
    { header: 'roles', key: 'roles' },
    { header: 'jurisdictions', key: 'jurisdictions' },
    { header: 'dateOfAppointment', key: 'dateOfAppointment' },
  ];
  sheet.addRow({
    employeeCode: EMPLOYEE_CODE,
    name: `PW Employee ${SUFFIX}`,
    mobileNumber: EMPLOYEE_MOBILE,
    dob: '1990-01-01',
    department: DEPT_CODE,
    designation: DESIG_CODE,
    // EMPLOYEE is the universal baseline role seeded under
    // ACCESSCONTROL-ROLES at the root tenant; safer than PGR-specific
    // roles which may not exist on every deployment.
    roles: 'EMPLOYEE',
    jurisdictions: BOUNDARY_ROOT,
    dateOfAppointment: '2024-01-01',
  });
  await wb.xlsx.writeFile(EMPLOYEES_FIXTURE);
}

async function deactivateTenantViaApi(code: string): Promise<void> {
  // NOTE: API teardown — no UI delete affordance for tenants in the
  // configurator (TenantList + TenantShow only). Track in #21.
  const token = await getDigitToken({ tenant: ROOT, username: ADMIN_USER, password: ADMIN_PASS });
  const ri = {
    apiId: 'Rainmaker',
    ver: '1.0',
    ts: Date.now(),
    msgId: `${Date.now()}|en_IN`,
    authToken: token.access_token,
  };
  const searchResp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: ri,
      MdmsCriteria: { tenantId: ROOT, schemaCode: 'tenant.tenants', uniqueIdentifiers: [code] },
    }),
  });
  if (!searchResp.ok) return;
  const record = ((await searchResp.json()) as { mdms?: Array<Record<string, unknown>> }).mdms?.[0];
  if (!record) return;
  await fetch(`${BASE_URL}/mdms-v2/v2/_update/tenant.tenants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: ri, Mdms: { ...record, isActive: false } }),
  });
}

test.describe('Onboarding — Phase 4: Employee Onboarding', () => {
  test.beforeAll(async () => {
    await generateTenantFixture();
    await generateBoundaryFixture();
    await generateMastersFixture();
    await generateEmployeesFixture();
  });

  test.afterAll(async () => {
    [TENANT_FIXTURE, BOUNDARY_FIXTURE, MASTERS_FIXTURE, EMPLOYEES_FIXTURE]
      .forEach((p) => fs.rmSync(p, { force: true }));
    await deactivateTenantViaApi(TENANT_CODE);
  });

  test('Phase 1 → 2 → 3 setup, then Phase 4 employee xlsx → confirm → success', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(360_000);

    // -------- Login (Onboarding mode) --------
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

    // -------- Phase 1 (tenant + branding skip) --------
    await page.getByRole('button', { name: /Start Setup/i }).click();
    await page.locator('input[type="file"]').first().setInputFiles(TENANT_FIXTURE);
    await expect(page.getByRole('cell', { name: TENANT_CODE })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Upload to DIGIT/i }).click();
    await expect(page.getByText('Step 1.2: Branding assets')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /^Continue$/ }).click();
    await expect(page.getByText('Phase 1 Complete!')).toBeVisible({ timeout: 30_000 });
    await Promise.all([
      page.waitForURL(/\/configurator\/phase\/2/, { timeout: 30_000 }),
      page.getByRole('button', { name: /Continue to Phase 2/i }).click(),
    ]);

    // -------- Phase 2 (hierarchy + boundaries) --------
    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    await page.locator('#hierarchyType').fill(HIERARCHY_TYPE);
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });
    await page.locator('input[type="file"]').first().setInputFiles(BOUNDARY_FIXTURE);
    await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Upload \d+ Boundaries/i }).click();
    await expect(page.getByText('Boundaries Created Successfully!')).toBeVisible({ timeout: 60_000 });
    await Promise.all([
      page.waitForURL(/\/configurator\/phase\/3/, { timeout: 30_000 }),
      page.getByRole('button', { name: /Continue to Phase 3/i }).click(),
    ]);

    // -------- Phase 3 (depts + designations + complaint types) --------
    await page.getByRole('button', { name: /Start Setup/i }).click();
    await expect(page.getByText('Step 3.1: Upload Common Master Excel')).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles(MASTERS_FIXTURE);
    await expect(page.getByText(DEPT_CODE).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Create All$/ }).click();
    await expect(page.getByText('Phase 3 Complete!')).toBeVisible({ timeout: 120_000 });
    await Promise.all([
      page.waitForURL(/\/configurator\/phase\/4/, { timeout: 30_000 }),
      page.getByRole('button', { name: /Continue to Phase 4/i }).click(),
    ]);

    // -------- Phase 4: the test target --------
    await expect(page.getByText('Phase 4: Employee Onboarding')).toBeVisible();

    // Reference-data fetch happens on mount; the "Start Phase 4" button
    // is disabled while loadingRefs is true. Wait until the wizard is
    // ready before clicking.
    const startBtn = page.getByRole('button', { name: /Start Phase 4/i });
    await expect(startBtn).toBeEnabled({ timeout: 30_000 });
    await startBtn.click();

    await expect(page.getByText('Step 4.1: Generate Employee Template')).toBeVisible({ timeout: 30_000 });
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
