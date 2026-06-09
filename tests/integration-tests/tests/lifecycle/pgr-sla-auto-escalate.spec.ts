/**
 * PGR SLA auto-escalation — fast E2E (~2 min)
 *
 * Targeted test for the @Scheduled scanAndEscalate() in pgr-services.
 * Trims the larger pgr-escalation-api.spec.ts down to: prereq check + the
 * single auto-escalation assertion.
 *
 * Prerequisites on the target deployment:
 *   PGR_ESCALATION_INTERVAL_MS=60000   (scan every 60 s)
 *   PGR_ESCALATION_DEFAULT_SLA_MS=30000 (SLA breach in 30 s)
 *   ESCALATE workflow action allows role SYSTEM at root tenant
 *   At least one HRMS reportingTo relationship in the city tenant
 *
 * Worst-case timing:
 *   - Just-missed scheduler tick: 60 s wait
 *   - Plus 30 s SLA grace: 90 s
 *   - + ~10 s for create/assign/poll buffer ≈ 100 s
 * Test deadline is set to 130 s.
 *
 * Run:
 *   npx playwright test tests/lifecycle/pgr-sla-auto-escalate.spec.ts
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
const CITIZEN_NAME = 'E2E SLA Auto-Escalate Citizen';

async function assertOk(resp: Response, ctx: string): Promise<any> {
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`${ctx}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function registerCitizen(phone: string): Promise<{ token: string; userInfo: Record<string, unknown> }> {
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: phone, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  });

  const tokenReq = () => fetch(`${BASE_URL}/user/oauth/token`, {
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

  let resp = await tokenReq();
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
    resp = await tokenReq();
  }
  const data: any = await resp.json();
  return { token: data.access_token, userInfo: data.UserRequest };
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
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;
  let employeeUuid: string;

  test('1 — acquire tokens', {
    annotation: {
      type: 'description',
      description: `Token-acquisition step for the fast SLA auto-escalation test (~2 min total). Acquires both admin (root) and citizen (registered via OTP helper) tokens.

Steps:
1. getDigitToken with ROOT_TENANT, ADMIN_USER, ADMIN_PASS; assert access_token truthy.
2. registerCitizen(CITIZEN_PHONE) to send OTP, then login (or create+login on first run).
3. Assert citizen token truthy.

Trimmed-down sibling of the larger pgr-escalation-api spec — does only the assertions needed to drive a single auto-escalation observation.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const adminResp = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = adminResp.access_token;
    adminUserInfo = adminResp.UserRequest as Record<string, unknown>;
    expect(adminToken).toBeTruthy();

    const cit = await registerCitizen(CITIZEN_PHONE);
    citizenToken = cit.token;
    citizenUserInfo = cit.userInfo;
    expect(citizenToken).toBeTruthy();
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
2. POST PGR _create as the citizen; capture srid.
3. ASSIGN via raw /egov-wf/process/_transition (not PGR _update) so processInstance.assignes is populated — the scheduler depends on this.
4. Poll workflow history every 5s for up to 130s, looking for any ProcessInstance with action=ESCALATE and comment starting "Auto-escalated".
5. Assert escalated === true (with diagnostic message pointing at PGR_ESCALATION_* env vars).
6. Assert level >= 1.
7. fetchComplaint(srid) and assert additionalDetail.escalationLevel >= 1.

Test timeout is 160s because the worst-case wall-clock is ~130s (just-missed scheduler tick + SLA + buffer). If the deployment doesn't have the env config, this is the fastest way to discover that.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    test.setTimeout(160_000);

    // Create a fresh complaint
    const createResp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizenToken, userInfo: citizenUserInfo },
        service: {
          tenantId: TENANT,
          serviceCode: SERVICE_CODE,
          description: `E2E SLA auto-escalate — ${new Date().toISOString()}`,
          source: 'web',
          address: { city: TENANT, locality: { code: LOCALITY_CODE }, geoLocation: { latitude: 0, longitude: 0 } },
          citizen: { name: CITIZEN_NAME, mobileNumber: CITIZEN_PHONE },
        },
        workflow: { action: 'APPLY', verificationDocuments: [] },
      }),
    });
    const createData = await assertOk(createResp, 'PGR _create');
    const srid = createData.ServiceWrappers[0].service.serviceRequestId;
    console.log(`[${srid}] created → PENDINGFORASSIGNMENT`);

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
