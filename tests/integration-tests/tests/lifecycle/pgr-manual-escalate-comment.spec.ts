/**
 * PGR manual ESCALATE — mandatory comment validation on Bomet.
 *
 * Regression guard for the new mandatory-comment rule on manual escalations.
 * The validator must:
 *   - REJECT (HTTP 400, code ESCALATE_COMMENT_REQUIRED) when a GRO user
 *     triggers ESCALATE without `workflow.comments`.
 *   - ACCEPT (HTTP 200) when the same request includes a comment.
 *
 * The check only fires for caller-driven ESCALATEs (where the caller is NOT
 * carrying the synthetic AUTO_ESCALATE role); the scheduler bypasses it
 * because /escalation/_trigger auto-tags the role.
 *
 * Persona:
 *   - PHASE0_SUP/ke.bomet has the GRO role and is therefore eligible to
 *     trigger manual escalation.
 *
 * Cleanup:
 *   - We don't drain the complaint to RESOLVED here — leaving it at
 *     PENDINGATSUPERVISOR is harmless and keeps the test focused on the
 *     comment-validation contract. The pgr-escalation-api suite already
 *     covers the full lifecycle.
 *
 * Run:
 *   BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet \
 *   ROOT_TENANT=ke SERVICE_CODE=RepeatedFailureAcrossFacilities \
 *   LOCALITY_CODE=BOMET_BOMET_EAST_CHEMANER \
 *   npx playwright test tests/lifecycle/pgr-manual-escalate-comment.spec.ts
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import {
  BASE_URL, TENANT, ROOT_TENANT,
  FIXED_OTP, DEFAULT_PASSWORD,
  SERVICE_CODE, LOCALITY_CODE,
  generateCitizenPhone,
} from '../utils/env';

const PHASE0_SUP_USERNAME = process.env.PHASE0_SUP_USERNAME || 'PHASE0_SUP_1780961197';
const PHASE0_SUP_UUID = process.env.PHASE0_SUP_UUID || 'bfb3d8e4-8a99-4a8f-a5cf-ffb267185329';
const PHASE0_SUB2_UUID = process.env.PHASE0_SUB2_UUID || '6956fc1a-6a48-47cb-a5f7-1777d12acb4a';

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = 'E2E Escalate Comment Citizen';

async function assertOk(resp: Response, ctx: string): Promise<any> {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`${ctx}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 600)}`);
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
  const data = await resp.json();
  return { token: data.access_token, userInfo: data.UserRequest };
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
  const data = await resp.json();
  return data.ServiceWrappers?.[0]?.service;
}

test.describe.serial('PGR manual ESCALATE comment validation on Bomet', () => {
  let supToken: string;
  let supUserInfo: Record<string, unknown>;
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;
  let serviceRequestId: string;

  test.beforeAll(async () => {
    test.setTimeout(45_000);

    const supResp = await getDigitToken({
      tenant: 'ke.bomet',
      username: PHASE0_SUP_USERNAME,
      password: 'eGov@123',
    });
    supToken = supResp.access_token;
    supUserInfo = supResp.UserRequest as Record<string, unknown>;
    expect(supToken, 'PHASE0_SUP login on ke.bomet must mint').toBeTruthy();
    // Sanity: the supervisor must carry GRO so the workflow allows ESCALATE
    const supRoles = ((supUserInfo.roles as Array<{ code: string }>) || []).map((r) => r.code);
    expect(supRoles, `PHASE0_SUP needs GRO to issue ESCALATE; got ${JSON.stringify(supRoles)}`).toContain('GRO');

    const cit = await registerCitizen(CITIZEN_PHONE);
    citizenToken = cit.token;
    citizenUserInfo = cit.userInfo;
    expect(citizenToken, 'citizen OTP login must mint').toBeTruthy();
  });

  test('1 — file complaint and assign to PHASE0_SUB2 (sets up the ESCALATE call)', {
    annotation: {
      type: 'description',
      description: `Builds the row the validator needs to refuse. We have to be at PENDINGATLME so the next workflow action (ESCALATE) is even a candidate — the validator only inspects ESCALATE-action requests, so we don't waste cycles checking that other transitions pass through.

Steps:
1. POST PGR _create as the citizen; assert status PENDINGFORASSIGNMENT.
2. fetchComplaint with supToken to get the full service object.
3. POST PGR _update with workflow.action=ASSIGN, assignees=[PHASE0_SUB2]; assert status PENDINGATLME.

Stashes serviceRequestId for the two ESCALATE attempts below.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    // Create
    const createResp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizenToken, userInfo: citizenUserInfo },
        service: {
          tenantId: TENANT,
          serviceCode: SERVICE_CODE,
          description: `E2E manual ESCALATE comment test — ${new Date().toISOString()}`,
          source: 'web',
          address: { city: TENANT, locality: { code: LOCALITY_CODE }, geoLocation: { latitude: 0, longitude: 0 } },
          citizen: { name: CITIZEN_NAME, mobileNumber: CITIZEN_PHONE },
        },
        workflow: { action: 'APPLY', verificationDocuments: [] },
      }),
    });
    const createData = await assertOk(createResp, 'PGR _create');
    serviceRequestId = createData.ServiceWrappers[0].service.serviceRequestId;
    expect(createData.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGFORASSIGNMENT');

    // Assign
    const full = await fetchComplaint(supToken, supUserInfo, serviceRequestId);
    const assignResp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: supToken, userInfo: supUserInfo },
        service: full,
        workflow: {
          action: 'ASSIGN',
          assignees: [PHASE0_SUB2_UUID],
          comments: 'Assigned to PHASE0_SUB2 for manual ESCALATE comment test',
        },
      }),
    });
    const assignData = await assertOk(assignResp, 'PGR ASSIGN');
    expect(assignData.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    console.log(`[${serviceRequestId}] PENDINGFORASSIGNMENT → PENDINGATLME (assigned to PHASE0_SUB2)`);
  });

  test('2 — ESCALATE without comments → HTTP 400 ESCALATE_COMMENT_REQUIRED', {
    annotation: {
      type: 'description',
      description: `The validator must reject any caller-driven ESCALATE that lacks a non-empty workflow.comments string. PHASE0_SUP carries GRO (not AUTO_ESCALATE) so the validator's bypass for scheduler calls does NOT apply here.

Steps:
1. fetchComplaint to load the current service object.
2. POST _update as PHASE0_SUP with workflow { action: 'ESCALATE', assignees: [PHASE0_SUP_UUID] } and NO comments key.
3. Assert HTTP status === 400.
4. Parse response body; assert at least one Errors[].code === 'ESCALATE_COMMENT_REQUIRED'.

A 200 here is the most important regression in this suite — it means the validator stopped firing for human supervisors and re-opens the audit-trail gap the validator was added to close.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:regression', '@layer:api', '@persona:employee'] }, async () => {
    const full = await fetchComplaint(supToken, supUserInfo, serviceRequestId);
    expect(full).toBeTruthy();

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: supToken, userInfo: supUserInfo },
        service: full,
        workflow: {
          action: 'ESCALATE',
          assignees: [PHASE0_SUP_UUID],
          // intentionally omitting `comments`
        },
      }),
    });

    expect(resp.status, 'ESCALATE without comments must return 400').toBe(400);
    const body: any = await resp.json().catch(() => ({}));
    const errCodes: string[] = (body?.Errors ?? []).map((e: any) => e.code).filter(Boolean);
    expect(
      errCodes,
      `expected ESCALATE_COMMENT_REQUIRED; got ${JSON.stringify(body).slice(0, 400)}`,
    ).toContain('ESCALATE_COMMENT_REQUIRED');
    console.log(`Comment-less ESCALATE correctly rejected with ${errCodes.join(',')}`);
  });

  test('3 — ESCALATE with comments → HTTP 200, status flips to PENDINGATSUPERVISOR', {
    annotation: {
      type: 'description',
      description: `Confirms the validator's positive path: when workflow.comments is present, the same request succeeds. We also assert the workflow actually transitioned (PENDINGATLME → PENDINGATSUPERVISOR with PHASE0_SUP as the new assignee) so this test isn't just checking the validator gate but also that the existing escalation path still works end-to-end.

Steps:
1. fetchComplaint again (state may have changed from step 2's failure).
2. POST _update with workflow { action: 'ESCALATE', assignees: [PHASE0_SUP_UUID], comments: 'Please escalate' }.
3. assertOk (HTTP 200).
4. Assert response service.applicationStatus !== 'PENDINGATLME' — the workflow moved.
5. Assert response service.applicationStatus === 'PENDINGATSUPERVISOR' (the expected next state for ESCALATE on PENDINGATLME).

If step 5 starts failing while step 4 still passes, the workflow's ESCALATE nextState was changed — open a ticket and pin the expected state in this assertion.`,
    },
    tag: ['@area:pgr', '@area:escalation', '@kind:regression', '@layer:api', '@persona:employee'] }, async () => {
    const full = await fetchComplaint(supToken, supUserInfo, serviceRequestId);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: supToken, userInfo: supUserInfo },
        service: full,
        workflow: {
          action: 'ESCALATE',
          assignees: [PHASE0_SUP_UUID],
          comments: 'Please escalate',
        },
      }),
    });
    const data = await assertOk(resp, 'ESCALATE with comments');
    const newStatus = data.ServiceWrappers?.[0]?.service?.applicationStatus;
    console.log(`Post-ESCALATE status: ${newStatus}`);
    expect(newStatus).not.toBe('PENDINGATLME');
    expect(newStatus).toBe('PENDINGATSUPERVISOR');
  });
});
