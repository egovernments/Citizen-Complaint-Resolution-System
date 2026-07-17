/**
 * Employee PGR inbox-v2 — SEARCH (TEST-COVERAGE-GAPS #19; search was entirely
 * untested). Drives the top search bar and asserts the row set responds:
 *
 *   • complaint-no  → searching a seeded SRID returns exactly that complaint.
 *   • mobile-no     → searching the seeded citizen's mobile returns it.
 *   • junk          → a well-formed but non-existent SRID returns zero rows.
 *
 * Deployment-portable: the complaint + a unique citizen mobile are seeded
 * against the live deployment; self-skips when the employee/ADMIN login is
 * unavailable.
 */
import { test, expect, type Page } from '@playwright/test';
import { pgrCreate, resolveServiceCode, resolveLocalityCode } from '../utils/launch-fixes/api';
import {
  BASE_URL, TENANT, EMPLOYEE_USER, EMPLOYEE_PASS, ADMIN_USER, ADMIN_PASS,
  SERVICE_CODE, LOCALITY_CODE, generateCitizenPhone,
} from '../utils/env';
import { getPrincipal, loginEmployeeBrowser, readInboxRows, type Principal } from '../utils/employee-ui';

const INBOX_URL = `${BASE_URL}/digit-ui/employee/pgr/inbox-v2`;
const SEARCH_RE = /pgr-services\/v2\/request\/_search/;

let admin: Principal | null = null;
let srid = '';
let phone = '';
let setupSkip = '';

test.beforeAll(async () => {
  admin = await getPrincipal(ADMIN_USER, ADMIN_PASS);
  if (!admin) { setupSkip = `ADMIN (${ADMIN_USER}) login failed`; return; }
  try {
    const serviceCode = await resolveServiceCode(BASE_URL, admin.token, TENANT, SERVICE_CODE);
    const localityCode = await resolveLocalityCode(BASE_URL, admin.token, TENANT, LOCALITY_CODE);
    phone = generateCitizenPhone();
    const created = await pgrCreate({
      baseUrl: BASE_URL, auth: { token: admin.token, userInfo: admin.userInfo }, tenantId: TENANT,
      serviceCode, localityCode, description: `inbox-search seed ${new Date().toISOString()}`,
      citizenName: 'Inbox Search Seed', citizenPhone: phone,
    });
    srid = created.serviceRequestId;
  } catch (err: any) {
    setupSkip = `seed failed: ${err?.message?.slice(0, 200)}`;
  }
});

async function openInbox(page: Page): Promise<void> {
  const ok = await loginEmployeeBrowser(page, EMPLOYEE_USER, EMPLOYEE_PASS);
  test.skip(!ok, `employee ${EMPLOYEE_USER} login failed`);
  await Promise.all([
    page.waitForResponse((r) => SEARCH_RE.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null),
    page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
  ]);
  await page.locator('[role="row"]').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

async function runSearch(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => SEARCH_RE.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }),
    page.getByRole('button', { name: /^Search$/i }).first().click(),
  ]);
  await page.waitForTimeout(2_000);
}

test.describe('employee inbox-v2 — search', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('search by complaint number returns exactly that complaint @p1', async ({ page }) => {
    test.skip(!!setupSkip, setupSkip);
    await openInbox(page);

    await page.locator('input[name="complaintNumber"]').fill(srid);
    await runSearch(page);
    const rows = await readInboxRows(page);
    expect(rows.length, 'exactly one row for a unique SRID').toBe(1);
    expect(rows[0].srid).toBe(srid);
  });

  test('search by mobile number returns the matching complaint @p1', async ({ page }) => {
    test.skip(!!setupSkip, setupSkip);
    await openInbox(page);

    await page.locator('input[name="mobileNumber"]').fill(phone);
    await runSearch(page);
    const rows = await readInboxRows(page);
    expect(rows.length, 'mobile search returns ≥1 row').toBeGreaterThan(0);
    expect(rows.some((r) => r.srid === srid), 'the seeded complaint is among the mobile matches').toBeTruthy();
  });

  test('search for a well-formed but non-existent complaint number returns nothing @p1', async ({ page }) => {
    test.skip(!!setupSkip, setupSkip);
    await openInbox(page);

    // Matches the field's PG-PGR-YYYY-MM-DD-###### pattern but cannot exist.
    await page.locator('input[name="complaintNumber"]').fill('PG-PGR-2099-01-01-999999');
    await runSearch(page);
    const rows = await readInboxRows(page);
    expect(rows.length, 'no rows for a non-existent complaint number').toBe(0);
  });
});
