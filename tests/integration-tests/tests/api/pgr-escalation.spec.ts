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
import { resolveSeedPlan } from '../utils/personas';
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
  return data.ServiceWrappers[0].service;
}

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

test.describe.serial('PGR escalation — API only', () => {
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let serviceRequestId: string;
  let employeeUuid: string;
  let supervisorUuid: string;
  let secondSupervisorUuid: string | null = null;
  let allEmployees: any[] = [];
  /** Set to true when prerequisites (workflow + hierarchy) are confirmed. */
  let prerequisitesMet = false;
  /** ESCALATE is a self-loop, so the only valid landing state is PENDINGATLME. */
  let escalateNextStateFromLme = 'PENDINGATLME';

  test('1 — acquire admin token', {
    annotation: {
      type: 'description',
      description: `Token-acquisition step for the API-only PGR escalation lifecycle. Every complaint this suite files goes through seedComplaintAsCitizen() (tests 4/10/13), which owns its own citizen identity — this step only needs the admin token that drives ASSIGN/ESCALATE/RESOLVE and the HRMS/workflow patching in tests 2-3.

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

  test('2 — ensure PGR workflow uses only ESCALATE self-loops', {
    annotation: {
      type: 'description',
      description: `Read-only audit of the deployed PGR workflow against the one-flow escalation contract.

Steps:
1. Assert ESCALATE is a self-loop on PENDINGATLME and PENDINGFORASSIGNMENT.
2. Assert SYSTEM is authorized for both self-loops.
3. Assert FORWARD and ASSIGNEDBYAUTOESCALATION actions are absent.
4. Assert PENDINGATSUPERVISOR and RESOLVEDBYSUPERVISOR are absent.
5. Fail on drift. Workflow migration is a deployment operation and this test never mutates live configuration.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {

    const biz = await fetchPgrWorkflow(adminToken);
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
    const vEscAtPfa = (vForAssign.actions || []).find((a: any) => a.action === 'ESCALATE');
    expect(vEscAtLme?.nextState).toBe(vAtLme.uuid);
    expect(vEscAtPfa?.nextState).toBe(vForAssign.uuid);
    expect(vEscAtLme?.roles).toContain('SYSTEM');
    expect(vEscAtPfa?.roles).toContain('SYSTEM');
    expect((vAtLme.actions || []).some((a: any) => a.action === 'FORWARD')).toBe(false);
    expect((vForAssign.actions || []).some((a: any) => a.action === 'ASSIGNEDBYAUTOESCALATION')).toBe(false);
    expect(vFind('PENDINGATSUPERVISOR')).toBeFalsy();
    expect(vFind('RESOLVEDBYSUPERVISOR')).toBeFalsy();

    console.log('PGR workflow self-loop contract verified');
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
5. test.skip if fewer than 2 OTHER same-department employees remain — a 2-level chain needs 3 total, and a deployment with only 1 employee per department (bomet's WATER_ENV, for instance) genuinely can't supply one.
6. Call ensureReportingTo(subordinate, supervisor.uuid) — patches via HRMS _update only if not already set.
7. Same for ensureReportingTo(supervisor, superSupervisor.uuid).
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
      test.skip(true, `Cannot build an escalation hierarchy: ${plan.error}`);
      return;
    }
    const department = getProfile().complaintTypes.services.find((s) => s.serviceCode === plan.serviceCode)?.department;

    // Non-ADMIN employees sharing SERVICE_CODE's department — the pool every
    // hop of the chain (not just the leaf) must be drawn from, since PGR
    // re-validates the department on every assignee change (ASSIGN AND each
    // ESCALATE self-loop), not only the first ASSIGN.
    const deptCandidates = allEmployees.filter(
      (e: any) => e.user?.userName !== 'ADMIN' && (e.assignments || []).some((a: any) => a.department === department),
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
    if (others.length < 2) {
      test.skip(
        true,
        `Need ≥2 more employees in department '${department}' (SERVICE_CODE=${plan.serviceCode}'s department) besides ` +
          `the seed-plan assignee ${plan.assigneeCode} to build a 2-level reportingTo hierarchy where every ` +
          `ASSIGN/ESCALATE hop passes PGR's department check — found ${others.length} (${deptCandidates.length} total in department)`,
      );
      return;
    }

    const supervisor = others[0];
    const superSupervisor = others[1];

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

    // Level 2: supervisor → super-supervisor
    const l2Ok = await ensureReportingTo(supervisor, superSupervisor.uuid);
    expect(l2Ok).toBe(true);
    console.log(`Level 2: ${supervisor.user?.name} → ${superSupervisor.user?.name}`);

    employeeUuid = subordinate.uuid;
    supervisorUuid = supervisor.uuid;
    prerequisitesMet = true;

    // Refresh employee list so later tests see the updated reportingTo
    allEmployees = await searchEmployees(adminToken, TENANT);
    console.log(`2-level hierarchy ready: ${subordinate.user?.name} → ${supervisor.user?.name} → ${superSupervisor.user?.name}`);
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
    test.skip(!prerequisitesMet, 'Prerequisites not met (workflow or HRMS hierarchy missing)');

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
3. POST /pgr-services/v2/request/_update?tenantId=... with admin token.
4. Workflow body: { action: 'ASSIGN', assignees: [employeeUuid], comments }.
5. Assert applicationStatus === 'PENDINGATLME'.

Sets up the situation needed for the level 0→1 escalation in step 6.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ASSIGN',
          assignes: [employeeUuid],
          comments: 'Assigned to employee with supervisor for escalation test',
        },
      }),
    });

    const data = await assertOk(resp, 'PGR ASSIGN');
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
3. POST _update with workflow { action: 'ESCALATE', comments }; the server resolves reportingTo.
4. Assert applicationStatus stays at PENDINGATLME (it's a self-loop).
5. Assert the server wrote level, assignee, trigger, and assignment-clock metadata.

Catches Jackson silently-dropped-key bugs and confirms the self-loop preserves status while updating assignee + metadata.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ESCALATE',
          comments: 'Manual escalation test — level 0→1',
        },
      }),
    });

    const data = await assertOk(resp, 'PGR ESCALATE (level 0→1)');
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
2. searchWorkflowHistory(adminToken, ..., serviceRequestId, TENANT); assert ProcessInstances.length > 0.
3. Pick latest = processInstances[0]; assert latest.action === 'ESCALATE'.
4. Search PGR by serviceRequestId; pull wrapper = ServiceWrappers[0].
5. Read wrapper.workflow.assignes; if non-empty, assert it contains supervisorUuid.
6. Otherwise fall back to latest.assignes; if non-empty, assert it contains supervisorUuid.

Loose-but-correct assertions because ESCALATE self-loops emit assignes inconsistently across DIGIT versions.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');

    // Verify workflow history records the ESCALATE action
    const processInstances = await searchWorkflowHistory(adminToken, adminUserInfo, serviceRequestId, TENANT);
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
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo } }),
      },
    );
    const data: any = await resp.json();
    const wrapper = data.ServiceWrappers[0];

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
3. test.skip if reportingTo is null or the UUID is not in the employee list.
4. POST _update with workflow { action: 'ESCALATE', comments }; the server resolves the second hop.
5. Assert the state is unchanged and server-managed escalationLevel is 2.

The skip cases are first-class outcomes — the suite is designed to pass on a 2-level OR 3+ level hierarchy.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');

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

    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ESCALATE',
          comments: 'Manual escalation test — level 1→2',
        },
      }),
    });

    const data = await assertOk(resp, 'PGR ESCALATE (level 1→2)');
    // Every hop is the same PENDINGATLME self-loop.
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe(escalateNextStateFromLme);
    // Verify escalation metadata persisted through _update (singular field)
    const updatedDetail = data.ServiceWrappers[0].service.additionalDetail || {};
    expect(updatedDetail.escalationLevel).toBe(2);
    console.log(`${serviceRequestId} → ESCALATED to ${secondSupervisorUuid} (level 2, escalationLevel=${updatedDetail.escalationLevel})`);
  });

  test('9 — resolve the escalated complaint', {
    annotation: {
      type: 'description',
      description: `Closes the escalation lifecycle by resolving the complaint and asserting the escalation metadata survived through the RESOLVE transition. PGR's POJO uses the singular additionalDetail field; this test confirms it isn't blanked when the workflow leaves PENDINGATLME for RESOLVED.

Steps:
1. test.skip if !prerequisitesMet.
2. fetchComplaint() to get the full service object.
3. POST _update with workflow { action: 'RESOLVE', comments }.
4. Assert applicationStatus === 'RESOLVED'.
5. Assert additionalDetail.escalationLevel >= 1 (the escalation history is preserved).

Catches a regression where a transition implementation overwrites or strips additionalDetail and loses the escalation audit trail.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);

    const currentState = fullService.applicationStatus as string;
    const closeAction = 'RESOLVE';
    console.log(`closing from ${currentState} via ${closeAction}`);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: { action: closeAction, comments: 'Resolved after escalation — E2E test' },
      }),
    });

    const data = await assertOk(resp, 'PGR RESOLVE');
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
    test.skip(!prerequisitesMet, 'Prerequisites not met');
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
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const fullService = await fetchComplaint(adminToken, adminUserInfo, pfaComplaintId);
    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ESCALATE',
          comments: 'This must fail because the complaint is unassigned',
        },
      }),
    });
    expect(resp.ok).toBe(false);
    const after = await fetchComplaint(adminToken, adminUserInfo, pfaComplaintId);
    expect(after.applicationStatus).toBe('PENDINGFORASSIGNMENT');
    expect(after.additionalDetail?.escalationLevel || 0).toBe(0);
  });

  test('12 — cleanup: assign and resolve the unassigned-case complaint', {
    annotation: {
      type: 'description',
      description: `Drains the unassigned-case complaint to RESOLVED and verifies ASSIGN establishes the assignment clock and hierarchy baseline.

Steps:
1. test.skip if !prerequisitesMet.
2. fetchComplaint(pfaComplaintId), POST _update with workflow { action: 'ASSIGN', assignees: [employeeUuid], comments }; assert applicationStatus === 'PENDINGATLME'.
3. fetchComplaint again, POST _update with workflow { action: 'RESOLVE', comments: 'Cleanup resolve' }; assert applicationStatus === 'RESOLVED'.
4. Assert additionalDetail.escalationLevel === 0 and assignmentChangedAt is present.

Teardown is API-only because PGR has no UI delete affordance — the cleanup is by transitioning to terminal state.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    // Assign
    let fullService = await fetchComplaint(adminToken, adminUserInfo, pfaComplaintId);
    let resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: { action: 'ASSIGN', assignes: [employeeUuid], comments: 'Assigning unassigned-case complaint' },
      }),
    });
    let data = await assertOk(resp, 'PGR ASSIGN (pfa cleanup)');
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');

    // Resolve
    fullService = await fetchComplaint(adminToken, adminUserInfo, pfaComplaintId);
    resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: { action: 'RESOLVE', comments: 'Cleanup resolve' },
      }),
    });
    data = await assertOk(resp, 'PGR RESOLVE (pfa cleanup)');
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
  //   PGR_ESCALATION_DEFAULT_SLA_MS=30000 (30s SLA so complaints ripen fast)
  // and the workflow ESCALATE action must permit role SYSTEM at tenant `ke`.
  //
  // Test takes ~3 min: complaint creation, ASSIGN through PGR, wait for the
  // SLA to breach plus a scheduler tick,
  // verify auto-escalation reached level 1.
  // -----------------------------------------------------------------------
  test('13 — auto-escalation: SLA breach triggers scheduler', {
    annotation: {
      type: 'description',
      description: `Verifies pgr-services' @Scheduled scanAndEscalate() actually fires when an assigned complaint breaches its SLA. Requires the deployment to be configured with PGR_ESCALATION_INTERVAL_MS=60000 and PGR_ESCALATION_DEFAULT_SLA_MS=30000, and the workflow ESCALATE action must accept role SYSTEM. Test takes ~3 minutes wall-clock.

Steps:
1. test.skip if !prerequisitesMet; setTimeout 240s.
2. seedComplaintAsCitizen() to file as CITIZEN on resolveSeedPlan()'s serviceCode; capture autoSrid.
3. ASSIGN through PGR _update so the shared assignment path starts assignmentChangedAt.
4. Loop with 15s polls, fetching workflow history with history=true, until any ProcessInstance with action=ESCALATE and comment starting "Auto-escalated" appears, or 200s elapse.
5. Assert escalated === true and the level (count of auto-escalates) >= 1.
6. fetchComplaint(autoSrid) and assert additionalDetail.escalationLevel >= 1.

Long-running (240s) because it depends on a real scheduler tick + real SLA breach. If the deployment doesn't have the env vars set or SYSTEM role grant, this fails — flag for env config rather than code regression.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    // Pre-flight gate: the 200s poll deadline is only meetable when pgr-services
    // is deployed with fast escalation tuning (PGR_ESCALATION_INTERVAL_MS=60000 +
    // PGR_ESCALATION_DEFAULT_SLA_MS=30000). The service defaults are 300000 /
    // 432000000, and no in-repo deploy passes the fast values, so on a stock
    // deployment the scheduler can't escalate within the deadline and this would
    // hard-fail as red noise. Opt in with PGR_FAST_ESCALATION=1.
    test.skip(
      process.env.PGR_FAST_ESCALATION !== '1',
      'Set PGR_FAST_ESCALATION=1 only on a deployment tuned for fast escalation ' +
        '(PGR_ESCALATION_INTERVAL_MS=60000 + PGR_ESCALATION_DEFAULT_SLA_MS=30000). ' +
        'pgr-services defaults (300000 / 432000000) make the 200s poll deadline unmeetable.',
    );
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    test.setTimeout(240_000);  // up to 4 min for the SLA breach + scheduler tick

    // Create a fresh complaint — same seedComplaintAsCitizen() path as tests
    // 4 and 10, so it lands on the same department as employeeUuid.
    const created = await seedComplaintAsCitizen({ description: `E2E auto-escalation — ${new Date().toISOString()}` });
    const autoSrid = created.srid;
    console.log(`Auto-escalation test complaint: ${autoSrid}`);

    const autoService = await fetchComplaint(adminToken, adminUserInfo, autoSrid);
    const assignResp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: autoService,
        workflow: { action: 'ASSIGN', assignes: [employeeUuid], comments: 'auto-escalation test setup' },
      }),
    });
    const assigned = await assertOk(assignResp, 'PGR ASSIGN');
    expect(assigned.ServiceWrappers[0].service.additionalDetail?.assignmentChangedAt).toBeTruthy();

    // Poll for auto-escalation. With INTERVAL_MS=60000 and SLA_MS=30000,
    // the next tick (≤60s away) should breach (after 30s) and trigger ESCALATE.
    const deadline = Date.now() + 200_000;
    let escalated = false;
    let level = 0;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 15_000));
      const histResp = await fetch(
        `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${TENANT}&businessIds=${autoSrid}&history=true`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo } }),
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
    const final = await fetchComplaint(adminToken, adminUserInfo, autoSrid);
    expect(final.additionalDetail?.escalationLevel).toBeGreaterThanOrEqual(1);
    expect(final.additionalDetail?.escalationTrigger).toBe('AUTOMATIC');
    expect(final.additionalDetail?.assignmentChangedAt).toBe(final.additionalDetail?.lastEscalatedAt);
    console.log(`Final additionalDetail.escalationLevel=${final.additionalDetail?.escalationLevel}`);
  });

  test('14 — audit: PGR workflow config matches the shipped seed', {
    annotation: {
      type: 'description',
      description: `Audits the deployed PGR businessService against the single-flow seed:

1. Every action's nextState resolves to a state that exists.
2. ESCALATE is a self-loop on both supported states.
3. No active supervisor-tier state or legacy auto-escalation action remains.

Deliberately LAST in this serial block, and deliberately separate from test 2. These are audits of the deployment's configuration, not preconditions for the escalation chain — gating tests 3-13 on them would trade 11 tests' worth of real coverage for a finding that blocks nothing.

This is the final guard against workflow/source drift.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:api', '@persona:cross'] }, async () => {
    const biz = await fetchPgrWorkflow(adminToken);

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
    const escAtPfa = (forAssignment?.actions || []).find((a: any) => a.action === 'ESCALATE');
    const escTarget = biz.states.find((s: any) => s.uuid === escAtLme?.nextState);
    const pfaTarget = biz.states.find((s: any) => s.uuid === escAtPfa?.nextState);
    expect(escTarget?.applicationStatus).toBe('PENDINGATLME');
    expect(pfaTarget?.applicationStatus).toBe('PENDINGFORASSIGNMENT');
    expect(biz.states.some((s: any) => s.applicationStatus === 'PENDINGATSUPERVISOR')).toBe(false);
    expect(biz.states.some((s: any) => s.applicationStatus === 'RESOLVEDBYSUPERVISOR')).toBe(false);
    expect((atLme.actions || []).some((a: any) => a.action === 'FORWARD')).toBe(false);
    expect((forAssignment.actions || []).some((a: any) => a.action === 'ASSIGNEDBYAUTOESCALATION')).toBe(false);
  });
});
