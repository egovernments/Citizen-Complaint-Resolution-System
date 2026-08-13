/**
 * Employee — manual Escalate action end-to-end (CCRS #521).
 *
 * Closes Gurjeet's #521 retest: a complaint sitting at PENDINGATLME, an
 * employee picks Escalate from the action dropdown, fills the comment and
 * submits, and the submit drives a REAL workflow transition recorded as
 * ESCALATE (issue #521 was an *empty no-op modal* — the option rendered and
 * did nothing).
 *
 * ── THE ESCALATION MODEL, settled from the source ──────────────────────────
 *
 * pgr-services does NOT decide the state ESCALATE lands in. All it ever does
 * is hand egov-workflow-v2 an action plus assignees:
 *
 *   EscalationService.escalateComplaint()  (backend/pgr-services/.../service/
 *   EscalationService.java:92-113) builds Workflow{action: ESCALATE,
 *   assignes: [supervisorUuid]} and calls workflowService.updateWorkflowStatus().
 *   The supervisor is HRMSUtil.getSupervisorUuid() — HRMS `reportingTo[0]` of
 *   the current assignee (HRMSUtil.java:73-97), i.e. escalation climbs the HRMS
 *   reporting chain, one rung per escalation, bounded by escalationLevel <
 *   maxDepth (EscalationService.java:62-68, EscalationScheduler.java:98-102).
 *
 * So the ASSIGNEE move is app code and is invariant across deployments; the
 * STATE move is 100% businessService config. The app's own shipped seed
 * (utilities/default-data-handler/src/main/resources/PgrWorkflowConfig.json,
 * commit 8a5d6d9d "fix(pgr): #521 — seed manual ESCALATE action on
 * PENDINGATLME") wires it as:
 *
 *   PENDINGATLME --ESCALATE--> PENDINGATSUPERVISOR
 *       roles [PGR_LME, PGR_VIEWER, SYSTEM, AUTO_ESCALATE]
 *
 * That is the intended product wiring, and this spec annotates a run whose
 * deployment says otherwise. It does not hard-assert PENDINGATSUPERVISOR,
 * because a deployment is free to (and mz.maputo currently does) wire ESCALATE
 * as a self-loop on PENDINGATLME — asserting a literal target would be exactly
 * the hardcoded-deployment-value mistake WRITING-TESTS.md forbids. The target
 * is read live off businessservice/_search; what is asserted unconditionally is
 * the part #521 is actually about: the option appears, the modal renders a real
 * form, and the submit produces an ESCALATE process instance carrying our
 * comment — then the state matches whatever this deployment configured.
 *
 * (api/pgr-escalation.spec.ts's "add ESCALATE if missing" self-heal writes the
 * SELF-LOOP variant, which is what put mz.maputo out of step with the seed.)
 *
 * ESCALATE remains a workflow-config capability, so requires() stays the single
 * source of truth for skip-vs-fail: it SKIPs on a deployment that declares
 * ESCALATE 'absent' and FAILs on one that declares it 'required' but it went
 * missing (a real regression) — see deploy/expectations/*.json.
 *
 * Setup: PENDINGATLME is a one-shot state, so a static historical complaint
 * can't be relied on to still be sitting there. We seed a FRESH complaint each
 * run via seed.ts and drive it create → ASSIGN → PENDINGATLME. Set
 * ASSIGNED_COMPLAINT_ID to skip seeding and use a specific complaint you know
 * is at PENDINGATLME. If seeding fails, the test self-skips with a clear reason
 * rather than pointing at a dead fixture.
 */
import { test, expect, type Page } from '@playwright/test';
import { requires, isPresent } from '../utils/capabilities';
import { getPersona } from '../utils/personas';
import { seedComplaintAsCitizen, driveToPendingAtLme } from '../utils/seed';
import { loginEmployeeBrowser, getPrincipal, apiStatus, type Principal } from '../utils/employee-ui';
import { BASE_URL, TENANT } from '../utils/env';

const CAPABILITY = 'workflow.pgr.actions.ESCALATE' as const;

/** The nextState the app's own seed wires ESCALATE@PENDINGATLME to. */
const SEEDED_ESCALATE_TARGET = 'PENDINGATSUPERVISOR';

// Resolved at beforeAll time. An explicit ASSIGNED_COMPLAINT_ID env
// override wins (operator supplied a known PENDINGATLME complaint);
// otherwise we seed a fresh one. `seedSkipReason` is set when seeding was
// attempted and failed, so the test can skip with a clear message instead
// of driving a dead/absent complaint.
let COMPLAINT_ID = '';
let seedSkipReason = '';

/**
 * The state ESCALATE actually lands in FROM PENDINGATLME on this deployment.
 *
 * Deliberately resolved per-state rather than via probes.ts's
 * nextStateByAction, which is keyed by action alone: PGR defines ESCALATE on
 * both PENDINGFORASSIGNMENT and PENDINGATLME, so a flat action->nextState map
 * silently answers with whichever state the search happened to return last.
 * nextState comes over the wire as a state *uuid*, resolved to its name here.
 */
async function escalateTargetFromPendingAtLme(authToken?: string): Promise<string | null> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_search` +
      `?tenantId=${encodeURIComponent(TENANT)}&businessServices=PGR`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', ver: '.01', authToken } }),
    },
  );
  if (!resp.ok) return null;
  const body: any = await resp.json();
  const svc = body?.BusinessServices?.[0];
  if (!svc?.states?.length) return null;

  const nameByUuid = new Map<string, string>(
    (svc.states as any[]).filter((s) => s.uuid && s.state).map((s) => [s.uuid, s.state]),
  );
  const lmeState = (svc.states as any[]).find((s) => s.state === 'PENDINGATLME');
  const escalate = (lmeState?.actions || []).find((a: any) => a.action === 'ESCALATE' && a.active !== false);
  if (!escalate) return null;
  // A self-loop's nextState is PENDINGATLME's own uuid, so this resolves to
  // 'PENDINGATLME' — no special-casing needed.
  return nameByUuid.get(escalate.nextState) ?? null;
}

/** Newest process instance for the complaint (workflow service, not the lagging PGR index). */
async function latestProcessInstance(page: Page, authToken: string): Promise<any | null> {
  const resp = await page.request.post(
    `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search` +
      `?businessIds=${COMPLAINT_ID}&tenantId=${TENANT}&history=true`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: { RequestInfo: { apiId: 'Rainmaker', ver: '.01', authToken } },
    },
  );
  if (!resp.ok()) return null;
  const body: any = await resp.json();
  return body?.ProcessInstances?.[0] ?? null;
}

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

  test('PENDINGATLME → Escalate → real ESCALATE transition into the configured target state', { tag: ['@persona:employee'] }, async ({ page }) => {
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
    const reader: Principal | null = await getPrincipal(lme.username, lme.password);
    expect(reader, `could not acquire a token for the LME persona ${lme.username}`).not.toBeNull();

    // ============ What THIS deployment wires ESCALATE to ============
    const escalateTarget = await escalateTargetFromPendingAtLme(lme.token);
    expect(
      escalateTarget,
      '#521 — the PGR businessService must define an active ESCALATE action on PENDINGATLME ' +
        `(the app seeds it as PENDINGATLME --ESCALATE--> ${SEEDED_ESCALATE_TARGET})`,
    ).not.toBeNull();
    console.log(`[escalate-521] ESCALATE@PENDINGATLME lands in ${escalateTarget}`);
    if (escalateTarget !== SEEDED_ESCALATE_TARGET) {
      // Not a failure — a deployment may legitimately wire ESCALATE as a
      // self-loop — but it IS drift from the shipped seed and worth surfacing
      // on every run rather than discovering it again from scratch.
      test.info().annotations.push({
        type: 'workflow-drift',
        description:
          `ESCALATE@PENDINGATLME lands in ${escalateTarget}, not the seeded ${SEEDED_ESCALATE_TARGET} ` +
          '(utilities/default-data-handler/src/main/resources/PgrWorkflowConfig.json). ' +
          'On this deployment the state stays put and only the assignee climbs the HRMS reportingTo chain.',
      });
    }

    // ============ digit-ui employee login ============
    // Token injection, not the login form: the login page's city picker is a
    // custom select with no <label> and no accessible name, so driving it by
    // role/name hangs until the test times out. Every other employee UI spec
    // (workflow-lifecycle-ui, inbox-filters, inbox-search, …) logs in this way.
    const loggedIn = await loginEmployeeBrowser(page, lme.username, lme.password);
    expect(loggedIn, `digit-ui login failed for the LME persona ${lme.username}`).toBeTruthy();

    // ============ Open the assigned complaint detail ============
    await page.goto(
      `${BASE_URL}/digit-ui/employee/pgr/complaint-details/${COMPLAINT_ID}`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.locator('.digit-viewcard-field-pair, .v2-pgr-details').first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(3_000);

    // Precondition, stated rather than assumed: the seed really is at PENDINGATLME.
    expect(await apiStatus(reader!, COMPLAINT_ID)).toBe('PENDINGATLME');

    // ============ Take action → Escalate ============
    const takeActionBtn = page.locator('.digit-action-bar-wrap button, .action-bar-wrap button, footer button').first();
    await expect(takeActionBtn).toBeVisible({ timeout: 15_000 });
    await takeActionBtn.click();
    await page.waitForTimeout(1_500);

    const escalateOption = page.getByText(/^Escalate$/i).first();
    await expect(
      escalateOption,
      '#521 — Escalate option must appear in the Take action menu when state = PENDINGATLME',
    ).toBeVisible({ timeout: 8_000 });
    await escalateOption.click();
    await page.waitForTimeout(2_000);

    // ============ Fill comment + submit ============
    // The comment box IS the #521 regression guard: before the ACTION_CONFIGS
    // fix, getUpdatedConfig() returned null for ESCALATE and PGRWorkflowModal
    // short-circuited to an empty modal with no form at all.
    const comment = `UI-ESCALATE ${Date.now()}`;
    const commentBox = page.locator('textarea').first();
    await expect(
      commentBox,
      '#521 — Escalate must render its action form (assignee + comments), not an empty no-op modal',
    ).toBeVisible({ timeout: 10_000 });
    await commentBox.fill(comment);

    // The Escalate modal's assignee picker is optional (PGRAssigneeComponent,
    // isMandatory: false) and its option set is derived from the NEXT state's
    // roles, which differ per deployment — leaving it empty keeps the spec
    // deployment-agnostic. The reportingTo climb is the auto-escalation
    // scheduler's job (EscalationService) and is covered by api/pgr-escalation.
    await page.getByRole('button', { name: /^SUBMIT$|^Submit$/ }).first().click();

    // ============ Verify a real ESCALATE transition happened ============
    // This is the load-bearing assertion. Where a self-loop is configured the
    // applicationStatus check below is trivially satisfied even by a no-op
    // submit, so the proof that anything happened is a fresh ESCALATE process
    // instance carrying the comment we just typed.
    await expect
      .poll(async () => (await latestProcessInstance(page, lme.token))?.action, {
        timeout: 25_000,
        intervals: [1500],
        message: '#521 — submitting the Escalate modal must drive a real ESCALATE workflow transition',
      })
      .toBe('ESCALATE');

    const latest = await latestProcessInstance(page, lme.token);
    expect(
      latest?.comment,
      '#521 — the Escalate modal\'s comment must reach the workflow, not be dropped by an inert modal',
    ).toBe(comment);

    // ============ …landing in the state this deployment configured ============
    await expect
      .poll(async () => apiStatus(reader!, COMPLAINT_ID), { timeout: 25_000, intervals: [1500] })
      .toBe(escalateTarget);
  });
});
