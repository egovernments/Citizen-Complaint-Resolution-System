/**
 * Employee PGR lifecycle DRIVEN THROUGH THE REAL TAKE-ACTION UI
 * (TEST-COVERAGE-GAPS #6 — "the lifecycle is asserted at render level but
 * rarely exercised through the real-role UI").
 *
 * A complaint is walked PENDINGFORASSIGNMENT → PENDINGATLME → RESOLVED using
 * the actual Take-Action modal (not an ADMIN-masked API call):
 *
 *   1. ASSIGN  as a GRO (EMPLOYEE_USER) — pick an LME assignee + mandatory
 *      comment → assert the workflow moves to PENDINGATLME.
 *   2. RESOLVE as an LME (whichever env principal actually carries PGR_LME in
 *      its OAuth token) — mandatory comment → assert RESOLVED.
 *
 * Each state transition is verified out-of-band via PGR _search, and each
 * mandatory comment is asserted to land on the complaint timeline.
 *
 * Role reality on mz.maputo: EMP001's token carries GRO+EMPLOYEE (its HRMS
 * PGR_LME grant hasn't propagated to user-service), so the RESOLVE step —
 * which the workflow gates on PGR_LME — is performed by the ADMIN principal
 * whose token does carry PGR_LME. That is exactly the gap doc's intent:
 * "assign as a GRO, resolve as the LME". The spec picks the LME principal
 * dynamically, so on a deployment where EMPLOYEE_USER's token has PGR_LME it
 * uses that single officer for both.
 */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { pgrCreate, resolveServiceCode, resolveLocalityCode } from '../utils/launch-fixes/api';
import {
  BASE_URL, TENANT, EMPLOYEE_USER, EMPLOYEE_PASS, ADMIN_USER, ADMIN_PASS,
  SERVICE_CODE, LOCALITY_CODE, generateCitizenPhone,
} from '../utils/env';
import {
  getPrincipal, loginEmployeeBrowser, apiStatus, takeAction, type Principal,
} from '../utils/employee-ui';

let admin: Principal | null = null;
let lmeUser = '';
let lmePass = '';
let srid = '';
let setupSkip = '';

test.beforeAll(async () => {
  admin = await getPrincipal(ADMIN_USER, ADMIN_PASS);
  const gro = await getPrincipal(EMPLOYEE_USER, EMPLOYEE_PASS);
  if (!admin) { setupSkip = `ADMIN (${ADMIN_USER}) login failed`; return; }
  if (!gro) { setupSkip = `employee/GRO (${EMPLOYEE_USER}) login failed`; return; }
  if (!gro.roles.includes('GRO')) { setupSkip = `${EMPLOYEE_USER} token lacks GRO — cannot ASSIGN via UI`; return; }

  // Pick a principal whose TOKEN carries PGR_LME (RESOLVE is gated on it).
  if (gro.roles.includes('PGR_LME')) { lmeUser = EMPLOYEE_USER; lmePass = EMPLOYEE_PASS; }
  else if (admin.roles.includes('PGR_LME')) { lmeUser = ADMIN_USER; lmePass = ADMIN_PASS; }
  else { setupSkip = 'no configured principal carries PGR_LME in its token — cannot RESOLVE via UI'; return; }

  try {
    const serviceCode = await resolveServiceCode(BASE_URL, admin.token, TENANT, SERVICE_CODE);
    const localityCode = await resolveLocalityCode(BASE_URL, admin.token, TENANT, LOCALITY_CODE);
    const created = await pgrCreate({
      baseUrl: BASE_URL, auth: { token: admin.token, userInfo: admin.userInfo }, tenantId: TENANT,
      serviceCode, localityCode, description: `lifecycle-ui seed ${new Date().toISOString()}`,
      citizenName: 'Lifecycle UI Seed', citizenPhone: generateCitizenPhone(),
    });
    srid = created.serviceRequestId;
    if (created.applicationStatus !== 'PENDINGFORASSIGNMENT') {
      setupSkip = `seed landed at ${created.applicationStatus}, not PENDINGFORASSIGNMENT`;
    }
  } catch (err: any) {
    setupSkip = `seed failed: ${err?.message?.slice(0, 200)}`;
  }
});

/** Fresh browser context + page logged in as `user`, opened on the complaint
 *  detail page. A dedicated context per principal guarantees the session
 *  actually switches (re-injecting localStorage on a live SPA page does not
 *  reliably swap the logged-in employee). */
async function openDetailsAs(browser: Browser, user: string, pass: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const ok = await loginEmployeeBrowser(page, user, pass);
  test.skip(!ok, `login failed for ${user}`);
  await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint-details/${srid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('.digit-viewcard-field-pair, .v2-pgr-details').first().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(3_000);
  return page;
}

async function timelineText(page: Page): Promise<string> {
  await expect(page.getByText('Complaint Timeline', { exact: true })).toBeVisible({ timeout: 10_000 });
  return (await page.locator('body').innerText());
}

test.describe('employee PGR lifecycle through the Take-Action UI', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('ASSIGN (GRO) → PENDINGATLME, then RESOLVE (LME) → RESOLVED @p0', async ({ browser }) => {
    test.skip(!!setupSkip, setupSkip);
    expect(srid).not.toBe('');

    const assignComment = `UI-ASSIGN ${Date.now()}`;
    const resolveComment = `UI-RESOLVE ${Date.now()}`;

    // ---------- 1. ASSIGN as GRO ----------
    let page = await openDetailsAs(browser, EMPLOYEE_USER, EMPLOYEE_PASS);
    expect(await apiStatus(admin!, srid)).toBe('PENDINGFORASSIGNMENT');

    await takeAction(page, /^assign$/i);
    await expect(page.getByText(/Assign Complaint|CS_ACTION_ASSIGN/i).first()).toBeVisible({ timeout: 10_000 });

    // Pick the (first) LME assignee from the department-grouped picker.
    const empInput = page.locator('.digit-dropdown-employee-select-wrap input[type="text"]').first();
    await empInput.click();
    await page.waitForTimeout(800);
    const empOption = page.locator('.main-option').first();
    if (await empOption.count()) await empOption.click();
    else { await empInput.press('ArrowDown'); await empInput.press('Enter'); }
    await page.waitForTimeout(500);

    await page.locator('textarea').first().fill(assignComment);
    await page.getByRole('button', { name: /^SUBMIT$|^Submit$/ }).first().click();

    await expect.poll(async () => apiStatus(admin!, srid), { timeout: 25_000, intervals: [1500] })
      .toBe('PENDINGATLME');

    // Comment on the timeline.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    expect(await timelineText(page)).toContain(assignComment);
    await page.context().close();

    // ---------- 2. RESOLVE as LME (fresh session) ----------
    page = await openDetailsAs(browser, lmeUser, lmePass);
    await takeAction(page, /^resolve$/i);
    await expect(page.getByText(/PGR_ACTION_RESOLVE|Resolve Complaint|Resolve/i).first()).toBeVisible({ timeout: 10_000 });
    await page.locator('textarea').first().fill(resolveComment);
    await page.getByRole('button', { name: /^SUBMIT$|^Submit$/ }).first().click();

    await expect.poll(async () => apiStatus(admin!, srid), { timeout: 25_000, intervals: [1500] })
      .toBe('RESOLVED');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    expect(await timelineText(page)).toContain(resolveComment);
    await page.context().close();
  });
});
