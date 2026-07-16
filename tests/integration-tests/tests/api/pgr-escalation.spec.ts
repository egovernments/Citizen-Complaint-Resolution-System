/**
 * PGR Escalation — API-only
 *
 * Tests the manual escalation workflow using only API calls (no browser):
 *   1. Acquire admin + citizen tokens
 *   2. Ensure ESCALATE action exists in PGR workflow (add if missing)
 *   3. Ensure employee hierarchy — at least one reportingTo relationship in HRMS
 *   4. Citizen creates complaint
 *   5. Admin assigns complaint to specific employee (one with a supervisor)
 *   6. Manual ESCALATE — level 0→1, reassign to supervisor
 *   7. Verify workflow process instance shows new assignee
 *   8. Second ESCALATE — level 1→2 (skip if no second-level supervisor)
 *   9. Resolve the escalated complaint
 *
 * Prerequisites are auto-seeded (tests 2-3). The test suite is idempotent.
 *
 * Run: npx playwright test tests/specs/pgr-escalation-api.spec.ts
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS, FIXED_OTP,
  DEFAULT_PASSWORD,
  SERVICE_CODE, LOCALITY_CODE,
  generateCitizenPhone,
} from '../utils/env';

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = 'E2E Escalation Citizen';

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

/** Register a citizen via OTP flow and return token. */
async function registerCitizen(phone: string): Promise<{ token: string; userInfo: Record<string, unknown> }> {
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: phone, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  });

  let resp = await fetch(`${BASE_URL}/user/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
    },
    body: new URLSearchParams({
      grant_type: 'password', username: phone, password: FIXED_OTP,
      tenantId: ROOT_TENANT, scope: 'read', userType: 'CITIZEN',
    }).toString(),
  });

  if (!resp.ok) {
    await fetch(`${BASE_URL}/user/citizen/_create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker' },
        user: {
          name: CITIZEN_NAME, userName: phone, mobileNumber: phone,
          password: DEFAULT_PASSWORD, tenantId: ROOT_TENANT, type: 'CITIZEN',
          roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: ROOT_TENANT }],
          otpReference: FIXED_OTP,
        },
      }),
    });

    resp = await fetch(`${BASE_URL}/user/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      },
      body: new URLSearchParams({
        grant_type: 'password', username: phone, password: FIXED_OTP,
        tenantId: ROOT_TENANT, scope: 'read', userType: 'CITIZEN',
      }).toString(),
    });
  }

  const data: any = await resp.json();
  return { token: data.access_token, userInfo: data.UserRequest };
}

/** Search HRMS employees for a tenant. */
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
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;
  let serviceRequestId: string;
  let employeeUuid: string;
  let supervisorUuid: string;
  let secondSupervisorUuid: string | null = null;
  let allEmployees: any[] = [];
  /** Set to true when prerequisites (workflow + hierarchy) are confirmed. */
  let prerequisitesMet = false;

  test('1 — acquire admin and citizen tokens', {
    annotation: {
      type: 'description',
      description: `Token-acquisition step for the API-only PGR escalation lifecycle. Same shape as the basic PGR lifecycle's token step but feeds a longer chain of escalation tests that all reuse adminToken/citizenToken.

Steps:
1. getDigitToken with ROOT_TENANT, ADMIN_USER, ADMIN_PASS; assert access_token is truthy.
2. Stash adminToken and adminUserInfo.
3. registerCitizen(CITIZEN_PHONE) — sends OTP, then logs in or creates+logs-in.
4. Assert citizen response token is truthy; stash citizenToken + citizenUserInfo.

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

    const citizenResp = await registerCitizen(CITIZEN_PHONE);
    expect(citizenResp.token).toBeTruthy();
    citizenToken = citizenResp.token;
    citizenUserInfo = citizenResp.userInfo;
    console.log(`Admin and citizen (${CITIZEN_PHONE}) tokens acquired`);
  });

  test('2 — ensure PGR workflow config is correct (ESCALATE, role grants, nextState fix)', {
    annotation: {
      type: 'description',
      description: `Idempotently patches the PGR workflow config so the rest of the escalation suite has the actions/roles/nextState wirings it expects. Verifies — and adds, if missing — the ESCALATE self-loops on PENDINGATLME and PENDINGFORASSIGNMENT, the GRO role on FORWARD and RESOLVEBYSUPERVISOR, and the corrected nextState (RESOLVED) for RESOLVEBYSUPERVISOR.

Steps:
1. fetchPgrWorkflow() and assert the four canonical states (PENDINGATLME, PENDINGFORASSIGNMENT, PENDINGATSUPERVISOR, RESOLVED) all exist.
2. If PENDINGATLME has no ESCALATE action, push a self-loop with roles GRO/PGR_LME/AUTO_ESCALATE/PGR_VIEWER.
3. Same for PENDINGFORASSIGNMENT (ESCALATE self-loop with GRO/AUTO_ESCALATE/PGR_VIEWER).
4. Ensure FORWARD on PENDINGATLME includes role GRO.
5. Ensure RESOLVEBYSUPERVISOR on PENDINGATSUPERVISOR has nextState=RESOLVED and includes role GRO.
6. If anything was dirtied, POST businessservice/_update; otherwise log "no update needed".
7. Re-fetch and verify each patch was applied.

Self-healing: safe to run many times. If the workflow seed gets re-applied between runs, this step quietly re-patches it.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const biz = await fetchPgrWorkflow(adminToken);
    expect(biz).toBeTruthy();

    const findState = (status: string) => biz.states.find((s: any) => s.applicationStatus === status);
    const pendingAtLme = findState('PENDINGATLME');
    const pendingForAssign = findState('PENDINGFORASSIGNMENT');
    const pendingAtSup = findState('PENDINGATSUPERVISOR');
    const resolved = findState('RESOLVED');
    expect(pendingAtLme).toBeTruthy();
    expect(pendingForAssign).toBeTruthy();
    expect(pendingAtSup).toBeTruthy();
    expect(resolved).toBeTruthy();

    let dirty = false;

    // (a) ESCALATE self-loop on PENDINGATLME
    if (!(pendingAtLme.actions || []).some((a: any) => a.action === 'ESCALATE')) {
      pendingAtLme.actions.push({
        tenantId: TENANT, currentState: pendingAtLme.uuid, action: 'ESCALATE',
        nextState: pendingAtLme.uuid,
        roles: ['GRO', 'PGR_LME', 'AUTO_ESCALATE', 'PGR_VIEWER'],
        active: true,
      });
      dirty = true;
      console.log('+ ESCALATE on PENDINGATLME');
    }

    // (b) ESCALATE self-loop on PENDINGFORASSIGNMENT
    if (!(pendingForAssign.actions || []).some((a: any) => a.action === 'ESCALATE')) {
      pendingForAssign.actions.push({
        tenantId: TENANT, currentState: pendingForAssign.uuid, action: 'ESCALATE',
        nextState: pendingForAssign.uuid,
        roles: ['GRO', 'AUTO_ESCALATE', 'PGR_VIEWER'],
        active: true,
      });
      dirty = true;
      console.log('+ ESCALATE on PENDINGFORASSIGNMENT');
    }

    // (c) FORWARD on PENDINGATLME should allow GRO so admin can test supervisor-forward path
    const forwardAction = (pendingAtLme.actions || []).find((a: any) => a.action === 'FORWARD');
    if (forwardAction && !forwardAction.roles.includes('GRO')) {
      forwardAction.roles = [...forwardAction.roles, 'GRO'];
      dirty = true;
      console.log('+ GRO role on FORWARD');
    }

    // (d) RESOLVEBYSUPERVISOR on PENDINGATSUPERVISOR should target RESOLVED (not orphaned RESOLVEDBYSUPERVISOR)
    //     and allow GRO so admin can test supervisor-resolve path
    const resolveBySup = (pendingAtSup.actions || []).find((a: any) => a.action === 'RESOLVEBYSUPERVISOR');
    if (resolveBySup) {
      if (resolveBySup.nextState !== resolved.uuid) {
        resolveBySup.nextState = resolved.uuid;
        dirty = true;
        console.log('+ RESOLVEBYSUPERVISOR.nextState → RESOLVED');
      }
      if (!resolveBySup.roles.includes('GRO')) {
        resolveBySup.roles = [...resolveBySup.roles, 'GRO'];
        dirty = true;
        console.log('+ GRO role on RESOLVEBYSUPERVISOR');
      }
    }

    if (!dirty) {
      console.log('PGR workflow config already correct — no update needed');
      return;
    }

    // Push the update
    const resp = await fetch(
      `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_update?tenantId=${TENANT}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
          BusinessServices: [biz],
        }),
      },
    );
    await assertOk(resp, 'Workflow _update');

    // Re-fetch and verify everything we changed
    const verifyBiz = await fetchPgrWorkflow(adminToken);
    const vFind = (status: string) => verifyBiz.states.find((s: any) => s.applicationStatus === status);
    const vAtLme = vFind('PENDINGATLME');
    const vForAssign = vFind('PENDINGFORASSIGNMENT');
    const vAtSup = vFind('PENDINGATSUPERVISOR');
    const vResolved = vFind('RESOLVED');

    expect((vAtLme.actions || []).some((a: any) => a.action === 'ESCALATE')).toBe(true);
    expect((vForAssign.actions || []).some((a: any) => a.action === 'ESCALATE')).toBe(true);

    const vForward = (vAtLme.actions || []).find((a: any) => a.action === 'FORWARD');
    expect(vForward?.roles).toContain('GRO');

    const vResolveBySup = (vAtSup.actions || []).find((a: any) => a.action === 'RESOLVEBYSUPERVISOR');
    expect(vResolveBySup?.nextState).toBe(vResolved.uuid);
    expect(vResolveBySup?.roles).toContain('GRO');

    console.log('PGR workflow config verified after update');
  });

  test('3 — ensure 2-level employee hierarchy (reportingTo) in HRMS', {
    annotation: {
      type: 'description',
      description: `Builds (idempotently) the 2-level employee hierarchy that escalation walks: subordinate → supervisor → super-supervisor. Picks three non-ADMIN employees and updates their assignment.reportingTo via HRMS _update if not already linked. Sets prerequisitesMet so later tests can skip cleanly when the env can't supply enough employees.

Steps:
1. searchEmployees(adminToken, TENANT); assert count > 0.
2. If fewer than 3 employees exist, test.skip with a clear reason and return.
3. Filter out ADMIN; abort if fewer than 3 candidates remain.
4. Pick employees[0] = subordinate, [1] = supervisor, [2] = super-supervisor.
5. Call ensureReportingTo(subordinate, supervisor.uuid) — patches via HRMS _update only if not already set.
6. Same for ensureReportingTo(supervisor, superSupervisor.uuid).
7. Stash employeeUuid + supervisorUuid; refresh allEmployees so subsequent tests see updated reportingTo.
8. Set prerequisitesMet = true.

If this fails due to insufficient employees, downstream escalation tests skip rather than producing red noise.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    allEmployees = await searchEmployees(adminToken, TENANT);
    expect(allEmployees.length).toBeGreaterThan(0);
    console.log(`Found ${allEmployees.length} employees in ${TENANT}`);

    if (allEmployees.length < 3) {
      test.skip(true, 'Need at least 3 employees to create 2-level hierarchy');
      return;
    }

    // Pick 3 non-ADMIN employees for the chain: employee → supervisor → super-supervisor
    const candidates = allEmployees.filter((e: any) => e.user?.userName !== 'ADMIN');
    if (candidates.length < 3) {
      test.skip(true, 'Need at least 3 non-ADMIN employees for hierarchy');
      return;
    }

    const subordinate = candidates[0];
    const supervisor = candidates[1];
    const superSupervisor = candidates[2];

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
      description: `Creates the first complaint for the escalation lifecycle. Same shape as the basic PGR lifecycle's create step — gates on prerequisitesMet so the run skips cleanly if the workflow patch or HRMS hierarchy didn't land.

Steps:
1. test.skip if !prerequisitesMet.
2. POST /pgr-services/v2/request/_create with citizen token and a fully-populated service object (service code, source=web, address with non-null geoLocation, citizen name+mobile).
3. Workflow body: { action: 'APPLY' }.
4. assertOk + extract serviceRequestId.
5. Assert applicationStatus === 'PENDINGFORASSIGNMENT'.

Stashes serviceRequestId for the assign + escalate steps.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met (workflow or HRMS hierarchy missing)');

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizenToken, userInfo: citizenUserInfo },
        service: {
          tenantId: TENANT,
          serviceCode: SERVICE_CODE,
          description: `E2E escalation test — ${new Date().toISOString()}`,
          source: 'web',
          address: {
            city: TENANT,
            locality: { code: LOCALITY_CODE },
            geoLocation: { latitude: 0, longitude: 0 },
          },
          citizen: { name: CITIZEN_NAME, mobileNumber: CITIZEN_PHONE },
        },
        workflow: { action: 'APPLY', verificationDocuments: [] },
      }),
    });

    const data = await assertOk(resp, 'PGR _create');
    serviceRequestId = data.ServiceWrappers[0].service.serviceRequestId;
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGFORASSIGNMENT');
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
3. Merge escalationLevel: 1, lastEscalatedAt, escalatedFrom: [employeeUuid] into existing additionalDetail; delete any stray additionalDetails plural key.
4. POST _update with workflow { action: 'ESCALATE', assignees: [supervisorUuid], comments }.
5. Assert applicationStatus stays at PENDINGATLME (it's a self-loop).
6. Assert response's additionalDetail.escalationLevel === 1.

Catches Jackson silently-dropped-key bugs and confirms the self-loop preserves status while updating assignee + metadata.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);

    // PGR POJO field is `additionalDetail` (singular). Jackson silently drops
    // unknown keys, so plural `additionalDetails` would be lost. Preserve
    // existing `department` key (required by PGR) and add escalation metadata.
    const existingDetail = fullService.additionalDetail || {};
    fullService.additionalDetail = {
      ...existingDetail,
      escalationLevel: 1,
      lastEscalatedAt: Date.now(),
      escalatedFrom: [employeeUuid],
    };
    delete fullService.additionalDetails;

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ESCALATE',
          assignes: [supervisorUuid],
          comments: 'Manual escalation test — level 0→1',
        },
      }),
    });

    const data = await assertOk(resp, 'PGR ESCALATE (level 0→1)');
    // ESCALATE is a self-loop on PENDINGATLME — status stays the same
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    // Verify escalation metadata persisted (singular `additionalDetail` field)
    const updatedDetail = data.ServiceWrappers[0].service.additionalDetail || {};
    expect(updatedDetail.escalationLevel).toBe(1);
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
    const wfAssignees = (wrapper.workflow?.assignes || []).map((a: any) => a.uuid);
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
4. fetchComplaint() and merge { escalationLevel: 2, lastEscalatedAt, escalatedFrom: [...prev, supervisorUuid] } into additionalDetail.
5. POST _update with workflow { action: 'ESCALATE', assignees: [secondSupervisorUuid], comments }.
6. Assert applicationStatus stays PENDINGATLME (self-loop) and additionalDetail.escalationLevel === 2.

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
    // Use singular `additionalDetail` (PGR POJO field name) and preserve department
    const existingDetail = fullService.additionalDetail || {};
    fullService.additionalDetail = {
      ...existingDetail,
      escalationLevel: 2,
      lastEscalatedAt: Date.now(),
      escalatedFrom: [...(existingDetail.escalatedFrom || []), supervisorUuid],
    };
    delete fullService.additionalDetails;

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ESCALATE',
          assignes: [secondSupervisorUuid],
          comments: 'Manual escalation test — level 1→2',
        },
      }),
    });

    const data = await assertOk(resp, 'PGR ESCALATE (level 1→2)');
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
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

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: { action: 'RESOLVE', comments: 'Resolved after escalation — E2E test' },
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
  // PENDINGFORASSIGNMENT escalation path (tests 10–12)
  //
  // Exercises the ESCALATE self-loop on PENDINGFORASSIGNMENT — an early-stage
  // escalation before anyone has been assigned. Used when the initial
  // assignment is stuck and a human supervisor wants to re-route the
  // complaint pre-assignment.
  //
  // v2 note: the supervisor-jump path (FORWARD → PENDINGATSUPERVISOR →
  // RESOLVEBYSUPERVISOR) has been removed. Both manual (ESCALATE) and
  // scheduler-triggered (SLA_ESCALATE) escalations are now self-loops on
  // PENDINGFORASSIGNMENT and PENDINGATLME.
  // -----------------------------------------------------------------------
  let pfaComplaintId: string;

  test('10 — citizen creates complaint for PENDINGFORASSIGNMENT escalation', {
    annotation: {
      type: 'description',
      description: `Creates a fresh third complaint to exercise the early-stage escalation path: ESCALATE on PENDINGFORASSIGNMENT (before anyone has been assigned). Used when the initial assign is stuck and a supervisor needs to re-route pre-assignment.

Steps:
1. test.skip if !prerequisitesMet.
2. POST /pgr-services/v2/request/_create with citizen token and a fully-populated service object.
3. Workflow body: { action: 'APPLY' }.
4. assertOk + extract pfaComplaintId.
5. Assert applicationStatus === 'PENDINGFORASSIGNMENT'.

Stashes pfaComplaintId for the PFA-escalate + cleanup steps (11 and 12).`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizenToken, userInfo: citizenUserInfo },
        service: {
          tenantId: TENANT,
          serviceCode: SERVICE_CODE,
          description: `E2E PFA-escalate — ${new Date().toISOString()}`,
          source: 'web',
          address: { city: TENANT, locality: { code: LOCALITY_CODE }, geoLocation: { latitude: 0, longitude: 0 } },
          citizen: { name: CITIZEN_NAME, mobileNumber: CITIZEN_PHONE },
        },
        workflow: { action: 'APPLY', verificationDocuments: [] },
      }),
    });
    const data = await assertOk(resp, 'PGR _create (pfa path)');
    pfaComplaintId = data.ServiceWrappers[0].service.serviceRequestId;
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGFORASSIGNMENT');
    console.log(`Third complaint created: ${pfaComplaintId} → PENDINGFORASSIGNMENT`);
  });

  test('11 — ESCALATE from PENDINGFORASSIGNMENT (self-loop, pre-assignment)', {
    annotation: {
      type: 'description',
      description: `Drives the early-stage ESCALATE self-loop: status stays PENDINGFORASSIGNMENT but escalation metadata is recorded and the complaint can be re-routed before formal assignment. Asserts the v2 PGR contract — both manual and scheduler-triggered escalations are now self-loops on the pre-assignment state.

Steps:
1. test.skip if !prerequisitesMet.
2. fetchComplaint(pfaComplaintId) and merge { escalationLevel: 1, lastEscalatedAt, preAssignmentEscalation: true } into additionalDetail; delete additionalDetails plural.
3. POST _update with workflow { action: 'ESCALATE', assignees: [employeeUuid], comments }.
4. Assert applicationStatus stays PENDINGFORASSIGNMENT (self-loop).
5. Assert additionalDetail.escalationLevel === 1.

Documents the v2 design: there is no FORWARD → PENDINGATSUPERVISOR detour anymore.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const fullService = await fetchComplaint(adminToken, adminUserInfo, pfaComplaintId);
    const existingDetail = fullService.additionalDetail || {};
    fullService.additionalDetail = {
      ...existingDetail,
      escalationLevel: 1,
      lastEscalatedAt: Date.now(),
      preAssignmentEscalation: true,
    };
    delete fullService.additionalDetails;

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ESCALATE',
          assignes: [employeeUuid],
          comments: 'Pre-assignment escalation — level 1',
        },
      }),
    });
    const data = await assertOk(resp, 'PGR ESCALATE (PENDINGFORASSIGNMENT)');
    // Self-loop: status stays in PENDINGFORASSIGNMENT
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGFORASSIGNMENT');
    expect(data.ServiceWrappers[0].service.additionalDetail?.escalationLevel).toBe(1);
    console.log(`${pfaComplaintId} → PENDINGFORASSIGNMENT (ESCALATE self-loop, escalationLevel=1)`);
  });

  test('12 — cleanup: assign and resolve the PFA-escalated complaint', {
    annotation: {
      type: 'description',
      description: `Drains the third complaint to RESOLVED so the test doesn't leave a dangling PENDINGFORASSIGNMENT in the database. Also acts as a regression check that escalation metadata survives both ASSIGN and RESOLVE transitions.

Steps:
1. test.skip if !prerequisitesMet.
2. fetchComplaint(pfaComplaintId), POST _update with workflow { action: 'ASSIGN', assignees: [employeeUuid], comments }; assert applicationStatus === 'PENDINGATLME'.
3. fetchComplaint again, POST _update with workflow { action: 'RESOLVE', comments: 'Cleanup resolve' }; assert applicationStatus === 'RESOLVED'.
4. Assert additionalDetail.escalationLevel === 1 — the level set by step 11 must persist end-to-end.

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
        workflow: { action: 'ASSIGN', assignes: [employeeUuid], comments: 'Assigning after PFA-escalate' },
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
    // Escalation metadata from the PFA self-loop should have survived through ASSIGN and RESOLVE
    expect(data.ServiceWrappers[0].service.additionalDetail?.escalationLevel).toBe(1);
    console.log(`${pfaComplaintId} → RESOLVED (PFA ESCALATE metadata preserved end-to-end)`);
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
  // Test takes ~3 min: complaint creation, ASSIGN via raw workflow API to
  // populate workflow process_instance.assignes (PGR _update doesn't
  // populate this for self-loops), wait for SLA to breach + scheduler tick,
  // verify auto-escalation reached level 1.
  // -----------------------------------------------------------------------
  test('13 — auto-escalation: SLA breach triggers scheduler', {
    annotation: {
      type: 'description',
      description: `Verifies pgr-services' @Scheduled scanAndEscalate() actually fires when an assigned complaint breaches its SLA. Requires the deployment to be configured with PGR_ESCALATION_INTERVAL_MS=60000 and PGR_ESCALATION_DEFAULT_SLA_MS=30000, and the workflow ESCALATE action must accept role SYSTEM. Test takes ~3 minutes wall-clock.

Steps:
1. test.skip if !prerequisitesMet; setTimeout 240s.
2. POST PGR _create as the citizen; capture autoSrid.
3. ASSIGN via raw /egov-wf/process/_transition (NOT PGR _update) — this is the only path that populates ProcessInstance.assignes for self-loops, which the scheduler reads to find escalation targets.
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

    // Create a fresh complaint
    const createResp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizenToken, userInfo: citizenUserInfo },
        service: {
          tenantId: TENANT,
          serviceCode: SERVICE_CODE,
          description: `E2E auto-escalation — ${new Date().toISOString()}`,
          source: 'web',
          address: { city: TENANT, locality: { code: LOCALITY_CODE }, geoLocation: { latitude: 0, longitude: 0 } },
          citizen: { name: CITIZEN_NAME, mobileNumber: CITIZEN_PHONE },
        },
        workflow: { action: 'APPLY', verificationDocuments: [] },
      }),
    });
    const createData = await assertOk(createResp, 'PGR _create (auto-escalation)');
    const autoSrid = createData.ServiceWrappers[0].service.serviceRequestId;
    console.log(`Auto-escalation test complaint: ${autoSrid}`);

    // ASSIGN via raw workflow /process/_transition so workflow process_instance.assignes is populated
    const assignResp = await fetch(`${BASE_URL}/egov-workflow-v2/egov-wf/process/_transition`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        ProcessInstances: [{
          tenantId: TENANT,
          businessService: 'PGR',
          businessId: autoSrid,
          moduleName: 'PGR',
          action: 'ASSIGN',
          comment: 'auto-escalation test setup',
          assignes: [{ uuid: employeeUuid }],
        }],
      }),
    });
    await assertOk(assignResp, 'WF ASSIGN (raw)');
    console.log(`${autoSrid} assigned to employee ${employeeUuid} via raw workflow API`);

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
    console.log(`Final additionalDetail.escalationLevel=${final.additionalDetail?.escalationLevel}`);
  });
});
