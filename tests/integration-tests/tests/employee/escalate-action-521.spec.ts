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
 * ESCALATE is a workflow-config capability, not app code, and the two
 * shipped deployments disagree on it (maputo's pg-derived workflow has no
 * manual ESCALATE at all; bomet's does) — see the persona-triple comment in
 * personas.ts and deploy/expectations/*.json. requires() below is the single
 * source of truth for that: it SKIPs on a deployment that declares ESCALATE
 * 'absent' (maputo) and FAILs on one that declares it 'required' but it went
 * missing (a real regression), instead of this file re-deriving the same
 * answer from an ad-hoc businessService probe.
 *
 * Setup: PENDINGATLME is a one-shot state, so a static historical
 * complaint can't be relied on to still be sitting there. Instead we seed
 * a FRESH complaint each run via seed.ts and drive it create → ASSIGN →
 * PENDINGATLME. Set ASSIGNED_COMPLAINT_ID to skip seeding and use a specific
 * complaint you know is at PENDINGATLME. If seeding fails, the test
 * self-skips with a clear reason rather than pointing at a dead fixture.
 */
import { test, expect } from '@playwright/test';
import { requires, isPresent } from '../utils/capabilities';
import { getPersona } from '../utils/personas';
import { seedComplaintAsCitizen, driveToPendingAtLme } from '../utils/seed';
import { BASE_URL, TENANT, TENANT_LABEL } from '../utils/env';

const LOGIN_URL = '/digit-ui/employee/user/login';
const CAPABILITY = 'workflow.pgr.actions.ESCALATE' as const;

// Resolved at beforeAll time. An explicit ASSIGNED_COMPLAINT_ID env
// override wins (operator supplied a known PENDINGATLME complaint);
// otherwise we seed a fresh one. `seedSkipReason` is set when seeding was
// attempted and failed, so the test can skip with a clear message instead
// of driving a dead/absent complaint.
let COMPLAINT_ID = '';
let seedSkipReason = '';

test.beforeAll(async () => {
  // Seeding costs a live PGR create + ASSIGN round-trip. Skip that work when
  // this deployment cannot show Escalate at all — requires() in the test
  // body is what actually decides skip-vs-fail; this only avoids burning a
  // seed + an idgen sequence number on a run that is going to skip anyway.
  if (!isPresent(CAPABILITY)) return;

  if (process.env.ASSIGNED_COMPLAINT_ID) {
    COMPLAINT_ID = process.env.ASSIGNED_COMPLAINT_ID;
    console.log(`[escalate-521] using operator ASSIGNED_COMPLAINT_ID=${COMPLAINT_ID}`);
    return;
  }
  try {
    // seedComplaintAsCitizen always files as a CITIZEN — PGR's start-state
    // APPLY action is restricted to roles [CITIZEN, CSR], so seeding with an
    // employee token 400s "INVALID ROLE" on any employee that isn't also a
    // citizen. (It survives on stock deployments only because bootstrap hands
    // ADMIN the whole role bundle, CITIZEN included — a real onboarded
    // employee has no such luck.) driveToPendingAtLme reuses the same
    // (serviceCode, actor, assignee) triple the create used, so the ASSIGN
    // that follows lines up on the department check instead of guessing.
    const { srid } = await seedComplaintAsCitizen({ description: `#521 escalate seed — ${new Date().toISOString()}` });
    await driveToPendingAtLme(srid);
    COMPLAINT_ID = srid;
    console.log(`[escalate-521] seeded ${COMPLAINT_ID} at PENDINGATLME`);
  } catch (err: any) {
    seedSkipReason = `could not seed a PENDINGATLME complaint: ${err?.message?.slice(0, 200)}`;
    console.log(`[escalate-521] ${seedSkipReason}`);
  }
});

test.describe('employee — manual Escalate action #521', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('PENDINGATLME → Escalate → PENDINGATSUPERVISOR (workflow state moves)', async ({ page }) => {
    requires(test, CAPABILITY, 'employee #521 escalate');
    test.skip(!!seedSkipReason, seedSkipReason);
    test.skip(!COMPLAINT_ID, 'no complaint at PENDINGATLME available (seed produced no id)');

    // Whoever logs in here just needs the PGR_LME role, not to literally be
    // the complaint's assignee: egov-workflow-v2's nextActions is computed
    // from the CALLER's own roles against the businessService state config
    // (the same fact seed.ts's driveToResolved leans on — "RESOLVE is
    // role-gated, not assignee-gated"). That sidesteps the EMPLOYEE_USER
    // env var entirely, which on bomet defaults to ADMIN and does not carry
    // PGR_LME (see personas.ts's persona-triple comment: HS_GRO has GRO but
    // not PGR_LME; DEMO_WATER has PGR_LME but no login is known for it).
    // getPersona('lme') discovers a credentialed PGR_LME holder instead.
    const lme = await getPersona('lme');

    // ============ digit-ui employee login ============
    await page.goto(`${BASE_URL}${LOGIN_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_500);

    await page.locator('input[type="text"]').first().pressSequentially(lme.username, { delay: 60 });
    await page.locator('input[type="password"]').first().pressSequentially(lme.password, { delay: 60 });

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
    // tenantId is the complaint's own TENANT, not ROOT_TENANT: they only
    // ever coincided here because bomet is flat (TENANT === ROOT_TENANT).
    // On a city sub-tenant deployment the complaint's process lives at the
    // city, and ROOT_TENANT would silently search the wrong tenant.
    const wfResp = await page.request.post(
      `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?businessIds=${COMPLAINT_ID}&tenantId=${TENANT}`,
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
