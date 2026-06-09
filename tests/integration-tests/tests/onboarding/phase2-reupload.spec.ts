/**
 * Onboarding — Phase 2 re-upload recovery (master ticket #21,
 * enrichment #2 of the validation/error pass).
 *
 * Verifies the realistic recovery path after a bad boundary xlsx:
 * upload bad xlsx → verify step shows errors → click "← Back" to the
 * template step → upload a valid xlsx → verify step lands with all
 * valid rows → submit.
 *
 * Note: the "Re-upload Fixed File" button on the verify step appears
 * non-functional today (it clicks `document.getElementById('boundary-
 * file-upload')` but that input only exists in the 'template' step's
 * conditional render block, not in 'verify'). This spec exercises the
 * Back-button recovery path instead — the user-visible workaround.
 * Track the broken Re-upload button separately.
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
    BOUNDARY_GOOD: `PWB1_${SUFFIX}`,
    BOUNDARY_CHILD: `PWB2_${SUFFIX}`,
    PARENT_GHOST: `PWGHOST_${SUFFIX}`,
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

async function writeBadBoundaryFixture(file: string, ids: Ids): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Boundary');
  sheet.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'boundaryType', key: 'boundaryType' }, { header: 'parentCode', key: 'parentCode' },
  ];
  sheet.addRow({ code: ids.BOUNDARY_GOOD, name: `Country ${ids.SUFFIX}`, boundaryType: 'Country', parentCode: '' });
  sheet.addRow({ code: ids.BOUNDARY_CHILD, name: `Orphan ${ids.SUFFIX}`, boundaryType: 'City', parentCode: ids.PARENT_GHOST });
  await wb.xlsx.writeFile(file);
}

async function writeGoodBoundaryFixture(file: string, ids: Ids): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Boundary');
  sheet.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'boundaryType', key: 'boundaryType' }, { header: 'parentCode', key: 'parentCode' },
  ];
  sheet.addRow({ code: ids.BOUNDARY_GOOD, name: `Country ${ids.SUFFIX}`, boundaryType: 'Country', parentCode: '' });
  sheet.addRow({ code: ids.BOUNDARY_CHILD, name: `City ${ids.SUFFIX}`, boundaryType: 'City', parentCode: ids.BOUNDARY_GOOD });
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

async function loginAndCompletePhase1(page: Page, tenantFixture: string, tenantCode: string): Promise<void> {
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
  await expect(page.getByRole('cell', { name: tenantCode })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Upload to DIGIT/i }).click();
  await expect(page.getByText('Step 1.2: Branding assets')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /^Continue$/ }).click();
  await expect(page.getByText('Phase 1 Complete!')).toBeVisible({ timeout: 30_000 });
  await Promise.all([
    page.waitForURL(/\/configurator\/phase\/2/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Continue to Phase 2/i }).click(),
  ]);
}

test.describe('Onboarding — Phase 2 re-upload after bad boundaries', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('Back from verify → re-upload valid xlsx → all valid', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(240_000);
    const ids = freshIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = path.join(os.tmpdir(), `tenant-p2re-${ids.SUFFIX}.xlsx`);
    const badFixture = path.join(os.tmpdir(), `boundary-bad-${ids.SUFFIX}.xlsx`);
    const goodFixture = path.join(os.tmpdir(), `boundary-good-${ids.SUFFIX}.xlsx`);
    await writeTenantFixture(tenantFixture, ids);
    await writeBadBoundaryFixture(badFixture, ids);
    await writeGoodBoundaryFixture(goodFixture, ids);
    tempFiles.push(tenantFixture, badFixture, goodFixture);

    await loginAndCompletePhase1(page, tenantFixture, ids.TENANT_CODE);

    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    await page.locator('#hierarchyType').fill(ids.HIERARCHY_TYPE);
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });

    // First upload: bad xlsx → verify with 1 error.
    await page.locator('#boundary-file-upload').setInputFiles(badFixture);
    await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /Errors\s*\(1\)/ })).toBeVisible();

    // Recovery: click ← Back to return to the template step where the
    // file input is rendered, then upload the valid xlsx.
    await page.getByRole('button', { name: /^← Back$/ }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 15_000 });
    await page.locator('#boundary-file-upload').setInputFiles(goodFixture);

    // Verify lands again with all rows valid.
    await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /Valid\s*\(2\)/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Errors\s*\(0\)/ })).toBeVisible();

    // Submit and assert Phase 2 completes.
    await page.getByRole('button', { name: /Upload \d+ Boundaries/i }).click();
    await expect(page.getByText('Boundaries Created Successfully!')).toBeVisible({ timeout: 60_000 });
  });
});
