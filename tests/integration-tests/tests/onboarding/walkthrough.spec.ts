/**
 * Onboarding — full wizard walkthrough (master ticket #21, gap B).
 *
 * Drives the configurator's onboarding wizard end-to-end through the UI:
 *
 *   Login (Onboarding mode)
 *     → Phase 1 (tenant xlsx + branding skip)
 *     → Phase 2 (create hierarchy + boundary xlsx upload + verify + upload)
 *     → Phase 3 (common-masters xlsx with Departments/Designations/ComplaintType
 *                sheets + create)
 *     → Continue to Phase 4 (the Phase 4 + Complete page walk lands in a
 *       follow-up spec — employee xlsx requires reference data validation
 *       that warrants its own setup story).
 *
 * Per CLAUDE.md the body of the test is UI-only. The afterAll teardown
 * deactivates the freshly-created tenant via API because the configurator
 * has no UI delete affordance for tenants today (TenantList + TenantShow
 * only). Boundary hierarchies and masters created at the disposable child
 * tenant are left in place — soft-deleting the parent tenant logically
 * orphans them; a follow-up spec will cascade-delete via UI when the
 * configurator gains those affordances.
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

const TENANT_FIXTURE = path.join(os.tmpdir(), `tenant-${SUFFIX}.xlsx`);
const BOUNDARY_FIXTURE = path.join(os.tmpdir(), `boundary-${SUFFIX}.xlsx`);
const MASTERS_FIXTURE = path.join(os.tmpdir(), `masters-${SUFFIX}.xlsx`);

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
    tenantCode: TENANT_CODE,
    tenantName: TENANT_NAME,
    displayName: TENANT_NAME,
    tenantType: 'City',
    cityName: TENANT_NAME,
    districtName: 'Test District',
    latitude: 0.1,
    longitude: 0.1,
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
  sheet.addRow({
    code: BOUNDARY_ROOT,
    name: `Test Country ${SUFFIX}`,
    boundaryType: 'Country',
    parentCode: '',
    latitude: 0.1,
    longitude: 0.1,
  });
  sheet.addRow({
    code: BOUNDARY_CHILD,
    name: `Test City ${SUFFIX}`,
    boundaryType: 'City',
    parentCode: BOUNDARY_ROOT,
    latitude: 0.1,
    longitude: 0.1,
  });
  await wb.xlsx.writeFile(BOUNDARY_FIXTURE);
}

async function generateMastersFixture(): Promise<void> {
  const wb = new ExcelJS.Workbook();

  const dept = wb.addWorksheet('Departments');
  dept.columns = [
    { header: 'code', key: 'code' },
    { header: 'name', key: 'name' },
    { header: 'active', key: 'active' },
  ];
  dept.addRow({ code: DEPT_CODE, name: `Test Dept ${SUFFIX}`, active: true });

  const desig = wb.addWorksheet('Designations');
  desig.columns = [
    { header: 'code', key: 'code' },
    { header: 'name', key: 'name' },
    { header: 'description', key: 'description' },
    { header: 'department', key: 'department' },
    { header: 'active', key: 'active' },
  ];
  desig.addRow({
    code: DESIG_CODE,
    name: `Test Desig ${SUFFIX}`,
    description: 'PW',
    department: DEPT_CODE,
    active: true,
  });

  const complaint = wb.addWorksheet('ComplaintType');
  complaint.columns = [
    { header: 'serviceCode', key: 'serviceCode' },
    { header: 'name', key: 'name' },
    { header: 'keywords', key: 'keywords' },
    { header: 'department', key: 'department' },
    { header: 'slaHours', key: 'slaHours' },
    { header: 'active', key: 'active' },
  ];
  complaint.addRow({
    serviceCode: COMPLAINT_CODE,
    name: `Test Complaint ${SUFFIX}`,
    keywords: 'pw,test',
    department: DEPT_CODE,
    slaHours: 48,
    active: true,
  });

  await wb.xlsx.writeFile(MASTERS_FIXTURE);
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

test.describe('Onboarding — full walkthrough (Phases 1–3)', () => {
  test.beforeAll(async () => {
    await generateTenantFixture();
    await generateBoundaryFixture();
    await generateMastersFixture();
  });

  test.afterAll(async () => {
    [TENANT_FIXTURE, BOUNDARY_FIXTURE, MASTERS_FIXTURE].forEach((p) => fs.rmSync(p, { force: true }));
    await deactivateTenantViaApi(TENANT_CODE);
  });

  test('login → Phase 1 → Phase 2 → Phase 3 → ready for Phase 4', {
    annotation: {
      type: 'description',
      description: `End-to-end UI walk through the configurator's onboarding wizard for a brand-new tenant: login (Onboarding mode) → Phase 1 (tenant xlsx + skip branding) → Phase 2 (create hierarchy + upload boundary xlsx + verify + upload) → Phase 3 (common-masters xlsx with Departments/Designations/ComplaintType + Create All) → ready for Phase 4. Drives only the UI; the wizard's internal API calls are exercised through the actual buttons/file pickers, not API helpers.

Steps:
1. setTimeout 360s; generate three xlsx fixtures (tenant, boundary, masters) in beforeAll.
2. Open /configurator/login, fill ADMIN/eGov@123/ke, click Onboarding, click Sign In, wait for /configurator/phase/1.
3. Phase 1: click Start Setup → upload tenant xlsx → assert "File loaded:" + tenant code cell → click Upload to DIGIT → assert "Tenant Master Uploaded!" → on the branding step click Continue → assert "Phase 1 Complete!" → click Continue to Phase 2.
4. Phase 2: click "Option 1: Create New Hierarchy" → fill #hierarchyType → click Create Hierarchy → upload boundary xlsx → assert root + child boundary codes appear in cells → click "Upload N Boundaries" → click Continue to Phase 3.
5. Phase 3: click Start Setup → upload masters xlsx → assert seeded department code is visible → click Create All → assert "Phase 3 Complete!" within 120s → assert "Continue to Phase 4" button is visible.

Teardown is API-only because the configurator has no UI delete affordance for tenants — tracked in CCRS#21. Phase 4 (employee xlsx) is intentionally a separate spec because it needs jurisdiction+role validation setup. Test timeout is 360s because Phase 2 boundary uploads + Phase 3 Create All can each take 60–120s.`,
    },
    tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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

    // -------- Phase 1: Tenant + Branding --------
    await expect(page.getByText('Phase 1: Tenant & Branding Setup')).toBeVisible();
    await page.getByRole('button', { name: /Start Setup/i }).click();

    await expect(page.getByText('Step 1.1: Upload Tenant Master Excel')).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles(TENANT_FIXTURE);
    await expect(page.getByText(/File loaded:/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('cell', { name: TENANT_CODE })).toBeVisible();

    await page.getByRole('button', { name: /Upload to DIGIT/i }).click();

    // Branding step lands. Branding assets are optional — clicking
    // "Continue" advances to the Phase 1 complete banner without uploads.
    await expect(page.getByText('Tenant Master Uploaded!')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Step 1.2: Branding assets')).toBeVisible();
    await page.getByRole('button', { name: /^Continue$/ }).click();

    await expect(page.getByText('Phase 1 Complete!')).toBeVisible({ timeout: 30_000 });
    await Promise.all([
      page.waitForURL(/\/configurator\/phase\/2/, { timeout: 30_000 }),
      page.getByRole('button', { name: /Continue to Phase 2/i }).click(),
    ]);

    // -------- Phase 2: Boundary hierarchy + boundary data --------
    await expect(page.getByText('Phase 2: Boundary Setup')).toBeVisible();

    // Choose "Option 1: Create New Hierarchy" — the landing exposes two
    // cards (Create New / Use Existing). The card is a styled <button> so
    // role+name finds it.
    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.getByText('Create Boundary Hierarchy')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    await page.locator('#hierarchyType').fill(HIERARCHY_TYPE);
    // Default 2 levels (Country, City) are pre-populated. Submit.
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();

    // Template step — skip the download, go straight to the upload picker.
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });
    await page.locator('input[type="file"]').first().setInputFiles(BOUNDARY_FIXTURE);

    // Verify step shows the parsed boundary codes (each renders in both
    // the summary and the row table — `.first()` is intentional).
    await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('cell', { name: BOUNDARY_ROOT }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: BOUNDARY_CHILD }).first()).toBeVisible();
    await page.getByRole('button', { name: /Upload \d+ Boundaries/i }).click();

    // Phase 2 complete + jump to Phase 3.
    await Promise.all([
      page.waitForURL(/\/configurator\/phase\/3/, { timeout: 60_000 }),
      page.getByRole('button', { name: /Continue to Phase 3/i }).click(),
    ]);

    // -------- Phase 3: Common Masters --------
    await expect(page.getByText('Phase 3: Common Masters')).toBeVisible();
    await page.getByRole('button', { name: /Start Setup/i }).click();

    await expect(page.getByText('Step 3.1: Upload Common Master Excel')).toBeVisible();
    await page.locator('input[type="file"]').first().setInputFiles(MASTERS_FIXTURE);

    // Preview shows our seeded codes across Departments / Designations /
    // ComplaintType tabs.
    await expect(page.getByText(DEPT_CODE).first()).toBeVisible({ timeout: 30_000 });

    // Phase 3's preview submit is "Create All" (not "Upload to DIGIT").
    await page.getByRole('button', { name: /^Create All$/ }).click();

    // The "creating depts" + "creating complaints" loaders are transient;
    // assert on the final Phase 3 Complete banner so the test isn't flaky
    // on those intermediate states.
    await expect(page.getByText('Phase 3 Complete!')).toBeVisible({ timeout: 120_000 });

    // Ready for Phase 4 — that walk is its own spec (employee xlsx with
    // jurisdiction + role validation needs its own setup story).
    await expect(page.getByRole('button', { name: /Continue to Phase 4/i })).toBeVisible();
  });
});
