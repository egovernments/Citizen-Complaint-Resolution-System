/**
 * Onboarding — Phase 3 multi-row masters xlsx (master ticket #21,
 * enrichment #5 of the validation/error pass).
 *
 * Verifies the wizard handles a master xlsx with multiple rows per
 * sheet — 3 departments, 2 designations referencing them, 2 complaint
 * types — and the preview accurately reports the parsed counts before
 * the user submits "Create All".
 *
 * Per CLAUDE.md the body is UI-only. Teardown deactivates the tenant
 * via API (no UI delete affordance — tracked in #21).
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
async function writeMastersMultiRow(file: string, ids: Ids): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const dept = wb.addWorksheet('Departments');
  dept.columns = [{ header: 'code', key: 'code' }, { header: 'name', key: 'name' }, { header: 'active', key: 'active' }];
  for (let i = 1; i <= 3; i++) {
    dept.addRow({ code: `PWD${i}_${ids.SUFFIX}`, name: `Dept ${i} ${ids.SUFFIX}`, active: true });
  }
  const desig = wb.addWorksheet('Designations');
  desig.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'description', key: 'description' }, { header: 'department', key: 'department' },
    { header: 'active', key: 'active' },
  ];
  desig.addRow({ code: `PWS1_${ids.SUFFIX}`, name: `Desig 1 ${ids.SUFFIX}`, description: 'PW', department: `PWD1_${ids.SUFFIX}`, active: true });
  desig.addRow({ code: `PWS2_${ids.SUFFIX}`, name: `Desig 2 ${ids.SUFFIX}`, description: 'PW', department: `PWD2_${ids.SUFFIX}`, active: true });

  const complaint = wb.addWorksheet('ComplaintType');
  complaint.columns = [
    { header: 'serviceCode', key: 'serviceCode' }, { header: 'name', key: 'name' },
    { header: 'keywords', key: 'keywords' }, { header: 'department', key: 'department' },
    { header: 'slaHours', key: 'slaHours' }, { header: 'active', key: 'active' },
  ];
  complaint.addRow({ serviceCode: `PWC1_${ids.SUFFIX}`, name: `Complaint 1 ${ids.SUFFIX}`, keywords: 'pw', department: `PWD1_${ids.SUFFIX}`, slaHours: 48, active: true });
  complaint.addRow({ serviceCode: `PWC2_${ids.SUFFIX}`, name: `Complaint 2 ${ids.SUFFIX}`, keywords: 'pw', department: `PWD3_${ids.SUFFIX}`, slaHours: 72, active: true });

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

async function loginAndCompletePhases12(
  page: Page, ids: Ids, tenantFixture: string, boundaryFixture: string,
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
}

test.describe('Onboarding — Phase 3 multi-row masters', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('preview reports counts for 3 depts + 2 designations + 2 complaint types', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(240_000);
    const ids = freshIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = path.join(os.tmpdir(), `tenant-p3mr-${ids.SUFFIX}.xlsx`);
    const boundaryFixture = path.join(os.tmpdir(), `boundary-p3mr-${ids.SUFFIX}.xlsx`);
    const mastersFixture = path.join(os.tmpdir(), `masters-p3mr-${ids.SUFFIX}.xlsx`);
    await writeTenantFixture(tenantFixture, ids);
    await writeBoundaryFixture(boundaryFixture, ids);
    await writeMastersMultiRow(mastersFixture, ids);
    tempFiles.push(tenantFixture, boundaryFixture, mastersFixture);

    await loginAndCompletePhases12(page, ids, tenantFixture, boundaryFixture);

    await page.getByRole('button', { name: /Start Setup/i }).click();
    await expect(page.getByText('Step 3.1: Upload Common Master Excel')).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles(mastersFixture);

    // Preview summary line reads:
    //   "Summary: 3 departments • 2 designations • 2 complaint types"
    await expect(page.getByText(/3 departments/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/2 designations/).first()).toBeVisible();
    await expect(page.getByText(/2 complaint types/).first()).toBeVisible();

    // Submit and wait for the Phase 3 Complete banner.
    await page.getByRole('button', { name: /^Create All$/ }).click();
    await expect(page.getByText('Phase 3 Complete!')).toBeVisible({ timeout: 120_000 });
  });
});
