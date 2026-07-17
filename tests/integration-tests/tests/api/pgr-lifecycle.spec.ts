/**
 * PGR Lifecycle — API-only
 *
 * Tests the complete PGR complaint lifecycle using only API calls (no browser):
 *   1. Acquire admin + citizen tokens
 *   2. Citizen creates complaint
 *   3. Admin assigns complaint
 *   4. Admin resolves complaint
 *   5. Citizen verifies resolved status
 *
 * Run: npx playwright test tests/specs/pgr-lifecycle-api.spec.ts
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { getPrincipal } from '../utils/employee-ui';
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS, FIXED_OTP,
  DEFAULT_PASSWORD,
  GRO_USER, GRO_PASS, EMPLOYEE_USER, EMPLOYEE_PASS,
  SERVICE_CODE, LOCALITY_CODE,
  generateCitizenPhone,
} from '../utils/env';

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = 'E2E API Citizen';

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
  // Send OTP (mock — always succeeds)
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: phone, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  });

  // Try login first (citizen may already exist)
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
    // Register with a valid password (DIGIT requires 8+ chars with upper/lower/digit/special).
    // The otpReference validates against the mock OTP service.
    // After registration, OAuth login uses FIXED_OTP as password for CITIZEN userType.
    await fetch(`${BASE_URL}/user/citizen/_create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker' },
        user: {
          name: CITIZEN_NAME,
          userName: phone,
          mobileNumber: phone,
          password: DEFAULT_PASSWORD,
          tenantId: ROOT_TENANT,
          type: 'CITIZEN',
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

test.describe.serial('PGR lifecycle — API only', () => {
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  // PGR workflow gates actions by role: ASSIGN needs GRO, RESOLVE needs PGR_LME.
  // ADMIN/SUPERUSER is authorized for neither, so each transition is driven by
  // the persona the deployment actually requires.
  let groToken: string;
  let groUserInfo: Record<string, unknown>;
  let lmeToken: string;
  let lmeUserInfo: Record<string, unknown>;
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;
  let serviceRequestId: string;

  test('1 — acquire admin and citizen tokens', {
    annotation: {
      type: 'description',
      description: `Token-acquisition step of the API-only PGR lifecycle. Logs the configured ADMIN user in (root tenant) and registers a brand-new citizen via the OTP/registration helper using a freshly-generated phone — so the lifecycle has both ends of the request/resolve flow.

Steps:
1. Call getDigitToken with ROOT_TENANT, ADMIN_USER, ADMIN_PASS; assert the response contains an access_token.
2. Stash adminToken + adminUserInfo for later steps.
3. Call registerCitizen(CITIZEN_PHONE) which sends OTP, then either logs in or creates the citizen + retries login.
4. Assert the citizen response has a token; stash citizenToken + citizenUserInfo.

First link in a serial chain — every later step skips if this fails.`,
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

    // GRO performs ASSIGN; PGR_LME performs RESOLVE. These employee personas
    // may live at the CITY tenant (e.g. EMP001 on mz.maputo), not the root
    // where ADMIN lives — so authenticate via getPrincipal, which probes
    // CITY→ROOT and returns null only when neither tenant accepts them.
    const gro = await getPrincipal(GRO_USER, GRO_PASS);
    expect(gro, `GRO user ${GRO_USER} must log in (tried CITY + ROOT tenants)`).toBeTruthy();
    groToken = gro!.token;
    groUserInfo = gro!.userInfo;

    const lme = await getPrincipal(EMPLOYEE_USER, EMPLOYEE_PASS);
    expect(lme, `LME user ${EMPLOYEE_USER} must log in (tried CITY + ROOT tenants)`).toBeTruthy();
    lmeToken = lme!.token;
    lmeUserInfo = lme!.userInfo;

    const citizenResp = await registerCitizen(CITIZEN_PHONE);
    expect(citizenResp.token).toBeTruthy();
    citizenToken = citizenResp.token;
    citizenUserInfo = citizenResp.userInfo;
    console.log(`Admin and citizen (${CITIZEN_PHONE}) tokens acquired`);
  });

  test('2 — citizen creates complaint', {
    annotation: {
      type: 'description',
      description: `Drives the citizen-create leg of the PGR lifecycle directly through pgr-services. Constructs a service object with the seeded SERVICE_CODE + LOCALITY_CODE (must include a non-null geoLocation — the persister NPEs without it), POSTs APPLY, and asserts the new complaint lands in PENDINGFORASSIGNMENT.

Steps:
1. POST /pgr-services/v2/request/_create with citizen token, full service object (tenantId, serviceCode, description with timestamp, source=web, address, citizen).
2. Workflow body: { action: 'APPLY', verificationDocuments: [] }.
3. Assert the HTTP response is ok.
4. Stash data.ServiceWrappers[0].service.serviceRequestId.
5. Assert applicationStatus === 'PENDINGFORASSIGNMENT'.

geoLocation is intentionally set to {0,0} — non-null is the contract; the actual coordinates don't matter for this lifecycle.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizenToken, userInfo: citizenUserInfo },
        service: {
          tenantId: TENANT,
          serviceCode: SERVICE_CODE,
          description: `E2E API test — ${new Date().toISOString()}`,
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

    expect(resp.ok).toBe(true);
    const data: any = await resp.json();
    serviceRequestId = data.ServiceWrappers[0].service.serviceRequestId;
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGFORASSIGNMENT');
    console.log(`Complaint created: ${serviceRequestId} → PENDINGFORASSIGNMENT`);
  });

  test('3 — admin assigns complaint', {
    annotation: {
      type: 'description',
      description: `Drives the assignment transition. PGR _update requires the FULL service object back (id, source, address — not just the SR ID), so the test re-fetches the complaint first, then POSTs the same payload with the ASSIGN workflow action.

Steps:
1. fetchComplaint() — search PGR by serviceRequestId and pull data.ServiceWrappers[0].service.
2. POST /pgr-services/v2/request/_update?tenantId=<TENANT> with admin token.
3. Body: full service object + workflow { action: 'ASSIGN', comments: 'Assigned by API E2E test' }.
4. Assert response is ok and applicationStatus === 'PENDINGATLME'.

Catches a regression where _update silently rejects payloads missing source/id (returns INVALID_SOURCE).`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const fullService = await fetchComplaint(groToken, groUserInfo, serviceRequestId);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${groToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: groToken, userInfo: groUserInfo },
        service: fullService,
        // GRO assigns the complaint to the PGR_LME who will resolve it.
        workflow: { action: 'ASSIGN', assignes: [lmeUserInfo.uuid], comments: 'Assigned by API E2E test' },
      }),
    });

    expect(resp.ok, `ASSIGN as ${GRO_USER} (GRO) should be authorized`).toBe(true);
    const data: any = await resp.json();
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    console.log(`${serviceRequestId} → PENDINGATLME`);
  });

  test('4 — admin resolves complaint', {
    annotation: {
      type: 'description',
      description: `Drives the resolve transition from PENDINGATLME → RESOLVED. Same shape as the assign step: re-fetch the full service object, then POST _update with action: RESOLVE.

Steps:
1. fetchComplaint() to pull the full service object as it currently sits in PGR.
2. POST /pgr-services/v2/request/_update?tenantId=<TENANT> with admin token.
3. Body: full service object + workflow { action: 'RESOLVE', comments: 'Resolved by API E2E test' }.
4. Assert response is ok and applicationStatus === 'RESOLVED'.

This is the second-to-last step in the lifecycle; the citizen-verify step that follows confirms the citizen-side search reflects the same state.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const fullService = await fetchComplaint(lmeToken, lmeUserInfo, serviceRequestId);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${lmeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: lmeToken, userInfo: lmeUserInfo },
        service: fullService,
        workflow: { action: 'RESOLVE', comments: 'Resolved by API E2E test' },
      }),
    });

    expect(resp.ok, `RESOLVE as ${EMPLOYEE_USER} (PGR_LME) should be authorized`).toBe(true);
    const data: any = await resp.json();
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('RESOLVED');
    console.log(`${serviceRequestId} → RESOLVED`);
  });

  test('5 — citizen verifies complaint is resolved', {
    annotation: {
      type: 'description',
      description: `Closes the loop: from the citizen's token, the complaint must show as RESOLVED. Catches role-based filtering bugs where the admin sees one state but the citizen-scoped search returns a different (or empty) result.

Steps:
1. fetchComplaint() using the citizen token + userInfo.
2. Assert service.applicationStatus === 'RESOLVED'.

If the citizen sees PENDINGATLME or 0 results, role-scoped search is broken — the citizen would never know their complaint was handled.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@layer:api', '@persona:cross'] }, async () => {
    const service = await fetchComplaint(citizenToken, citizenUserInfo, serviceRequestId);
    expect(service.applicationStatus).toBe('RESOLVED');
    console.log(`Citizen confirms ${serviceRequestId} is RESOLVED`);
  });
});
