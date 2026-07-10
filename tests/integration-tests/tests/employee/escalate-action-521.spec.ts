/**
 * Employee — manual Escalate action end-to-end (CCRS #521).
 *
 * Closes Gurjeet's #521 retest: complaint at PENDINGATLME, employee
 * picks Escalate from the action dropdown, submits comment, workflow
 * state moves to PENDINGATSUPERVISOR.
 *
 * Requires a deployment where:
 *   - PGR ACTION_CONFIGS lists ESCALATE (#521 frontend half)
 *   - The PGR workflow on the root tenant has PENDINGATLME → ESCALATE
 *     → PENDINGATSUPERVISOR with PGR_LME role (PR #635 / commit ce302053)
 *
 * Setup: PENDINGATLME is a one-shot state, so a static historical
 * complaint can't be relied on to still be sitting there. Instead we seed
 * a FRESH complaint each run and drive it create → ASSIGN → PENDINGATLME,
 * assigning it to EMPLOYEE_USER so the Escalate action shows in their
 * inbox. Set ASSIGNED_COMPLAINT_ID to skip seeding and use a specific
 * complaint you know is at PENDINGATLME. If seeding fails, the test
 * self-skips with a clear reason rather than pointing at a dead fixture.
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import {
  pgrCreate,
  resolveServiceCode,
  resolveLocalityCode,
} from '../utils/launch-fixes/api';
import {
  BASE_URL,
  TENANT,
  ROOT_TENANT,
  EMPLOYEE_USER,
  EMPLOYEE_PASS,
  GRO_USER,
  GRO_PASS,
  SERVICE_CODE,
  LOCALITY_CODE,
  TENANT_LABEL,
  generateCitizenPhone,
} from '../utils/env';

const LOGIN_URL = '/digit-ui/employee/user/login';

/** Fetch the full service object (needed as the _update body for ASSIGN). */
async function fetchService(
  token: string,
  userInfo: Record<string, unknown>,
  srid: string,
): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${srid}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  if (!resp.ok) throw new Error(`fetchService ${srid}: HTTP ${resp.status}`);
  const data: any = await resp.json();
  const service = data?.ServiceWrappers?.[0]?.service;
  if (!service) throw new Error(`fetchService ${srid}: no service in response`);
  return service;
}

/**
 * Seed a fresh complaint and drive it to PENDINGATLME, assigned to
 * EMPLOYEE_USER (the principal that logs in via the UI below). Returns the
 * new serviceRequestId. Reuses the shared PGR helpers so it stays
 * CRS/legacy-schema compatible across tenants.
 */
async function seedPendingAtLme(): Promise<string> {
  // Employee token — this user is BOTH the UI login and the ASSIGN target,
  // so the seeded complaint lands in their inbox with the Escalate action.
  const empResp = await getDigitToken({ tenant: ROOT_TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });
  const empToken = empResp.access_token;
  const empUserInfo = (empResp.UserRequest || {}) as Record<string, unknown>;
  const empUuid = empUserInfo.uuid as string | undefined;
  if (!empToken || !empUuid) throw new Error(`employee ${EMPLOYEE_USER} login returned no token/uuid`);

  // GRO token — the role the PGR workflow requires for the ASSIGN action.
  const groResp = await getDigitToken({ tenant: ROOT_TENANT, username: GRO_USER, password: GRO_PASS });
  const groToken = groResp.access_token;
  const groUserInfo = (groResp.UserRequest || {}) as Record<string, unknown>;
  if (!groToken) throw new Error(`GRO ${GRO_USER} login returned no token`);

  // Resolve codes valid on the target tenant (env defaults are Nairobi-shaped).
  const serviceCode = await resolveServiceCode(BASE_URL, empToken, TENANT, SERVICE_CODE);
  const localityCode = await resolveLocalityCode(BASE_URL, empToken, TENANT, LOCALITY_CODE);

  // Create (APPLY) — filed by the employee on behalf of a citizen.
  const created = await pgrCreate({
    baseUrl: BASE_URL,
    auth: { token: empToken, userInfo: empUserInfo },
    tenantId: TENANT,
    serviceCode,
    localityCode,
    description: `#521 escalate seed — ${new Date().toISOString()}`,
    citizenName: 'Escalate Seed Citizen',
    citizenPhone: generateCitizenPhone(),
  });
  const srid = created.serviceRequestId;

  // ASSIGN (GRO → LME) to move PENDINGFORASSIGNMENT → PENDINGATLME.
  const fullService = await fetchService(groToken, groUserInfo, srid);
  const assignResp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${groToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: groToken, userInfo: groUserInfo },
      service: fullService,
      workflow: { action: 'ASSIGN', assignes: [empUuid], comments: '#521 escalate seed assign' },
    }),
  });
  if (!assignResp.ok) {
    throw new Error(`ASSIGN ${srid} failed: HTTP ${assignResp.status} ${(await assignResp.text()).slice(0, 300)}`);
  }
  const assignData: any = await assignResp.json();
  const status = assignData?.ServiceWrappers?.[0]?.service?.applicationStatus;
  if (status !== 'PENDINGATLME') throw new Error(`ASSIGN ${srid}: expected PENDINGATLME, got ${status}`);
  return srid;
}

// Resolved at beforeAll time. An explicit ASSIGNED_COMPLAINT_ID env
// override wins (operator supplied a known PENDINGATLME complaint);
// otherwise we seed a fresh one. `seedSkipReason` is set when seeding was
// attempted and failed, so the test can skip with a clear message instead
// of driving a dead/absent complaint.
let COMPLAINT_ID = '';
let seedSkipReason = '';

test.beforeAll(async () => {
  if (process.env.ASSIGNED_COMPLAINT_ID) {
    COMPLAINT_ID = process.env.ASSIGNED_COMPLAINT_ID;
    console.log(`[escalate-521] using operator ASSIGNED_COMPLAINT_ID=${COMPLAINT_ID}`);
    return;
  }
  try {
    COMPLAINT_ID = await seedPendingAtLme();
    console.log(`[escalate-521] seeded ${COMPLAINT_ID} at PENDINGATLME (assignee=${EMPLOYEE_USER})`);
  } catch (err: any) {
    seedSkipReason = `could not seed a PENDINGATLME complaint: ${err?.message?.slice(0, 200)}`;
    console.log(`[escalate-521] ${seedSkipReason}`);
  }
});

test.describe('employee — manual Escalate action #521', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('PENDINGATLME → Escalate → PENDINGATSUPERVISOR (workflow state moves)', async ({ page }) => {
    test.skip(!!seedSkipReason, seedSkipReason);
    test.skip(!COMPLAINT_ID, 'no complaint at PENDINGATLME available (seed produced no id)');

    // ============ digit-ui employee login ============
    await page.goto(`${BASE_URL}${LOGIN_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_500);

    await page.locator('input[type="text"]').first().pressSequentially(EMPLOYEE_USER, { delay: 60 });
    await page.locator('input[type="password"]').first().pressSequentially(EMPLOYEE_PASS, { delay: 60 });

    const cityCombo = page.getByRole('combobox', { name: /City/i });
    if (!(await cityCombo.textContent())?.includes(TENANT_LABEL)) {
      await cityCombo.click();
      await page.waitForTimeout(700);
      await page.getByRole('option', { name: new RegExp(TENANT_LABEL, 'i') }).first().click();
      await page.waitForTimeout(700);
    }
    await page.getByText(/I agree to the DIGIT/i).click();
    await page.waitForTimeout(700);
    await page.getByRole('button', { name: /^Login$/i }).click();
    await page.waitForURL(/\/digit-ui\/employee(?!\/user\/login)/, { timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // ============ Open the assigned complaint detail ============
    await page.goto(
      `${BASE_URL}/digit-ui/employee/pgr/complaint-details/${COMPLAINT_ID}?cb=${Date.now()}`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_000);

    // ============ Take action → Escalate ============
    const takeAction = page.getByRole('button', { name: /take action/i }).first();
    await expect(takeAction).toBeVisible({ timeout: 15_000 });
    await takeAction.click();
    await page.waitForTimeout(1_500);

    const escalateOption = page.getByText(/^Escalate$/i).first();
    await expect(
      escalateOption,
      '#521 — Escalate option must appear in the Take action menu when state = PENDINGATLME',
    ).toBeVisible({ timeout: 8_000 });
    await escalateOption.click();
    await page.waitForTimeout(2_000);

    // ============ Fill comment + submit ============
    const commentBox = page.locator('textarea').first();
    await expect(commentBox).toBeVisible({ timeout: 10_000 });
    await commentBox.fill('Integration test escalation comment.');

    const submitBtn = page.getByRole('button', { name: /^submit$|^send$|^escalate$/i }).first();
    await submitBtn.click();
    await page.waitForTimeout(3_000);

    // ============ Verify workflow state via process-search ============
    const wfResp = await page.request.post(
      `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?businessIds=${COMPLAINT_ID}&tenantId=${ROOT_TENANT}`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { RequestInfo: {} },
      },
    );
    expect(wfResp.ok()).toBeTruthy();
    const body = await wfResp.text();
    expect(
      body,
      '#521 — workflow state must move to PENDINGATSUPERVISOR after Escalate submit',
    ).toContain('PENDINGATSUPERVISOR');
  });
});
