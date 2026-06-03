/**
 * Onboarding — Phase 2 Option 2: Use Existing Hierarchy (master ticket
 * #21, enrichment #3 of the validation/error pass).
 *
 * Verifies the "Use Existing Hierarchy" path:
 *   1. Walk Phase 1 + Phase 2 Option 1 to create a hierarchy via the
 *      wizard (this leaves the wizard at the 'template' step with the
 *      hierarchy selected).
 *   2. Click ← Back to return to the Phase 2 landing.
 *   3. Click "Option 2: Use Existing Hierarchy" — the list reads from
 *      `boundaryService.getHierarchies(targetTenant)` so our freshly-
 *      created hierarchy must appear.
 *   4. Select it and click "Use Selected Hierarchy" — wizard advances
 *      to the same template step Option 1 lands at.
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

test.describe('Onboarding — Phase 2 Option 2: Use Existing Hierarchy', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('hierarchy created via Option 1 is selectable via Option 2', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = path.join(os.tmpdir(), `tenant-p2opt2-${ids.SUFFIX}.xlsx`);
    await writeTenantFixture(tenantFixture, ids);
    tempFiles.push(tenantFixture);

    await loginAndCompletePhase1(page, tenantFixture, ids.TENANT_CODE);

    // Option 1 path: create the hierarchy.
    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    await page.locator('#hierarchyType').fill(ids.HIERARCHY_TYPE);
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });

    // Back to Phase 2 landing.
    await page.getByRole('button', { name: /^← Back$/ }).click();
    await expect(page.getByText('Choose Your Path')).toBeVisible({ timeout: 15_000 });

    // Option 2 path.
    await page.getByRole('button', { name: /Option 2: Use Existing Hierarchy/i }).click();
    await expect(page.getByRole('heading', { name: /Select Existing Hierarchy/i })).toBeVisible({ timeout: 15_000 });

    // The list reads from boundaryService.getHierarchies(targetTenant).
    // Our freshly-created hierarchy should appear by name.
    const hierarchyCard = page.getByRole('button').filter({ hasText: ids.HIERARCHY_TYPE }).first();
    await expect(hierarchyCard).toBeVisible({ timeout: 15_000 });
    await hierarchyCard.click();

    // Use Selected Hierarchy → advance to the template step.
    await page.getByRole('button', { name: /Use Selected Hierarchy/i }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 30_000 });
  });
});
