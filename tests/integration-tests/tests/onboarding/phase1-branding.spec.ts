/**
 * Onboarding — Phase 1 branding asset upload (master ticket #21,
 * enrichment #4 of the validation/error pass).
 *
 * Verifies the Phase 1 'branding' step's per-row file input flow:
 *   1. Walk Phase 1 to the branding step.
 *   2. Upload a 1×1 PNG via the first row's file input (Header logo).
 *   3. Assert the row flips from "Not uploaded" to "Uploaded ✓ (filestore
 *      id: ...)".
 *   4. Continue to the Phase 1 Complete banner (proves the wizard
 *      accepts the populated branding state and advances).
 *
 * The configurator's filestore upload returns a real filestore id; we
 * don't need to clean it up because it's anchored to the test tenant
 * which afterAll deactivates. Per CLAUDE.md the body is UI-only.
 * Teardown deactivates the tenant via API (no UI delete affordance —
 * tracked in #21).
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

// 1×1 transparent PNG — minimal valid image-typed payload.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
  'base64',
);

const createdTenants: string[] = [];
const tempFiles: string[] = [];

function freshIds() {
  const SUFFIX = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  return {
    SUFFIX,
    TENANT_CODE: `${ROOT}.pwt${SUFFIX}`,
    TENANT_NAME: `Playwright Test ${SUFFIX}`,
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

async function loginAndAdvanceToBranding(page: Page, tenantFixture: string, tenantCode: string): Promise<void> {
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
}

test.describe('Onboarding — Phase 1 branding upload', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('uploading a PNG to the first branding row flips it to "Uploaded ✓"', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = path.join(os.tmpdir(), `tenant-p1br-${ids.SUFFIX}.xlsx`);
    const pngFixture = path.join(os.tmpdir(), `logo-${ids.SUFFIX}.png`);
    await writeTenantFixture(tenantFixture, ids);
    fs.writeFileSync(pngFixture, PNG_1x1);
    tempFiles.push(tenantFixture, pngFixture);

    await loginAndAdvanceToBranding(page, tenantFixture, ids.TENANT_CODE);

    // Branding step lists 4 rows in order: Header logo, Header logo
    // dark mode, Citizen banner, State emblem. Each carries an
    // <input type="file" accept="image/*"> inside its row. Picking
    // the first file input that filters on image/* targets the
    // Header logo row.
    const brandingInputs = page.locator('input[type="file"][accept="image/*"]');
    await expect(brandingInputs.first()).toHaveCount(1, { timeout: 5_000 }).catch(() => {});
    await brandingInputs.first().setInputFiles(pngFixture);

    // After successful filestore upload the row's status text flips.
    await expect(page.getByText(/Uploaded ✓/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/filestore id:/).first()).toBeVisible();

    // Continue advances the wizard to Phase 1 Complete.
    await page.getByRole('button', { name: /^Continue$/ }).click();
    await expect(page.getByText('Phase 1 Complete!')).toBeVisible({ timeout: 30_000 });
  });
});
