/**
 * PGR SLA auto-escalation — fast E2E (~2 min)
 *
 * Targeted test for the @Scheduled scanAndEscalate() in pgr-services.
 * Trims the larger pgr-escalation-api.spec.ts down to: prereq check + the
 * single auto-escalation assertion.
 *
 * Prerequisites on the target deployment:
 *   ESCALATE workflow action allows role SYSTEM at root tenant   (tests 1-3, always run)
 *   At least one HRMS reportingTo relationship in the city tenant (tests 1-3, always run)
 *   PGR_ESCALATION_INTERVAL_MS=60000   (scan every 60 s)          (test 4 only, opt-in)
 *   PGR_ESCALATION_DEFAULT_SLA_MS=30000 (SLA breach in 30 s)      (test 4 only, opt-in)
 *
 * Only test 4 is gated (on PGR_FAST_ESCALATION=1) — it is the one with a
 * wall-clock deadline. Tests 1-3 are cheap reads and run everywhere, so a
 * deployment that has auto-escalation misconfigured still gets a red rather
 * than a silent skip. On a stock deployment this file is 3 passes + 1 skip and
 * finishes in seconds; the ~2 min figure applies only with the gate opened.
 *
 * Worst-case timing:
 *   - Just-missed scheduler tick: 60 s wait
 *   - Plus 30 s SLA grace: 90 s
 *   - + ~10 s for create/assign/poll buffer ≈ 100 s
 * Test deadline is set to 130 s.
 *
 * Deployment-independence note: complaint creation goes through seed.ts's
 * seedComplaintAsCitizen() (files as a CITIZEN against resolveSeedPlan()'s
 * serviceCode/localityCode) rather than a bespoke OTP-registration + raw
 * _create — PGR's APPLY action is [CITIZEN, CSR] on every deployment, and
 * this used to duplicate exactly the citizen-registration dance seed.ts
 * already centralizes.
 *
 * Run:
 *   npx playwright test tests/lifecycle/pgr-sla-auto-escalate.spec.ts
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { seedComplaintAsCitizen } from '../utils/seed';

async function assertOk(resp: Response, ctx: string): Promise<any> {
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`${ctx}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function searchEmployees(token: string, tenantId: string): Promise<any[]> {
  const resp = await fetch(
    `${BASE_URL}/egov-hrms/employees/_search?tenantId=${tenantId}&offset=0&limit=100`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token } }),
    },
  );
  const data: any = await resp.json();
  return data.Employees || [];
}

async function fetchPgrWorkflow(token: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${TENANT}&businessServices=PGR`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token } }),
    },
  );
  const data: any = await resp.json();
  return data.BusinessServices?.[0];
}

async function fetchComplaint(token: string, userInfo: Record<string, unknown>, srid: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${srid}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data: any = await resp.json();
  return data.ServiceWrappers?.[0]?.service;
}

test.describe.serial('PGR SLA auto-escalation (fast)', () => {
  // NOTE: the PGR_FAST_ESCALATION gate lives on test 4 ONLY — see the skip at the
  // top of that test's body.
  //
  // It used to sit here, in the describe body, which in Playwright applies to
  // every test in the group. That silently suppressed tests 1-3 as well, and
  // those three don't depend on escalation TIMING at all: they read a token,
  // read the workflow config, and read HRMS. On a stock deployment they run in
  // a couple of seconds and assert real, load-bearing facts — that
  // ESCALATE@PENDINGATLME grants role SYSTEM (without it the scheduler's
  // SYSTEM-identity transition is rejected) and that HRMS has a reportingTo
  // link (without it scanAndEscalate finds no escalation target). Those are
  // exactly the two ways auto-escalation breaks SILENTLY in production, so
  // reporting them as "skipped" hid the checks that were still worth running.
  // Per the annotation on test 2, a clear FAILURE here is the intended outcome
  // when the prerequisite is missing — it saves the 130 s wait in test 4.

  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let employeeUuid: string;

  test('1 — acquire admin token', {
    annotation: {
      type: 'description',
      description: `Token-acquisition step for the fast SLA auto-escalation test (~2 min total). Only needs the admin token — the complaint itself is filed by seedComplaintAsCitizen() (step 4), which owns its own citizen identity.

Steps:
1. getDigitToken with ROOT_TENANT, ADMIN_USER, ADMIN_PASS; assert access_token truthy.

Trimmed-down sibling of the larger pgr-escalation-api spec — does only the assertions needed to drive a single auto-escalation observation.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const adminResp = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = adminResp.access_token;
    adminUserInfo = adminResp.UserRequest as Record<string, unknown>;
    expect(adminToken).toBeTruthy();
  });

  test('2 — verify ESCALATE allows SYSTEM role on PENDINGATLME', {
    annotation: {
      type: 'description',
      description: `Pre-flight check for the auto-escalation behavior: the workflow's ESCALATE action on PENDINGATLME must include role SYSTEM, otherwise the scheduler can't transition the workflow when SLA breaches. A clear failure here saves a 130-second wait in step 4.

Steps:
1. fetchPgrWorkflow() and assert the BusinessService is found.
2. Locate the PENDINGATLME state.
3. Find action ESCALATE and assert it exists.
4. Assert escalate.roles contains 'SYSTEM' (with a custom failure message that includes the actual roles for diagnostics).

Read-only: this test does not patch the workflow — that's pgr-escalation-api spec's job.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const biz = await fetchPgrWorkflow(adminToken);
    expect(biz).toBeTruthy();
    const pendingAtLme = biz.states.find((s: any) => s.applicationStatus === 'PENDINGATLME');
    const escalate = (pendingAtLme?.actions || []).find((a: any) => a.action === 'ESCALATE');
    expect(escalate, 'ESCALATE action missing on PENDINGATLME').toBeTruthy();
    expect(escalate.roles, `ESCALATE roles do not include SYSTEM (got ${JSON.stringify(escalate.roles)})`)
      .toContain('SYSTEM');
  });

  test('3 — verify HRMS reportingTo chain has at least one link', {
    annotation: {
      type: 'description',
      description: `Pre-flight check #2: the deployment must have at least one HRMS employee whose current assignment has a reportingTo set. Without that, scanAndEscalate() finds no escalation target and the auto-escalation step in 4 would silently never fire.

Steps:
1. searchEmployees(adminToken, TENANT); assert count > 0.
2. Find the first employee whose isCurrentAssignment record has a reportingTo UUID.
3. Assert such an employee exists.
4. Stash subordinate.uuid as employeeUuid for step 4.

Read-only: doesn't patch HRMS — fails fast with a clear error if the deployment isn't seeded with a hierarchy.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const employees = await searchEmployees(adminToken, TENANT);
    expect(employees.length, `No employees found in ${TENANT}`).toBeGreaterThan(0);

    // Find an employee whose current assignment has a reportingTo (i.e. has a supervisor)
    const subordinate = employees.find((e: any) => {
      const a = (e.assignments || []).find((x: any) => x.isCurrentAssignment);
      return a?.reportingTo;
    });
    expect(subordinate, 'No employee with a reportingTo link found in HRMS').toBeTruthy();
    employeeUuid = subordinate.uuid;
  });

  test('4 — auto-escalation: scheduler fires within ~120 s of SLA breach', {
    annotation: {
      type: 'description',
      description: `End-to-end observation: a freshly-assigned complaint should be auto-escalated by pgr-services' scheduler within roughly 120 seconds (60s tick interval + 30s SLA + buffer). This is the test that proves the scheduler is actually running on the deployment.

Steps:
1. setTimeout 160s.
2. seedComplaintAsCitizen() to file as CITIZEN; capture srid.
3. ASSIGN via raw /egov-wf/process/_transition (not PGR _update) so processInstance.assignes is populated — the scheduler depends on this.
4. Poll workflow history every 5s for up to 130s, looking for any ProcessInstance with action=ESCALATE and comment starting "Auto-escalated".
5. Assert escalated === true (with diagnostic message pointing at PGR_ESCALATION_* env vars).
6. Assert level >= 1.
7. fetchComplaint(srid) and assert additionalDetail.escalationLevel >= 1.

Test timeout is 160s because the worst-case wall-clock is ~130s (just-missed scheduler tick + SLA + buffer). If the deployment doesn't have the env config, this is the fastest way to discover that.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    // Timing gate — this test, and ONLY this test, needs fast escalation tuning.
    //
    // The ~130 s poll deadline is meetable only when the scan interval and the
    // SLA are both small. pgr-services' shipped defaults
    // (application.properties: pgr.escalation.interval.ms=300000,
    // pgr.escalation.default.sla.ms=432000000) mean a complaint must sit idle
    // for 5 DAYS before it is even eligible, and the scan runs only every 5
    // minutes — so on a stock deployment this can't pass, by three orders of
    // magnitude, and would be pure red noise.
    //
    // There is no way for the test to force the issue: pgr-services exposes no
    // on-demand escalation endpoint (RequestsApiController is /v2/request/*
    // only), and the escalation Kafka topic is produce-only. The two levers are
    // both deployment-side:
    //   1. env PGR_ESCALATION_INTERVAL_MS / PGR_ESCALATION_DEFAULT_SLA_MS, or
    //   2. an MDMS RAINMAKER-PGR.EscalationConfig record with a small
    //      defaultSlaByLevel / per-serviceCode overrides entry.
    // Even with (2), the floor on the poll deadline is the scan interval, so a
    // deployment that only seeds MDMS still needs the interval lowered too.
    //
    // Opt in with PGR_FAST_ESCALATION=1 once a deployment has done that (mirrors
    // how enc-key-drift-622.spec.ts gates its destructive variant on an env flag).
    test.skip(
      process.env.PGR_FAST_ESCALATION !== '1',
      'Set PGR_FAST_ESCALATION=1 only on a deployment tuned for fast escalation ' +
        '(PGR_ESCALATION_INTERVAL_MS=60000 + PGR_ESCALATION_DEFAULT_SLA_MS=30000, ' +
        'or an MDMS RAINMAKER-PGR.EscalationConfig with a small defaultSlaByLevel). ' +
        'pgr-services defaults (300000 / 432000000 = 5-min scan, 5-day SLA) make the ' +
        '~130s poll deadline unmeetable. Tests 1-3 above still verify the ' +
        'non-timing prerequisites on every deployment.',
    );

    test.setTimeout(160_000);

    // Create a fresh complaint — filed as CITIZEN via seed.ts (APPLY is
    // [CITIZEN, CSR] on every deployment).
    const created = await seedComplaintAsCitizen({ description: `E2E SLA auto-escalate — ${new Date().toISOString()}` });
    const srid = created.srid;
    console.log(`[${srid}] created → ${created.status}`);

    // ASSIGN via raw workflow API so process_instance.assignes is populated
    // (PGR _update wraps self-loops and drops assignes — scheduler then skips the complaint)
    const assignResp = await fetch(`${BASE_URL}/egov-workflow-v2/egov-wf/process/_transition`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        ProcessInstances: [{
          tenantId: TENANT,
          businessService: 'PGR',
          businessId: srid,
          moduleName: 'PGR',
          action: 'ASSIGN',
          comment: 'sla auto-escalate test setup',
          assignes: [{ uuid: employeeUuid }],
        }],
      }),
    });
    await assertOk(assignResp, 'WF ASSIGN (raw)');
    console.log(`[${srid}] assigned to ${employeeUuid}; awaiting SLA breach + scheduler tick`);

    // Poll workflow history for an Auto-escalated entry
    const deadline = Date.now() + 130_000;
    let escalated = false;
    let level = 0;
    let firstEscalateComment = '';
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5_000));
      const histResp = await fetch(
        `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${TENANT}&businessIds=${srid}&history=true`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo } }),
        },
      );
      const histData: any = await histResp.json();
      const auto = (histData.ProcessInstances || [])
        .filter((p: any) => p.action === 'ESCALATE' && (p.comment || '').startsWith('Auto-escalated'));
      if (auto.length > 0) {
        escalated = true;
        level = auto.length;
        firstEscalateComment = auto[0].comment;
        break;
      }
      const remainingS = Math.round((deadline - Date.now()) / 1000);
      if (remainingS % 15 === 0) console.log(`  …polling, ${remainingS}s left`);
    }

    expect(escalated, 'Scheduler did not auto-escalate within 130 s — check pgr-services logs and PGR_ESCALATION_* env vars').toBe(true);
    expect(level).toBeGreaterThanOrEqual(1);
    console.log(`[${srid}] auto-escalated (level=${level}, "${firstEscalateComment}")`);

    const final = await fetchComplaint(adminToken, adminUserInfo, srid);
    expect(final.additionalDetail?.escalationLevel).toBeGreaterThanOrEqual(1);
    console.log(`[${srid}] additionalDetail.escalationLevel=${final.additionalDetail?.escalationLevel}`);
  });
});
