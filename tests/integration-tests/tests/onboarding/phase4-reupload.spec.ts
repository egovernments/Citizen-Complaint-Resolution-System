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

async function writeEmployeesFixture(file: string, ids: Ids, dept: string): Promise<void> {
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
    employeeCode: `PWE_${ids.SUFFIX}`, name: `PW Employee ${ids.SUFFIX}`,
    mobileNumber: ids.EMPLOYEE_MOBILE, dob: '1990-01-01',
    department: dept, designation: ids.DESIG_CODE,
    roles: 'EMPLOYEE', jurisdictions: ids.BOUNDARY_ROOT, dateOfAppointment: '2024-01-01',
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
    const ids = freshIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = path.join(os.tmpdir(), `tenant-p4re-${ids.SUFFIX}.xlsx`);
    const boundaryFixture = path.join(os.tmpdir(), `boundary-p4re-${ids.SUFFIX}.xlsx`);
    const mastersFixture = path.join(os.tmpdir(), `masters-p4re-${ids.SUFFIX}.xlsx`);
    const badFixture = path.join(os.tmpdir(), `employees-bad-${ids.SUFFIX}.xlsx`);
    const goodFixture = path.join(os.tmpdir(), `employees-good-${ids.SUFFIX}.xlsx`);
    await writeTenantFixture(tenantFixture, ids);
    await writeBoundaryFixture(boundaryFixture, ids);
    await writeMastersFixture(mastersFixture, ids);
    await writeEmployeesFixture(badFixture, ids, ids.GHOST_DEPT);
    await writeEmployeesFixture(goodFixture, ids, ids.DEPT_CODE);
    tempFiles.push(tenantFixture, boundaryFixture, mastersFixture, badFixture, goodFixture);

    await loginAndCompletePhases123(page, ids, tenantFixture, boundaryFixture, mastersFixture);

    // First upload: bad department → preview shows row error + disabled
    // Create button.
    await page.locator('#employee-file-upload').setInputFiles(badFixture);
    await expect(page.getByText(new RegExp(`Department "${ids.GHOST_DEPT}" not found`)).first())
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
