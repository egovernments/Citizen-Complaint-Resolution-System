/**
 * PGR Escalation — API-only
 *
 * Tests the manual escalation workflow using only API calls (no browser):
 *   1. Acquire an admin token
 *   2. Read-only audit of the ESCALATE self-loop workflow contract
 *   3. Ensure employee hierarchy — at least one reportingTo relationship in HRMS
 *   4. Citizen creates complaint
 *   5. Admin assigns complaint to specific employee (one with a supervisor)
 *   6. Manual ESCALATE — level 0→1, reassign to supervisor
 *   7. Verify workflow process instance shows new assignee
 *   8. Second ESCALATE — level 1→2 (skip if no second-level supervisor)
 *   9. Resolve the escalated complaint
 *
 * The employee reportingTo prerequisite is auto-seeded; workflow configuration
 * is never mutated by a test.
 *
 * Deployment-independence notes:
 *  - Complaints are always filed via seed.ts's seedComplaintAsCitizen(), which
 *    files as a CITIZEN — PGR's APPLY action is [CITIZEN, CSR] on every
 *    deployment, so an ADMIN token 400s "INVALID ROLE" on bomet. This used to
 *    register its own throwaway citizen via the OTP flow; that's exactly what
 *    seedComplaintAsCitizen() already does (against the shared per-run fixture),
 *    so the bespoke registerCitizen() was pure duplication.
 *  - ASSIGN sets workflow.assignes. ESCALATE deliberately omits it: the backend
 *    resolves reportingTo and owns the target and escalation metadata. The
 *    hierarchy fixture uses employees in the complaint department so every hop
 *    remains visible and actionable.
 *
 * Run: npx playwright test tests/api/pgr-escalation.spec.ts
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { PERSONA_KEYS, resolvePersona, resolveSeedPlan, type ResolvedPersona } from '../utils/personas';
import { getProfile } from '../utils/profile';
import { seedComplaintAsCitizen } from '../utils/seed';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Fetch the full PGR service object (needed for _update calls). */
async function fetchComplaint(token: string, userInfo: Record<string, unknown>, serviceRequestId: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data: any = await resp.json();
  const service = data.ServiceWrappers?.[0]?.service;
  if (!service) {
    throw new Error(
      `pgr _search for ${serviceRequestId} at ${TENANT} returned no complaint (HTTP ${resp.status}) for ` +
        `${String(userInfo?.userName ?? 'this caller')}: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  return service;
}

/** A signed-in principal: the token and userInfo every PGR call carries. */
type Principal = { token: string; userInfo: Record<string, unknown>; username?: string };

/** POST pgr _update as `who`, re-reading the full service object as that same person first. */
async function pgrUpdate(who: Principal, serviceRequestId: string, workflow: Record<string, unknown>): Promise<Response> {
  const service = await fetchComplaint(who.token, who.userInfo, serviceRequestId);
  return fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: who.token, userInfo: who.userInfo }, service, workflow }),
  });
}

/**
 * The suite's credentials for the employee with this uuid, or null. Only the
 * personas profile-setup resolved (env-named logins) are signable; any other
 * HRMS employee is real staff whose password the suite does not have.
 */
async function signableAs(uuid: string, also: ResolvedPersona[] = []): Promise<ResolvedPersona | null> {
  const known = also.find((p) => p.uuid === uuid);
  if (known) return known;
  const resolved = getProfile().personas.resolved;
  for (const key of PERSONA_KEYS) {
    if (resolved[key]?.uuid !== uuid) continue;
    const p = await resolvePersona(key).catch(() => null);
    if (p?.uuid === uuid) return p;
  }
  return null;
}

/** The DIGIT platform admin employee (code/userName ADMIN) or the suite's own admin login. */
const isPlatformAdmin = (e: any) =>
  String(e.code ?? '').toUpperCase() === 'ADMIN' ||
  String(e.user?.userName ?? '').toUpperCase() === 'ADMIN' ||
  e.user?.userName === ADMIN_USER;

/** Search HRMS employees for a tenant. */
async function searchEmployees(token: string, tenantId: string): Promise<any[]> {
  // Paged: a single limit=100 read silently truncates on tenants with real
  // staffing history (bomet holds 345 employee records), and the seed plan's
  // assignee then "doesn't exist" purely because it sits past page one.
  const PAGE = 100;
  // Ceiling is a tripwire, not a quiet cap — silently stopping would recreate
  // the very truncation bug this replaces, just further out. Largest known
  // pool: bomet ke at 345 records.
  const HARD_CEILING = 2000;
  const out: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const resp = await fetch(
      `${BASE_URL}/egov-hrms/employees/_search?tenantId=${tenantId}&offset=${offset}&limit=${PAGE}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token } }),
      },
    );
    const batch: any[] = ((await resp.json()) as any).Employees || [];
    out.push(...batch);
    if (batch.length < PAGE) break;
    if (out.length >= HARD_CEILING) {
      throw new Error(
        `searchEmployees: hit the ${HARD_CEILING}-record ceiling on ${tenantId} with a full page still coming — raise HARD_CEILING`,
      );
    }
  }
  return out;
}

/** Search workflow process instances for a businessId. */
async function searchWorkflowHistory(
  token: string, userInfo: Record<string, unknown>,
  businessId: string, tenantId: string,
): Promise<any[]> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${tenantId}&businessIds=${businessId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data: any = await resp.json();
  return data.ProcessInstances || [];
}

/** Fetch the PGR business service config. */
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

/** Assert a fetch response is ok; if not, throw with the response body for diagnostics. */
async function assertOk(resp: Response, context: string): Promise<any> {
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`${context}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workflow audits (tests 2 and 14)
//
// Read-only checks of the deployment's PGR BusinessService. Same describe
// title as the lifecycle block, so their full titles are unchanged, but NOT
// serial: in the serial block a drifted workflow (bomet ke still carries the
// legacy PENDINGATSUPERVISOR tier) failed test 2 and skipped steps 3-14 with
// it, although none of them needs the audit to pass — the escalation chain is
// gated on prerequisitesMet (test 3), and the self-loop it walks is checked by
// the ESCALATE calls themselves.
// ---------------------------------------------------------------------------

test.describe('PGR escalation — API only', () => {
  const auditToken = async () =>
    (await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS })).access_token;

  test('2 — ensure PGR workflow uses only ESCALATE self-loops', {
    annotation: {
      type: 'description',
      description: `Read-only audit of the deployed PGR workflow against the one-flow escalation contract.

Steps:
1. Assert ESCALATE is a self-loop on PENDINGATLME (since 93fb577bb the scheduler escalates only PENDINGATLME — pgr.escalation.eligible.statuses — and the onboarding baseline workflow defines no ESCALATE on PENDINGFORASSIGNMENT).
2. Assert SYSTEM is authorized for that self-loop.
3. Assert FORWARD and ASSIGNEDBYAUTOESCALATION actions are absent.
4. Assert PENDINGATSUPERVISOR and RESOLVEDBYSUPERVISOR are absent.
5. Fail on drift. Workflow migration is a deployment operation and this test never mutates live configuration.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {

    const biz = await fetchPgrWorkflow(await auditToken());
    expect(biz).toBeTruthy();

    const findState = (status: string) => biz.states.find((s: any) => s.applicationStatus === status);
    const pendingAtLme = findState('PENDINGATLME');
    const pendingForAssign = findState('PENDINGFORASSIGNMENT');
    expect(pendingAtLme).toBeTruthy();
    expect(pendingForAssign).toBeTruthy();

    const verifyBiz = biz;
    const vFind = (status: string) => verifyBiz.states.find((s: any) => s.applicationStatus === status);
    const vAtLme = pendingAtLme;
    const vForAssign = pendingForAssign;
    const vEscAtLme = (vAtLme.actions || []).find((a: any) => a.action === 'ESCALATE');
    expect(vEscAtLme?.nextState).toBe(vAtLme.uuid);
    expect(vEscAtLme?.roles).toContain('SYSTEM');
    expect((vAtLme.actions || []).some((a: any) => a.action === 'FORWARD')).toBe(false);
    expect((vForAssign.actions || []).some((a: any) => a.action === 'ASSIGNEDBYAUTOESCALATION')).toBe(false);
    expect(vFind('PENDINGATSUPERVISOR')).toBeFalsy();
    expect(vFind('RESOLVEDBYSUPERVISOR')).toBeFalsy();

    console.log('PGR workflow self-loop contract verified');
  });

  test('14 — audit: PGR workflow config matches the shipped seed', {
    annotation: {
      type: 'description',
      description: `Audits the deployed PGR businessService against the single-flow seed:

1. Every action's nextState resolves to a state that exists.
2. ESCALATE is a self-loop on both supported states.
3. No active supervisor-tier state or legacy auto-escalation action remains.

Deliberately OUTSIDE the serial block, like test 2. These are audits of the deployment's configuration, not preconditions for the escalation chain — gating tests 3-13 on them would trade 11 tests' worth of real coverage for a finding that blocks nothing. (Inside the serial block, a failed audit skipped every later step, and a failure before it meant it never ran.)

This is the final guard against workflow/source drift.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:api', '@persona:cross'] }, async () => {
    const biz = await fetchPgrWorkflow(await auditToken());

    const stateUuids = new Set(biz.states.map((s: any) => s.uuid));
    const dangling: string[] = [];
    for (const st of biz.states) {
      for (const act of st.actions || []) {
        if (act.nextState && !stateUuids.has(act.nextState)) {
          dangling.push(`${st.applicationStatus} --${act.action}--> ${act.nextState}`);
        }
      }
    }
    expect(
      dangling,
      `PGR workflow has transitions pointing at non-existent states:\n  ${dangling.join('\n  ')}`,
    ).toEqual([]);

    const atLme = biz.states.find((s: any) => s.applicationStatus === 'PENDINGATLME');
    const forAssignment = biz.states.find((s: any) => s.applicationStatus === 'PENDINGFORASSIGNMENT');
    const escAtLme = (atLme?.actions || []).find((a: any) => a.action === 'ESCALATE');
    const escTarget = biz.states.find((s: any) => s.uuid === escAtLme?.nextState);
    // Since 93fb577bb automatic escalation is PENDINGATLME only (eligible.statuses,
    // EscalationConfig, platform baseline), so the shipped seed no longer carries
    // an ESCALATE on PENDINGFORASSIGNMENT; only the LME self-loop is audited.
    expect(escTarget?.applicationStatus).toBe('PENDINGATLME');
    expect(biz.states.some((s: any) => s.applicationStatus === 'PENDINGATSUPERVISOR')).toBe(false);
    expect(biz.states.some((s: any) => s.applicationStatus === 'RESOLVEDBYSUPERVISOR')).toBe(false);
    expect((atLme.actions || []).some((a: any) => a.action === 'FORWARD')).toBe(false);
    expect((forAssignment.actions || []).some((a: any) => a.action === 'ASSIGNEDBYAUTOESCALATION')).toBe(false);
  });
});

test.describe.serial('PGR escalation — API only', () => {
  // The configurator admin reads and writes HRMS only (tests 1 and 3). Under
  // v2.20 it holds no PGR role, so every complaint step acts as the person the
  // workflow requires, discovered at runtime: ASSIGN as the seed plan's actor,
  // ESCALATE/RESOLVE as whoever currently holds the complaint (#2129).
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  /** resolveSeedPlan().actor: holds an ASSIGN role (GRO or PGR_VIEWER on the shipped workflow). */
  let actor: ResolvedPersona;
  /** The subordinate (the plan's assignee) signed in; ESCALATEs as the first holder. */
  let holder: ResolvedPersona;
  /** The supervisor signed in, when the suite has its credentials; null otherwise. */
  let supervisorPersona: ResolvedPersona | null = null;
  let serviceRequestId: string;
  let employeeUuid: string;
  let supervisorUuid: string;
  let secondSupervisorUuid: string | null = null;
  /** Test 8's second hop landed, so the second-level supervisor holds the complaint. */
  let secondEscalated = false;
  let allEmployees: any[] = [];
  /** Set to true when prerequisites (workflow + hierarchy) are confirmed. */
  let prerequisitesMet = false;
  /** Why test 3 could not build the hierarchy; every gated step skips with it. */
  let prerequisitesMissing = 'Prerequisites not met: test 3 (HRMS reportingTo hierarchy) did not complete';
  /** ESCALATE is a self-loop, so the only valid landing state is PENDINGATLME. */
  let escalateNextStateFromLme = 'PENDINGATLME';

  test('1 — acquire admin token', {
    annotation: {
      type: 'description',
      description: `Token-acquisition step for the API-only PGR escalation lifecycle. Every complaint this suite files goes through seedComplaintAsCitizen() (tests 4/10/13), which owns its own citizen identity — this step only needs the admin token for the HRMS reads and the one reportingTo write in test 3. Complaint steps act as workflow personas (ASSIGN as the seed plan's actor, ESCALATE/RESOLVE as the holder): under v2.20 the configurator admin holds no PGR role.

Steps:
1. getDigitToken with ROOT_TENANT, ADMIN_USER, ADMIN_PASS; assert access_token is truthy.
2. Stash adminToken and adminUserInfo.

First link in a serial chain — every later step is gated on prerequisitesMet, which is set by step 3.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const adminResp = await getDigitToken({
      tenant: ROOT_TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });
    expect(adminResp.access_token).toBeTruthy();
    adminToken = adminResp.access_token;
    adminUserInfo = adminResp.UserRequest as Record<string, unknown>;
    console.log('Admin token acquired');
  });

  test('3 — ensure 2-level employee hierarchy (reportingTo) in HRMS', {
    annotation: {
      type: 'description',
      description: `Builds (idempotently) the 2-level employee hierarchy that escalation walks: subordinate → supervisor → super-supervisor. Every link uses the same department so the reporting chain remains operationally valid. Sets prerequisitesMet so later tests can skip cleanly when the deployment cannot supply enough employees.

Steps:
1. searchEmployees(adminToken, TENANT); assert count > 0.
2. resolveSeedPlan() — the (serviceCode, assignee) pair PGR's department check will actually accept. test.skip with the plan's own error if it can't be resolved.
3. Look up that serviceCode's department in the profile's complaint-type catalogue.
4. Filter employees (excluding ADMIN) down to ones holding that department in any HRMS assignment; find the plan's assignee within that set as the anchor (subordinate).
5. Pick the supervisor: the subordinate's existing reportingTo when it is in that set, otherwise the first other same-department employee; test.skip if there is none.
6. Call ensureReportingTo(subordinate, supervisor.uuid) — patches via HRMS _update only if not already set. Only the subordinate (the suite's own assignee persona) is ever written; real staff records are read only.
7. The second level is whatever the supervisor's record already says (test 8 skips when it has none).
8. Stash employeeUuid + supervisorUuid; refresh allEmployees so subsequent tests see updated reportingTo.
9. Set prerequisitesMet = true.

If this fails due to insufficient same-department employees, downstream escalation tests skip rather than producing red noise (or, worse, a false pass by escalating to an incompatible department).`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    allEmployees = await searchEmployees(adminToken, TENANT);
    expect(allEmployees.length).toBeGreaterThan(0);
    console.log(`Found ${allEmployees.length} employees in ${TENANT}`);

    const plan = await resolveSeedPlan();
    if ('error' in plan) {
      prerequisitesMissing = `Cannot build an escalation hierarchy: ${plan.error}`;
      test.skip(true, prerequisitesMissing);
      return;
    }
    const department = getProfile().complaintTypes.services.find((s) => s.serviceCode === plan.serviceCode)?.department;

    // Non-ADMIN employees sharing SERVICE_CODE's department — the pool every
    // hop of the chain (not just the leaf) must be drawn from, since PGR
    // re-validates the department on every assignee change (ASSIGN AND each
    // ESCALATE self-loop), not only the first ASSIGN.
    // ADMIN_USER is a Keycloak email on v2.20, so comparing userName to it alone
    // let the DIGIT `ADMIN` employee ("Super ADMIN User") in as a supervisor.
    const deptCandidates = allEmployees.filter(
      (e: any) => !isPlatformAdmin(e) && (e.assignments || []).some((a: any) => a.department === department),
    );
    // Keep suite-created scratch employees OUT of the hierarchy. They match on
    // department just like real staff, but other specs deactivate them mid-run
    // (admin/employees "5. deactivate"), and HRMS keeps the now-dangling
    // reportingTo. The escalation then targets a uuid that resolves to nothing:
    //     PGR ESCALATE: 400 INVALID UUID "User not found for uuid: d9a0c378-..."
    // Observed directly — after a run, PGGRO1's reportingTo pointed at
    // PW_9C341439_EMPROLE instead of the seeded PGLME2.
    // The subordinate itself is exempt: it is fixed by resolveSeedPlan(), and
    // dropping it here would skip the whole chain rather than fix it.
    const SCRATCH_EMP = /(^|[._])PW[A-Z_]/i;
    const isScratch = (e: any) =>
      SCRATCH_EMP.test(String(e.code ?? '')) || SCRATCH_EMP.test(String(e.user?.userName ?? ''));
    const realCandidates = deptCandidates.filter(
      (e: any) => !isScratch(e) || e.uuid === plan.assigneeUuid,
    );
    // Fall back to the unfiltered pool only if the deployment genuinely lacks
    // three real same-department employees — a scratch supervisor is still
    // better than skipping, it is just less stable.
    const pool = realCandidates.length >= 3 ? realCandidates : deptCandidates;

    const subordinate = pool.find((e: any) => e.uuid === plan.assigneeUuid);
    if (!subordinate) {
      test.skip(
        true,
        `resolveSeedPlan() picked assignee ${plan.assigneeCode} (department '${department}') but it wasn't found ` +
          `re-searching HRMS at ${TENANT} — possible discovery/HRMS state mismatch`,
      );
      return;
    }
    const others = pool.filter((e: any) => e.uuid !== plan.assigneeUuid);
    // Only the subordinate's record is ever written: it is the seed plan's
    // assignee, a persona this suite signs in as. Other employees are real staff;
    // their reporting lines are read, never rewritten (a supervisor without one
    // simply ends the chain, and test 8 skips the second hop).
    // ESCALATE makes the supervisor the assignee, so it must be an active
    // employee holding a role that can act on PENDINGATLME (egov-workflow-v2
    // refuses other assignees). Among those, prefer one the suite can sign in
    // as (it can then take the later hops), then the subordinate's current
    // reportingTo, then the first.
    const assigneeRoles = (getProfile().workflow.pgr.assign?.assigneeRoles ?? []).filter((r) => r !== 'CITIZEN' && r !== 'SYSTEM');
    const canHold = (e: any) =>
      e.isActive !== false && e.user?.active !== false &&
      (e.user?.roles || []).some((r: any) => assigneeRoles.includes(r.code));
    const holdable = others.filter(canHold);
    const current = (subordinate.assignments || []).find((a: any) => a.isCurrentAssignment)?.reportingTo;
    const signableUuids = new Set(Object.values(getProfile().personas.resolved).map((p) => p?.uuid).filter(Boolean));
    const supervisor =
      holdable.find((e: any) => signableUuids.has(e.uuid)) ?? holdable.find((e: any) => e.uuid === current) ?? holdable[0];
    if (!supervisor) {
      test.skip(
        true,
        `Need another active employee in department '${department}' (SERVICE_CODE=${plan.serviceCode}'s department) holding ` +
          `one of [${assigneeRoles.join(', ')}] besides the seed-plan assignee ${plan.assigneeCode} to escalate to — found ` +
          `${holdable.length} of ${others.length} others (${deptCandidates.length} total in department)`,
      );
      return;
    }
    const subordinatePersona = await signableAs(subordinate.uuid, [plan.actor]);
    if (!subordinatePersona) {
      prerequisitesMissing =
        `The seed-plan assignee ${plan.assigneeCode} has no credentials in this suite, so nobody can ESCALATE as its holder ` +
        '(v2.20 escalation is holder-only, #2129). Point a persona env var at it.';
      test.skip(true, prerequisitesMissing);
      return;
    }

    // Helper to set reportingTo on an employee's current assignment (idempotent)
    async function ensureReportingTo(emp: any, reportingToUuid: string): Promise<boolean> {
      const assignment = (emp.assignments || []).find((a: any) => a.isCurrentAssignment);
      if (!assignment) return false;
      if (assignment.reportingTo === reportingToUuid) return true; // already set

      assignment.reportingTo = reportingToUuid;
      const resp = await fetch(
        `${BASE_URL}/egov-hrms/employees/_update?tenantId=${TENANT}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
            Employees: [emp],
          }),
        },
      );
      const result = await assertOk(resp, `HRMS _update reportingTo for ${emp.user?.name}`);
      const updated = result.Employees?.[0];
      const updatedAssign = (updated?.assignments || []).find((a: any) => a.isCurrentAssignment);
      return updatedAssign?.reportingTo === reportingToUuid;
    }

    // Level 1: subordinate → supervisor
    const l1Ok = await ensureReportingTo(subordinate, supervisor.uuid);
    expect(l1Ok).toBe(true);
    console.log(`Level 1: ${subordinate.user?.name} → ${supervisor.user?.name}`);

    // Level 2 is whatever the supervisor's own record already says (test 8).

    employeeUuid = subordinate.uuid;
    supervisorUuid = supervisor.uuid;
    actor = plan.actor;
    holder = subordinatePersona;
    supervisorPersona = await signableAs(supervisor.uuid, [plan.actor]);
    console.log(
      `Actors: ASSIGN as ${actor.username}; ESCALATE as ${holder.username}; supervisor ${supervisor.code} ` +
        (supervisorPersona ? `signs in as ${supervisorPersona.username}` : 'has no suite credentials'),
    );
    prerequisitesMet = true;

    // Refresh employee list so later tests see the updated reportingTo
    allEmployees = await searchEmployees(adminToken, TENANT);
    console.log(`Reporting chain ready: ${subordinate.user?.name} → ${supervisor.user?.name}`);
  });

  test('4 — citizen creates complaint', {
    annotation: {
      type: 'description',
      description: `Creates the first complaint for the escalation lifecycle via seed.ts's seedComplaintAsCitizen(), which files as a CITIZEN with resolveSeedPlan()'s serviceCode/localityCode — the same plan test 3 anchored the reportingTo hierarchy on, so the complaint's department matches every assignee in the chain. Gates on prerequisitesMet so the run skips cleanly if the workflow patch or HRMS hierarchy didn't land.

Steps:
1. test.skip if !prerequisitesMet.
2. seedComplaintAsCitizen({ description }) — files as CITIZEN (APPLY is [CITIZEN, CSR] on every deployment).
3. Assert status === 'PENDINGFORASSIGNMENT'.

Stashes serviceRequestId for the assign + escalate steps.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, prerequisitesMissing);

    const created = await seedComplaintAsCitizen({ description: `E2E escalation test — ${new Date().toISOString()}` });
    serviceRequestId = created.srid;
    expect(created.status).toBe('PENDINGFORASSIGNMENT');
    console.log(`Complaint created: ${serviceRequestId} → PENDINGFORASSIGNMENT`);
  });

  test('5 — admin assigns complaint to specific employee', {
    annotation: {
      type: 'description',
      description: `Assigns the freshly-created complaint to the subordinate employee (the one with a supervisor) so the next step has a meaningful escalation target. Specifically passes assignees: [employeeUuid] in the workflow payload — generic ASSIGN without an assignee would route to a default queue and the escalate-to-supervisor step would lose context.

Steps:
1. test.skip if !prerequisitesMet.
2. fetchComplaint() to get the full service object.
3. POST /pgr-services/v2/request/_update?tenantId=... as resolveSeedPlan().actor (an ASSIGN role holder).
4. Workflow body: { action: 'ASSIGN', assignes: [employeeUuid], comments }.
5. Assert applicationStatus === 'PENDINGATLME'.

Sets up the situation needed for the level 0→1 escalation in step 6.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, prerequisitesMissing);
    // ASSIGN as the seed plan's actor: the configurator admin holds no PGR role.
    const resp = await pgrUpdate(actor, serviceRequestId, {
      action: 'ASSIGN',
      assignes: [employeeUuid],
      comments: 'Assigned to employee with supervisor for escalation test',
    });

    const data = await assertOk(resp, `PGR ASSIGN as ${actor.username}`);
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    console.log(`${serviceRequestId} → PENDINGATLME (assigned to ${employeeUuid})`);
  });

  test('6 — manual ESCALATE level 0→1', {
    annotation: {
      type: 'description',
      description: `Drives a manual ESCALATE on PENDINGATLME — a self-loop that routes the complaint up to the supervisor and writes escalation metadata into additionalDetail (singular — Jackson silently drops unknown keys, so plural additionalDetails would be lost).

Steps:
1. test.skip if !prerequisitesMet.
2. fetchComplaint() to get the full service object.
3. POST _update as the holder (the subordinate persona; escalation is holder-only, #2129) with workflow { action: 'ESCALATE', comments }; the server resolves reportingTo.
4. Assert applicationStatus stays at PENDINGATLME (it's a self-loop).
5. Assert the server wrote level, assignee, trigger, and assignment-clock metadata.

Catches Jackson silently-dropped-key bugs and confirms the self-loop preserves status while updating assignee + metadata.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, prerequisitesMissing);
    // ESCALATE as the holder (the subordinate): v2.20 offers escalation to the
    // complaint's current holder only (#2129).
    const resp = await pgrUpdate(holder, serviceRequestId, {
      action: 'ESCALATE',
      comments: 'Manual escalation test — level 0→1',
    });

    const data = await assertOk(resp, `PGR ESCALATE (level 0→1) as ${holder.username}`);
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe(escalateNextStateFromLme);
    const updatedDetail = data.ServiceWrappers[0].service.additionalDetail || {};
    expect(updatedDetail.escalationLevel).toBe(1);
    expect(updatedDetail.escalatedFrom).toContain(employeeUuid);
    expect(updatedDetail.escalatedTo).toBe(supervisorUuid);
    expect(updatedDetail.escalationTrigger).toBe('MANUAL');
    expect(updatedDetail.assignmentChangedAt).toBe(updatedDetail.lastEscalatedAt);
    console.log(`${serviceRequestId} → ESCALATED to ${supervisorUuid} (level 1)`);
  });

  test('7 — verify escalation: workflow action + PGR assignee', {
    annotation: {
      type: 'description',
      description: `Cross-checks the escalation from two angles: workflow service history must show ESCALATE as the latest action, and the PGR ServiceWrapper must list the supervisor as the current assignee. Fault-tolerant: ESCALATE self-loops sometimes don't populate processInstance.assignes, so the test falls back to the wrapper.workflow.assignes array.

Steps:
1. test.skip if !prerequisitesMet.
2. searchWorkflowHistory as the ASSIGN actor (serviceRequestId, TENANT); assert ProcessInstances.length > 0.
3. Pick latest = processInstances[0]; assert latest.action === 'ESCALATE'.
4. Search PGR by serviceRequestId; pull wrapper = ServiceWrappers[0].
5. Read wrapper.workflow.assignes; if non-empty, assert it contains supervisorUuid.
6. Otherwise fall back to latest.assignes; if non-empty, assert it contains supervisorUuid.

Loose-but-correct assertions because ESCALATE self-loops emit assignes inconsistently across DIGIT versions.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, prerequisitesMissing);

    // Verify workflow history records the ESCALATE action
    // Read as the ASSIGN actor: it routes this department's complaints in this
    // ward, so its PGR scope covers the complaint after it changes hands.
    const processInstances = await searchWorkflowHistory(actor.token, actor.userInfo, serviceRequestId, TENANT);
    expect(processInstances.length).toBeGreaterThan(0);
    const latest = processInstances[0];
    expect(latest.action).toBe('ESCALATE');
    console.log(`Workflow confirms ESCALATE action (state: ${latest.state?.applicationStatus})`);

    // Verify the PGR service object's current assignee is the supervisor.
    // Self-loop workflow transitions may not populate process instance assignees,
    // but PGR stores the assignee change on the ServiceWrapper.
    const resp = await fetch(
      `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: actor.token, userInfo: actor.userInfo } }),
      },
    );
    const data: any = await resp.json();
    const wrapper = data.ServiceWrappers?.[0];
    expect(wrapper, `${actor.username} could not read ${serviceRequestId} back after the escalation: ${JSON.stringify(data).slice(0, 300)}`).toBeTruthy();

    // The assignee should be the supervisor. Two sources can carry it: the PGR
    // wrapper's workflow.assignes and the latest process-instance's assignes.
    // Now that the ASSIGN/ESCALATE payloads send the correctly-spelled `assignes`
    // key (the Workflow POJO binds `assignes`, not `assignees`), at least one of
    // these MUST be populated and MUST contain the supervisor. Previously the
    // dropped key left both empty and this test soft-passed without asserting.
    const wfAssignees = (wrapper.workflow?.assignes || []).map((a: any) => typeof a === 'string' ? a : a.uuid);
    const piAssignees = (latest.assignes || []).map((a: any) => a.uuid);
    const allAssignees = [...wfAssignees, ...piAssignees];
    expect(
      allAssignees,
      `ESCALATE recorded no assignee — expected supervisor ${supervisorUuid} in wrapper.workflow.assignes (${JSON.stringify(wfAssignees)}) or process-instance.assignes (${JSON.stringify(piAssignees)})`,
    ).toContain(supervisorUuid);
    console.log(`Escalation assignee confirmed: supervisor ${supervisorUuid} (wrapper=${wfAssignees.length}, processInstance=${piAssignees.length})`);
  });

  test('8 — second ESCALATE level 1→2 (skip if no second-level supervisor)', {
    annotation: {
      type: 'description',
      description: `Walks the reportingTo chain a second hop: from supervisor up to super-supervisor. Skips gracefully if the supervisor has no reportingTo (e.g. they're the top of the chain) — escalation must not fail in environments with shallower hierarchies.

Steps:
1. test.skip if !prerequisitesMet.
2. Look up the supervisor in allEmployees; read their current assignment's reportingTo into secondSupervisorUuid.
3. test.skip if reportingTo is null or the UUID is not in the employee list, or if the suite cannot sign in as the supervisor (the holder now).
4. POST _update as the supervisor with workflow { action: 'ESCALATE', comments }; the server resolves the second hop.
5. Assert the state is unchanged and server-managed escalationLevel is 2.

The skip cases are first-class outcomes — the suite is designed to pass on a 2-level OR 3+ level hierarchy.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, prerequisitesMissing);

    // Look up the supervisor's reportingTo
    const supervisorEmp = allEmployees.find((e: any) => e.uuid === supervisorUuid);
    const supAssignment = (supervisorEmp?.assignments || []).find((a: any) => a.isCurrentAssignment);
    secondSupervisorUuid = supAssignment?.reportingTo || null;

    if (!secondSupervisorUuid) {
      console.log('Supervisor has no reportingTo — skipping second escalation');
      test.skip(true, 'No second-level supervisor in HRMS hierarchy');
      return;
    }

    const secondSupervisor = allEmployees.find((e: any) => e.uuid === secondSupervisorUuid);
    if (!secondSupervisor) {
      console.log(`Second-level supervisor ${secondSupervisorUuid} not found in employee list`);
      test.skip(true, 'Second-level supervisor UUID not found in employee list');
      return;
    }

    // The supervisor holds the complaint now, and only the holder may escalate it.
    test.skip(
      !supervisorPersona,
      `The supervisor (${supervisorUuid}) now holds the complaint and only the holder can ESCALATE it (#2129), but ` +
        'the suite has no credentials for that employee. Point a persona env var at a supervisor to cover the second hop.',
    );
    const resp = await pgrUpdate(supervisorPersona!, serviceRequestId, {
      action: 'ESCALATE',
      comments: 'Manual escalation test — level 1→2',
    });

    const data = await assertOk(resp, `PGR ESCALATE (level 1→2) as ${supervisorPersona!.username}`);
    // Every hop is the same PENDINGATLME self-loop.
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe(escalateNextStateFromLme);
    // Verify escalation metadata persisted through _update (singular field)
    const updatedDetail = data.ServiceWrappers[0].service.additionalDetail || {};
    expect(updatedDetail.escalationLevel).toBe(2);
    secondEscalated = true;
    console.log(`${serviceRequestId} → ESCALATED to ${secondSupervisorUuid} (level 2, escalationLevel=${updatedDetail.escalationLevel})`);
  });

  test('9 — resolve the escalated complaint', {
    annotation: {
      type: 'description',
      description: `Closes the escalation lifecycle by resolving the complaint and asserting the escalation metadata survived through the RESOLVE transition. PGR's POJO uses the singular additionalDetail field; this test confirms it isn't blanked when the workflow leaves PENDINGATLME for RESOLVED.

Steps:
1. test.skip if !prerequisitesMet.
2. fetchComplaint() to get the full service object.
3. POST _update as the current holder (the supervisor, or the second-level supervisor after test 8) with workflow { action: 'RESOLVE', comments }; test.skip when the suite has no credentials for that employee.
4. Assert applicationStatus === 'RESOLVED'.
5. Assert additionalDetail.escalationLevel >= 1 (the escalation history is preserved).

Catches a regression where a transition implementation overwrites or strips additionalDetail and loses the escalation audit trail.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, prerequisitesMissing);
    // RESOLVE as whoever holds the complaint after the escalations: the second-
    // level supervisor when test 8 ran, otherwise the first supervisor.
    const holderUuid = secondEscalated ? secondSupervisorUuid! : supervisorUuid;
    const resolver = await signableAs(holderUuid, [actor, holder, ...(supervisorPersona ? [supervisorPersona] : [])]);
    test.skip(
      !resolver,
      `After escalation the complaint is held by ${holderUuid}, and the suite has no credentials for that employee ` +
        'to RESOLVE as the holder. Point a persona env var at the supervisor to cover this step.',
    );
    const resp = await pgrUpdate(resolver!, serviceRequestId, {
      action: 'RESOLVE',
      comments: 'Resolved after escalation — E2E test',
    });

    const data = await assertOk(resp, `PGR RESOLVE as ${resolver!.username}`);
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('RESOLVED');

    // Verify escalation metadata persists through the resolve transition.
    // PGR POJO uses `additionalDetail` (singular). Previous ESCALATE calls
    // wrote escalationLevel into this field; it should still be present.
    const resolvedService = data.ServiceWrappers[0].service;
    const detail = resolvedService.additionalDetail || {};
    expect(detail.escalationLevel).toBeGreaterThanOrEqual(1);
    console.log(`${serviceRequestId} → RESOLVED (escalationLevel: ${detail.escalationLevel})`);
  });

  // -----------------------------------------------------------------------
  // Unassigned complaint behavior (tests 10–12). ESCALATE may exist as a
  // self-loop on the state, but the domain operation requires a current
  // assignee. Initial routing is ASSIGN, never escalation.
  // -----------------------------------------------------------------------
  let pfaComplaintId: string;

  test('10 — citizen creates an unassigned PENDINGFORASSIGNMENT complaint', {
    annotation: {
      type: 'description',
      description: `Creates a fresh complaint for the explicit no-assignee case. Unassigned complaints must use ASSIGN and cannot be escalated.

Steps:
1. test.skip if !prerequisitesMet.
2. seedComplaintAsCitizen({ description }).
3. Assert status === 'PENDINGFORASSIGNMENT'.

Stashes pfaComplaintId for the PFA-escalate + cleanup steps (11 and 12).`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, prerequisitesMissing);
    const created = await seedComplaintAsCitizen({ description: `E2E PFA-escalate — ${new Date().toISOString()}` });
    pfaComplaintId = created.srid;
    expect(created.status).toBe('PENDINGFORASSIGNMENT');
    console.log(`Third complaint created: ${pfaComplaintId} → PENDINGFORASSIGNMENT`);
  });

  test('11 — ESCALATE rejects an unassigned complaint', {
    annotation: {
      type: 'description',
      description: `Asserts the domain guard behind the workflow self-loop: without a current workflow assignee there is no reportingTo edge to follow.

Steps:
1. test.skip if !prerequisitesMet.
2. POST _update with workflow { action: 'ESCALATE', comments }.
3. Assert the request is rejected and the complaint remains PENDINGFORASSIGNMENT at depth 0.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, prerequisitesMissing);
    // As the actor, who can see and route this complaint: the refusal must come
    // from the missing assignee, not from a caller that cannot reach it at all.
    const resp = await pgrUpdate(actor, pfaComplaintId, {
      action: 'ESCALATE',
      comments: 'This must fail because the complaint is unassigned',
    });
    const refusal = await resp.text();
    console.log(`ESCALATE on unassigned ${pfaComplaintId}: HTTP ${resp.status} ${refusal.slice(0, 300)}`);
    expect(resp.ok).toBe(false);
    // EscalationService.prepareEscalation's own guard, not an authorization or
    // workflow refusal that would pass this test for the wrong reason.
    expect(refusal, 'ESCALATE on an unassigned complaint must be refused by the no-assignee guard').toContain('ESCALATION_NO_ASSIGNEE');
    const after = await fetchComplaint(actor.token, actor.userInfo, pfaComplaintId);
    expect(after.applicationStatus).toBe('PENDINGFORASSIGNMENT');
    expect(after.additionalDetail?.escalationLevel || 0).toBe(0);
  });

  test('12 — cleanup: assign and resolve the unassigned-case complaint', {
    annotation: {
      type: 'description',
      description: `Drains the unassigned-case complaint to RESOLVED and verifies ASSIGN records assignment audit metadata and hierarchy baseline.

Steps:
1. test.skip if !prerequisitesMet.
2. As the ASSIGN actor, POST _update with workflow { action: 'ASSIGN', assignes: [employeeUuid], comments }; assert applicationStatus === 'PENDINGATLME'.
3. As the subordinate (now the holder), POST _update with workflow { action: 'RESOLVE', comments: 'Cleanup resolve' }; assert applicationStatus === 'RESOLVED'.
4. Assert additionalDetail.escalationLevel === 0 and assignmentChangedAt is present.

Teardown is API-only because PGR has no UI delete affordance — the cleanup is by transitioning to terminal state.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, prerequisitesMissing);
    // Assign as the actor, resolve as the holder it was assigned to.
    let resp = await pgrUpdate(actor, pfaComplaintId, {
      action: 'ASSIGN', assignes: [employeeUuid], comments: 'Assigning unassigned-case complaint',
    });
    let data = await assertOk(resp, `PGR ASSIGN (pfa cleanup) as ${actor.username}`);
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');

    resp = await pgrUpdate(holder, pfaComplaintId, { action: 'RESOLVE', comments: 'Cleanup resolve' });
    data = await assertOk(resp, `PGR RESOLVE (pfa cleanup) as ${holder.username}`);
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('RESOLVED');
    expect(data.ServiceWrappers[0].service.additionalDetail?.escalationLevel).toBe(0);
    expect(data.ServiceWrappers[0].service.additionalDetail?.assignmentChangedAt).toBeTruthy();
    console.log(`${pfaComplaintId} → RESOLVED after ordinary ASSIGN`);
  });

  // -----------------------------------------------------------------------
  // SLA auto-escalation via PGR scheduler (test 13)
  //
  // Verifies the @Scheduled scanAndEscalate() in pgr-services actually fires
  // and walks the HRMS reportingTo chain. Requires Nairobi env vars:
  //   PGR_ESCALATION_INTERVAL_MS=60000   (1 min ticks)
  //   an effective 30s first threshold in EscalationConfig (absolute fallback,
  //   or a percentage of a deliberately short ComplaintHierarchy.slaHours)
  // and the workflow ESCALATE action must permit role SYSTEM at tenant `ke`.
  //
  // Test takes ~3 min: complaint creation, ASSIGN through PGR, wait for the
  // SLA to breach plus a scheduler tick,
  // verify auto-escalation reached level 1.
  // -----------------------------------------------------------------------
  test('13 — auto-escalation: SLA breach triggers scheduler', {
    annotation: {
      type: 'description',
      description: `Verifies pgr-services' @Scheduled scanAndEscalate() actually fires when an assigned complaint reaches its cumulative complaint-age threshold. Requires PGR_ESCALATION_INTERVAL_MS=60000, an effective first threshold under 30 seconds, and a workflow ESCALATE action accepting SYSTEM. Test takes ~3 minutes wall-clock.

Steps:
1. test.skip if !prerequisitesMet; setTimeout 240s.
2. seedComplaintAsCitizen() to file as CITIZEN on resolveSeedPlan()'s serviceCode; capture autoSrid.
3. ASSIGN through PGR _update; the escalation clock remains the complaint's createdTime.
4. Loop with 15s polls, fetching workflow history with history=true, until any ProcessInstance with action=ESCALATE and comment starting "Auto-escalated" appears, or 200s elapse.
5. Assert escalated === true and the level (count of auto-escalates) >= 1.
6. fetchComplaint(autoSrid) and assert additionalDetail.escalationLevel >= 1.

Long-running (240s) because it depends on a real scheduler tick + real SLA breach. If the deployment doesn't have the env vars set or SYSTEM role grant, this fails — flag for env config rather than code regression.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    // Pre-flight gate: the 200s poll deadline is only meetable when pgr-services
    // is deployed with fast escalation tuning (PGR_ESCALATION_INTERVAL_MS=60000
    // plus an effective first threshold under 30s). Percentage configuration
    // takes precedence over PGR_ESCALATION_DEFAULT_SLA_MS when the complaint
    // type has ComplaintHierarchy.slaHours, so on a stock
    // deployment the scheduler can't escalate within the deadline and this would
    // hard-fail as red noise. Opt in with PGR_FAST_ESCALATION=1.
    test.skip(
      process.env.PGR_FAST_ESCALATION !== '1',
      'Set PGR_FAST_ESCALATION=1 only on a deployment tuned for fast escalation ' +
        '(PGR_ESCALATION_INTERVAL_MS=60000 + an effective first threshold under 30s). ' +
        'The stock cumulative percentage ladder makes the 200s poll deadline unmeetable.',
    );
    test.skip(!prerequisitesMet, prerequisitesMissing);
    test.setTimeout(240_000);  // up to 4 min for the SLA breach + scheduler tick

    // Create a fresh complaint — same seedComplaintAsCitizen() path as tests
    // 4 and 10, so it lands on the same department as employeeUuid.
    const created = await seedComplaintAsCitizen({ description: `E2E auto-escalation — ${new Date().toISOString()}` });
    const autoSrid = created.srid;
    console.log(`Auto-escalation test complaint: ${autoSrid}`);

    const assignResp = await pgrUpdate(actor, autoSrid, {
      action: 'ASSIGN', assignes: [employeeUuid], comments: 'auto-escalation test setup',
    });
    const assigned = await assertOk(assignResp, 'PGR ASSIGN');
    expect(assigned.ServiceWrappers[0].service.additionalDetail?.assignmentChangedAt).toBeTruthy();

    // Poll for auto-escalation. With INTERVAL_MS=60000 and an effective
    // threshold under 30s, the next tick (≤60s away) should trigger ESCALATE.
    const deadline = Date.now() + 200_000;
    let escalated = false;
    let level = 0;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 15_000));
      const histResp = await fetch(
        `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${TENANT}&businessIds=${autoSrid}&history=true`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${actor.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: actor.token, userInfo: actor.userInfo } }),
        },
      );
      const histData: any = await histResp.json();
      const autoEscalates = (histData.ProcessInstances || [])
        .filter((p: any) => p.action === 'ESCALATE' && (p.comment || '').startsWith('Auto-escalated'));
      if (autoEscalates.length > 0) {
        escalated = true;
        level = autoEscalates.length;
        console.log(`${autoSrid} auto-escalated (level=${level}, comment: "${autoEscalates[0].comment}")`);
        break;
      }
      console.log(`  …waiting for scheduler tick (${Math.round((deadline - Date.now())/1000)}s left)`);
    }

    expect(escalated).toBe(true);
    expect(level).toBeGreaterThanOrEqual(1);

    // Verify additionalDetail.escalationLevel was incremented
    const final = await fetchComplaint(actor.token, actor.userInfo, autoSrid);
    expect(final.additionalDetail?.escalationLevel).toBeGreaterThanOrEqual(1);
    expect(final.additionalDetail?.escalationTrigger).toBe('AUTOMATIC');
    expect(final.additionalDetail?.assignmentChangedAt).toBe(final.additionalDetail?.lastEscalatedAt);
    console.log(`Final additionalDetail.escalationLevel=${final.additionalDetail?.escalationLevel}`);
  });
});
