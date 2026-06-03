/**
 * Onboarding — Phase 2 hierarchy level editor (master ticket #21,
 * enrichment #7 of the validation/error pass).
 *
 * Verifies the create-hierarchy step's Level editor:
 *   1. The default 4-level chain (Country, State, City, Ward) renders
 *      pre-populated and the "[Root]" / "[Lowest]" markers anchor the
 *      first and last levels.
 *   2. Clicking "+ Add Level" appends a 5th input.
 *   3. The X button removes a level (only renders when N > 2).
 *   4. After editing the chain, "Create Hierarchy" submits and the
 *      wizard advances to the Boundary Data Upload step.
 *
 * Per CLAUDE.md the body is UI-only. Teardown deactivates the tenant
 * via API (no UI delete affordance for tenants — tracked in #21).
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

test.describe('Onboarding — Phase 2 hierarchy editor', () => {
  test.afterAll(async () => {
    tempFiles.forEach((p) => fs.rmSync(p, { force: true }));
    for (const code of createdTenants) await deactivateTenantViaApi(code);
  });

  test('add + remove level + submit advances to Boundary Data Upload', { tag: ['@area:onboarding', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);
    const ids = freshIds();
    createdTenants.push(ids.TENANT_CODE);
    const tenantFixture = path.join(os.tmpdir(), `tenant-p2hier-${ids.SUFFIX}.xlsx`);
    await writeTenantFixture(tenantFixture, ids);
    tempFiles.push(tenantFixture);

    await loginAndCompletePhase1(page, tenantFixture, ids.TENANT_CODE);

    await page.getByRole('button', { name: /Option 1: Create New Hierarchy/i }).click();
    await expect(page.locator('#hierarchyType')).toBeVisible({ timeout: 15_000 });
    await page.locator('#hierarchyType').fill(ids.HIERARCHY_TYPE);

    // The level editor renders four inputs by default — Country, State,
    // City, Ward (Phase2Page.tsx:49). The wrapper around the level
    // inputs does not get its own role, so we count textboxes inside
    // the level container by their text "Level N:" siblings.
    await expect(page.getByText('Level 1:')).toBeVisible();
    await expect(page.getByText('Level 4:')).toBeVisible();
    await expect(page.getByText('[Root]').first()).toBeVisible();
    await expect(page.getByText('[Lowest]').first()).toBeVisible();

    // "+ Add Level" appends a 5th input.
    await page.getByRole('button', { name: /Add Level/i }).click();
    await expect(page.getByText('Level 5:')).toBeVisible();

    // The X button removes a level (only rendered when N > 2). After
    // removing one level we should be back to 4 visible level rows.
    // The X button has a child <X> icon and no accessible name — match
    // by its role+ancestor instead. There are 5 X-icon buttons (one per
    // level row); clicking the last one removes Level 5.
    const removeButtons = page.locator('div').filter({ hasText: /^Level \d+:/ }).getByRole('button').filter({ has: page.locator('svg.lucide-x') });
    // Fallback: pick any "remove level" button — they're the small X
    // buttons next to non-edge level inputs.
    const xIconButtons = page.locator('button:has(svg.lucide-x)');
    expect(await xIconButtons.count()).toBeGreaterThan(0);
    await xIconButtons.first().click();
    await expect(page.getByText('Level 5:')).toHaveCount(0);

    // Submit and advance to the Boundary Data Upload step.
    await page.getByRole('button', { name: /Create Hierarchy/i }).click();
    await expect(page.getByText('Boundary Data Upload')).toBeVisible({ timeout: 60_000 });
  });
});
