/**
 * Onboarding — Phase 3 validation paths (master ticket #21, gap B —
 * enrichment #1 of the validation/error pass).
 *
 * Phase 3 is more lenient than Phase 1/2: the wizard accepts any xlsx
 * that yields at least one parseable Department, Designation, OR
 * ComplaintType row, and only surfaces a top-level error when all three
 * sheets fail to yield any rows. This spec covers that case so the
 * "Phase 3 silently advanced on garbage input" regression is caught.
 *
 * Setup walks Phase 1 + Phase 2 so the wizard has the prerequisites it
 * needs to even render Phase 3. Per CLAUDE.md the body is UI-only.
 * Teardown deactivates the freshly-created tenant via API (carve-out:
 * no UI delete affordance for tenants — tracked in #21).
 */
import { test, expect, type Page } from '@playwright/test';
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

const TENANT_FIXTURE = path.join(os.tmpdir(), `tenant-p3v-${SUFFIX}.xlsx`);
const BOUNDARY_FIXTURE = path.join(os.tmpdir(), `boundary-p3v-${SUFFIX}.xlsx`);
const MASTERS_NO_RECOGNIZED_SHEETS = path.join(os.tmpdir(), `masters-empty-p3v-${SUFFIX}.xlsx`);

const ADMIN_USER = process.env.ADMIN_USER || 'ADMIN';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'eGov@123';
const BASE_URL = process.env.BASE_URL || 'https://naipepea.digit.org';

async function generateTenantFixture(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Tenant Info');
  sheet.columns = [
    { header: 'tenantCode', key: 'tenantCode' }, { header: 'tenantName', key: 'tenantName' },
    { header: 'displayName', key: 'displayName' }, { header: 'tenantType', key: 'tenantType' },
    { header: 'cityName', key: 'cityName' }, { header: 'districtName', key: 'districtName' },
  ];
  sheet.addRow({
    tenantCode: TENANT_CODE, tenantName: TENANT_NAME, displayName: TENANT_NAME,
    tenantType: 'City', cityName: TENANT_NAME, districtName: 'Test District',
  });
  await wb.xlsx.writeFile(TENANT_FIXTURE);
}

async function generateBoundaryFixture(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Boundary');
  sheet.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'boundaryType', key: 'boundaryType' }, { header: 'parentCode', key: 'parentCode' },
  ];
  sheet.addRow({ code: BOUNDARY_ROOT, name: `Country ${SUFFIX}`, boundaryType: 'Country', parentCode: '' });
  sheet.addRow({ code: BOUNDARY_CHILD, name: `City ${SUFFIX}`, boundaryType: 'City', parentCode: BOUNDARY_ROOT });
  await wb.xlsx.writeFile(BOUNDARY_FIXTURE);
}

async function generateMastersWithNoRecognizedSheets(): Promise<void> {
  // The parsers under src/utils/excelParser.ts look for sheet names
  // 'Department(s)', 'Designation(s)', 'ComplaintType(s)' / 'ServiceDefs'.
  // A workbook with only an unrecognized sheet name yields zero rows
  // from each parser, which trips the wizard's "no valid data" branch.
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('SomeOtherSheet');
  sheet.columns = [{ header: 'col1', key: 'col1' }, { header: 'col2', key: 'col2' }];
  sheet.addRow({ col1: 'irrelevant', col2: 'data' });
  await wb.xlsx.writeFile(MASTERS_NO_RECOGNIZED_SHEETS);
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

async function loginAndCompletePhases1And2(page: Page): Promise<void> {
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

  // Phase 2
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
}

test.describe('Onboarding — Phase 3 validation', () => {
  test.beforeAll(async () => {
    await generateTenantFixture();
    await generateBoundaryFixture();
    await generateMastersWithNoRecognizedSheets();
  });

  test.afterAll(async () => {
    [TENANT_FIXTURE, BOUNDARY_FIXTURE, MASTERS_NO_RECOGNIZED_SHEETS].forEach((p) => fs.rmSync(p, { force: true }));
    await deactivateTenantViaApi(TENANT_CODE);
  });

  test('xlsx with no recognized master sheets is rejected before preview', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    await loginAndCompletePhases1And2(page);

    await expect(page.getByText('Phase 3: Common Masters')).toBeVisible();
    await page.getByRole('button', { name: /Start Setup/i }).click();
    await expect(page.getByText('Step 3.1: Upload Common Master Excel')).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(MASTERS_NO_RECOGNIZED_SHEETS);

    // The wizard should surface the "no valid data" error and remain on
    // Step 3.1 — never advance to the preview step.
    await expect(page.getByText('No valid data found in Excel file. Please check the format.').first())
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Step 3.1: Upload Common Master Excel')).toBeVisible();
    // No "Create All" submit button should be on screen until preview lands.
    await expect(page.getByRole('button', { name: /^Create All$/ })).toHaveCount(0);
  });
});
