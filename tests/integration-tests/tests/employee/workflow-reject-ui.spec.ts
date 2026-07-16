/**
 * Employee PGR REJECT driven through the real Take-Action UI
 * (TEST-COVERAGE-GAPS #7 — REJECT was untested at the UI/transition layer).
 *
 * A fresh PENDINGFORASSIGNMENT complaint is rejected by a GRO through the
 * actual Reject modal: pick a seeded RAINMAKER-PGR.RejectionReasons entry +
 * mandatory comment → assert the workflow moves to REJECTED and that the
 * rejection reason (composed into the workflow comment as `[<CODE>] …` by
 * PGRDetails.handleActionSubmit) renders on the complaint timeline.
 *
 * Auth: EMPLOYEE_USER (GRO) — REJECT at PENDINGFORASSIGNMENT is a GRO action.
 * Deployment-portable: self-skips when no employee/GRO login is available or
 * no rejection reasons are seeded.
 */
import { test, expect, type Page } from '@playwright/test';
import { pgrCreate, resolveServiceCode, resolveLocalityCode } from '../utils/launch-fixes/api';
import {
  BASE_URL, TENANT, EMPLOYEE_USER, EMPLOYEE_PASS, ADMIN_USER, ADMIN_PASS,
  SERVICE_CODE, LOCALITY_CODE, generateCitizenPhone,
} from '../utils/env';
import {
  getPrincipal, loginEmployeeBrowser, apiStatus, takeAction, type Principal,
} from '../utils/employee-ui';

let admin: Principal | null = null;
let srid = '';
let setupSkip = '';
let reasonsSeeded = false;

async function fetchRejectionReasons(token: string): Promise<string[]> {
  try {
    const j: any = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { authToken: token }, MdmsCriteria: { tenantId: TENANT, schemaCode: 'RAINMAKER-PGR.RejectionReasons', limit: 50 } }),
    }).then((r) => r.json());
    return (j.mdms || []).map((m: any) => m.data?.code || m.uniqueIdentifier).filter(Boolean);
  } catch { return []; }
}

test.beforeAll(async () => {
  admin = await getPrincipal(ADMIN_USER, ADMIN_PASS);
  const gro = await getPrincipal(EMPLOYEE_USER, EMPLOYEE_PASS);
  if (!admin) { setupSkip = `ADMIN (${ADMIN_USER}) login failed`; return; }
  if (!gro || !gro.roles.includes('GRO')) { setupSkip = `${EMPLOYEE_USER} lacks a usable GRO token — cannot REJECT via UI`; return; }
  reasonsSeeded = (await fetchRejectionReasons(admin.token)).length > 0;
  try {
    const serviceCode = await resolveServiceCode(BASE_URL, admin.token, TENANT, SERVICE_CODE);
    const localityCode = await resolveLocalityCode(BASE_URL, admin.token, TENANT, LOCALITY_CODE);
    const created = await pgrCreate({
      baseUrl: BASE_URL, auth: { token: admin.token, userInfo: admin.userInfo }, tenantId: TENANT,
      serviceCode, localityCode, description: `reject-ui seed ${new Date().toISOString()}`,
      citizenName: 'Reject UI Seed', citizenPhone: generateCitizenPhone(),
    });
    srid = created.serviceRequestId;
    if (created.applicationStatus !== 'PENDINGFORASSIGNMENT') setupSkip = `seed at ${created.applicationStatus}, not PENDINGFORASSIGNMENT`;
  } catch (err: any) {
    setupSkip = `seed failed: ${err?.message?.slice(0, 200)}`;
  }
});

test.describe('employee PGR REJECT through the Take-Action UI', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('REJECT (GRO) with a rejection reason → REJECTED, reason on timeline @p0', async ({ page }) => {
    test.skip(!!setupSkip, setupSkip);
    test.skip(!reasonsSeeded, 'no RAINMAKER-PGR.RejectionReasons seeded on this deployment');

    const rejectComment = `UI-REJECT ${Date.now()}`;

    const ok = await loginEmployeeBrowser(page, EMPLOYEE_USER, EMPLOYEE_PASS);
    test.skip(!ok, `login failed for ${EMPLOYEE_USER}`);
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/complaint-details/${srid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.locator('.digit-viewcard-field-pair, .v2-pgr-details').first().waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(3_000);
    expect(await apiStatus(admin!, srid)).toBe('PENDINGFORASSIGNMENT');

    await takeAction(page, /^reject$/i);
    await expect(page.getByText(/PGR_ACTION_REJECT|Reject Complaint|Reject/i).first()).toBeVisible({ timeout: 10_000 });

    // Pick the first seeded rejection reason.
    const reasonInput = page.locator('.digit-dropdown-employee-select-wrap input[type="text"]').first();
    await reasonInput.click();
    await page.waitForTimeout(800);
    const firstReason = page.locator('.digit-dropdown-options-card .digit-dropdown-item').first();
    if (await firstReason.count()) await firstReason.click();
    await page.waitForTimeout(400);

    await page.locator('textarea').first().fill(rejectComment);
    await page.getByRole('button', { name: /^SUBMIT$|^Submit$/ }).first().click();

    await expect.poll(async () => apiStatus(admin!, srid), { timeout: 25_000, intervals: [1500] })
      .toBe('REJECTED');

    // Reason + comment render on the timeline. The reason code is composed into
    // the comment as "[<CODE>] <free text>".
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    await expect(page.getByText(/Complaint Timeline|CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE/i).first()).toBeVisible({ timeout: 10_000 });
    const body = await page.locator('body').innerText();
    expect(body, 'free-text comment on timeline').toContain(rejectComment);
    expect(body, 'bracketed rejection-reason code on timeline').toMatch(/\[[A-Z_]+\]/);
  });
});
