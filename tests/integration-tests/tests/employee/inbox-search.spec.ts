/**
 * Employee PGR inbox-v2 — SEARCH (TEST-COVERAGE-GAPS #19; search was entirely
 * untested). Drives the top search bar and asserts the row set responds:
 *
 *   • complaint-no  → searching a seeded SRID returns exactly that complaint.
 *   • mobile-no     → searching the seeded citizen's mobile returns it.
 *   • junk          → a well-formed but non-existent SRID returns zero rows.
 *
 * Deployment-portable: the complaint is always seeded as a CITIZEN via
 * seed.ts (PGR's APPLY action is [CITIZEN, CSR] on every deployment — an
 * ADMIN token only got away with filing here because local bootstrap grants
 * ADMIN the CITIZEN role too; bomet's ADMIN has no such luck and 400s), and
 * personas come from getPersona() rather than a hardcoded env username;
 * self-skips when the employee login is unavailable.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE_URL } from '../utils/env';
import { getPersona } from '../utils/personas';
import { seedComplaintAsCitizen } from '../utils/seed';
import { readProvisionedCitizen } from '../utils/citizen-provision';
import { loginEmployeeBrowser, readInboxRows } from '../utils/employee-ui';

const INBOX_URL = `${BASE_URL}/digit-ui/employee/pgr/inbox-v2`;
const SEARCH_RE = /pgr-services\/v2\/request\/_search/;

let srid = '';
let phone = '';
let setupSkip = '';

test.beforeAll(async () => {
  // seedComplaintAsCitizen() always files as the ONE citizen provisioned for
  // this run (tests/fixtures/citizen.setup.ts, read via
  // readProvisionedCitizen() — the same fixture read internally by seed.ts's
  // citizen() cache) and doesn't hand the mobile back on the result, so read
  // it off the fixture directly rather than round-tripping a second _search
  // just to recover it.
  const fixture = readProvisionedCitizen();
  if (!fixture) {
    setupSkip = 'no citizen-fixture.json on disk — citizen.setup.ts did not run (needed to know which mobile filed the seed complaint)';
    return;
  }
  phone = fixture.mobile;
  try {
    const created = await seedComplaintAsCitizen({ description: `inbox-search seed ${new Date().toISOString()}` });
    srid = created.srid;
  } catch (err: any) {
    setupSkip = `seed failed: ${err?.message?.slice(0, 200)}`;
  }
});

async function openInbox(page: Page): Promise<void> {
  const employee = await getPersona('employee');
  const ok = await loginEmployeeBrowser(page, employee.username, employee.password);
  test.skip(!ok, `employee ${employee.username} login failed`);
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
