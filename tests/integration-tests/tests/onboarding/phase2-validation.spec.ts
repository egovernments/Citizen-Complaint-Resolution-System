/**
 * Onboarding — Phase 2 validation paths (master ticket #21, gap B —
 * enrichment #1 of the validation/error pass).
 *
 * Verifies the wizard's client-side rejection of bad Phase 2 inputs:
 *   1. Empty hierarchyType — handleCreateHierarchy refuses to fire,
 *      destructive Alert surfaces "Hierarchy type name is required".
 *   2. Boundary xlsx with a row whose parentCode references a code that
 *      isn't in the dataset — verify step lands but the row appears in
 *      the Errors tab with "Parent ... not found".
 *
 * Each test creates its own disposable child tenant via Phase 1 to avoid
 * MDMS phantom-200 collisions on the second test re-creating the same
 * code. Per CLAUDE.md the body is UI-only. Teardown deactivates each
 * tenant via API (carve-out: no UI delete affordance for tenants — #21).
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
    BOUNDARY_ORPHAN: `PWB2_${SUFFIX}`,
    PARENT_GHOST: `PWGHOST_${SUFFIX}`,
  };
}

async function writeTenantFixture(file: string, code: string, name: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Tenant Info');
  sheet.columns = [
    { header: 'tenantCode', key: 'tenantCode' }, { header: 'tenantName', key: 'tenantName' },
    { header: 'displayName', key: 'displayName' }, { header: 'tenantType', key: 'tenantType' },
    { header: 'cityName', key: 'cityName' }, { header: 'districtName', key: 'districtName' },
  ];
  sheet.addRow({
    tenantCode: code, tenantName: name, displayName: name,
    tenantType: 'City', cityName: name, districtName: 'Test District',
  });
  await wb.xlsx.writeFile(file);
}

async function writeBoundaryBadParentFixture(file: string, good: string, orphan: string, ghost: string, suffix: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Boundary');
  sheet.columns = [
    { header: 'code', key: 'code' }, { header: 'name', key: 'name' },
    { header: 'boundaryType', key: 'boundaryType' }, { header: 'parentCode', key: 'parentCode' },
  ];
  sheet.addRow({ code: good, name: `Test Country ${suffix}`, boundaryType: 'Country', parentCode: '' });
  // parentCode references a code that does NOT exist anywhere in the
  // dataset — validateBoundaries should flag this row as invalid.
  sheet.addRow({ code: orphan, name: `Orphan ${suffix}`, boundaryType: 'City', parentCode: ghost });
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

test.describe('Onboarding — Phase 2 validation', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('empty hierarchyType blocks "Create Hierarchy"', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshIds();
    const tenantFixture = path.join(os.tmpdir(), `tenant-p2v-${ids.SUFFIX}.xlsx`);
    await writeTenantFixture(tenantFixture, ids.TENANT_CODE, ids.TENANT_NAME);
    tempFiles.push(tenantFixture);
    createdTenants.push(ids.TENANT_CODE);

    await loginAndCompletePhase1(page, tenantFixture, ids.TENANT_CODE);

    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    // The form's React state initialises hierarchyType to 'ADMIN' (not
    // empty — see Phase2Page.tsx:50). Clear it explicitly to test the
    // empty-name guard.
    await page.locator('#hierarchyType').fill('');
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();

    await expect(page.getByText('Hierarchy type name is required').first()).toBeVisible({ timeout: 10_000 });
    // We must still be on the create-hierarchy step — never advanced
    // to template/upload/verify.
    await expect(page.getByText('Boundary Data Upload')).toHaveCount(0);
    await expect(page.locator('#hierarchyType')).toBeVisible();
  });

  test('boundary xlsx with a missing parentCode lands the row in the Errors tab', { tag: ['@area:onboarding', '@kind:validation', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshIds();
    const tenantFixture = path.join(os.tmpdir(), `tenant-p2v-${ids.SUFFIX}.xlsx`);
    const boundaryFixture = path.join(os.tmpdir(), `boundary-bad-parent-${ids.SUFFIX}.xlsx`);
    await writeTenantFixture(tenantFixture, ids.TENANT_CODE, ids.TENANT_NAME);
    await writeBoundaryBadParentFixture(boundaryFixture, ids.BOUNDARY_GOOD, ids.BOUNDARY_ORPHAN, ids.PARENT_GHOST, ids.SUFFIX);
    tempFiles.push(tenantFixture, boundaryFixture);
    createdTenants.push(ids.TENANT_CODE);

    await loginAndCompletePhase1(page, tenantFixture, ids.TENANT_CODE);

    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    await page.locator('#hierarchyType').fill(ids.HIERARCHY_TYPE);
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();

    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });
    await page.locator('input[type="file"]').first().setInputFiles(boundaryFixture);

    // Verify step lands. Tab counts: All=2, Valid=1, Errors=1.
    await expect(page.getByText('Verify Boundary Data')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /Errors\s*\(1\)/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Valid\s*\(1\)/ })).toBeVisible();

    // Click into the Errors tab and assert the row's parent-not-found
    // message renders with the ghost code.
    await page.getByRole('tab', { name: /Errors\s*\(1\)/ }).click();
    await expect(page.getByText(`Parent "${ids.PARENT_GHOST}" not found`).first()).toBeVisible({ timeout: 10_000 });
  });
});
