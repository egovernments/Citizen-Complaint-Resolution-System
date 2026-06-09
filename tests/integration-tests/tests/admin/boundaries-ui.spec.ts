/**
 * Manage — boundaries list, UI-only (master ticket #21, gap D).
 *
 * Asserts that boundaries created through the onboarding wizard are
 * visible in `/configurator/manage/boundaries` when the operator switches
 * to Management mode via the header button. The subject under test is
 * the manage surface, not the wizard — the wizard is just the realistic
 * way an operator gets data into the system per CLAUDE.md's "drive the
 * UI like a real user" rule.
 *
 * Flow: login Onboarding → Phase 1 (tenant create) → Phase 2 (hierarchy
 * + boundary upload) → click `Management` in the header → land on
 * `/manage/boundaries` → search for our PW-prefixed codes → assert both
 * rows render.
 *
 * Known failure on Nairobi (2026-05-07): the BoundaryList resource fires
 * `boundary-relationships/_search` and `boundary-hierarchy-definition/_search`
 * scoped to the session tenant (root `ke`), not the wizard's
 * `targetTenant` (the freshly-created child). Boundaries created at the
 * child tenant therefore never appear in the admin list. Tracked under
 * #21 — fix is either a tenant picker in Manage mode or BoundaryList
 * reading `state.targetTenant` when present. The spec is intentionally
 * left asserting the post-fix behavior so it stays red until the manage
 * UI is corrected.
 *
 * Per CLAUDE.md the body of the test is UI-only. The afterAll teardown
 * deactivates the freshly-created tenant via API because the configurator
 * has no UI delete affordance for tenants today (tracked in #21).
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { getDigitToken } from '../utils/auth';
import { ROOT_TENANT as ROOT, ADMIN_USER, ADMIN_PASS, BASE_URL } from '../utils/env';

test.use({ storageState: { cookies: [], origins: [] } });

const SUFFIX = Date.now().toString().slice(-8);
const TENANT_CODE = `${ROOT}.pwt${SUFFIX}`;
const TENANT_NAME = `Playwright Test ${SUFFIX}`;
const HIERARCHY_TYPE = `PWHIER${SUFFIX}`;
const BOUNDARY_ROOT = `PWB1_${SUFFIX}`;
const BOUNDARY_CHILD = `PWB2_${SUFFIX}`;

const TENANT_FIXTURE = path.join(os.tmpdir(), `tenant-end-${SUFFIX}.xlsx`);
const BOUNDARY_FIXTURE = path.join(os.tmpdir(), `boundary-end-${SUFFIX}.xlsx`);

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

test.describe('manage/boundaries — list reflects boundaries created via wizard', () => {
  test.beforeAll(async () => {
    await generateTenantFixture();
    await generateBoundaryFixture();
  });

  test.afterAll(async () => {
    [TENANT_FIXTURE, BOUNDARY_FIXTURE].forEach((p) => fs.rmSync(p, { force: true }));
    await deactivateTenantViaApi(TENANT_CODE);
  });

  test('search returns both PW-prefixed boundaries created through onboarding', {
    annotation: {
      type: 'description',
      description: `End-to-end check that the Manage > Boundaries list reflects boundaries created through the onboarding wizard. Drives a full Phase 1 (tenant) + Phase 2 (hierarchy + boundary upload) walk to ensure the assertion runs against real wizard-created data, then switches to Management mode and asserts both PW-prefixed rows appear in the list.

Steps:
1. setTimeout 180s; generate tenant + boundary xlsx fixtures in beforeAll.
2. Login (Onboarding mode): fill ADMIN/eGov@123/ke; click Onboarding then Sign In; wait for /phase/1.
3. Phase 1: Start Setup → upload tenant xlsx → assert tenant code cell → Upload to DIGIT → branding step → Continue → assert "Phase 1 Complete!" → Continue to Phase 2.
4. Phase 2: "Option 1: Create New Hierarchy" → fill hierarchyType → Create Hierarchy → upload boundary xlsx → "Upload N Boundaries" → assert "Boundaries Created Successfully!".
5. Click the header "Management" button; wait for /configurator/manage URL.
6. Navigate to /manage/boundaries; assert "Boundaries" heading is visible within 30s.
7. If a search input exists: fill BOUNDARY_ROOT, wait networkidle, assert matching row visible within 30s; clear and fill BOUNDARY_CHILD, assert matching row visible.

KNOWN FAILURE on Nairobi (2026-05-07): BoundaryList queries the session tenant (root 'ke') instead of the wizard's targetTenant. Boundaries created at the child tenant don't appear here. The test is intentionally left red until the manage UI reads state.targetTenant. Teardown is API-only because the configurator has no UI delete affordance for tenants — tracked in CCRS#21.`,
    },
    tag: ['@area:manage-boundaries', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);

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

    // -------- Phase 1: tenant --------
    await expect(page.getByText('Phase 1: Tenant & Branding Setup')).toBeVisible();
    await page.getByRole('button', { name: /Start Setup/i }).click();
    await expect(page.getByText('Step 1.1: Upload Tenant Master Excel')).toBeVisible();
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

    // -------- Phase 2: hierarchy + boundaries --------
    await expect(page.getByText('Phase 2: Boundary Setup')).toBeVisible();
    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    await page.locator('#hierarchyType').fill(HIERARCHY_TYPE);
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });
    await page.locator('input[type="file"]').first().setInputFiles(BOUNDARY_FIXTURE);
    await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Upload \d+ Boundaries/i }).click();
    await expect(page.getByText('Boundaries Created Successfully!')).toBeVisible({ timeout: 60_000 });

    // -------- Switch to Management via the header button --------
    // The Layout header carries a "Management" button that flips
    // state.mode and routes to /manage. We use that path because it's
    // exactly the one a real operator follows after onboarding.
    await Promise.all([
      page.waitForURL(/\/configurator\/manage/, { timeout: 30_000 }),
      page.getByRole('button', { name: /^Management$/ }).click(),
    ]);

    // -------- Manage > Boundaries: assert both rows present --------
    // The configurator's BoundaryList does not paginate-on-search by
    // default — it lists every boundary visible at the session tenant.
    // Filtering by code via the search box scopes the list; if the UI
    // changes, the assertions still scope to our unique PW codes.
    await page.goto('/configurator/manage/boundaries');
    await expect(page.getByRole('heading', { name: /Boundaries/i })).toBeVisible({ timeout: 30_000 });

    const search = page.getByPlaceholder(/search/i).first();
    if (await search.count()) {
      await search.fill(BOUNDARY_ROOT);
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    await expect(
      page.getByRole('row').filter({ hasText: BOUNDARY_ROOT }).first(),
    ).toBeVisible({ timeout: 30_000 });

    if (await search.count()) {
      await search.fill('');
      await search.fill(BOUNDARY_CHILD);
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    await expect(
      page.getByRole('row').filter({ hasText: BOUNDARY_CHILD }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
