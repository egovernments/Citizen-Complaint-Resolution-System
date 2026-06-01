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
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS, FIXED_OTP,
  DEFAULT_PASSWORD,
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
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;
  let serviceRequestId: string;

  test('1 — acquire admin and citizen tokens', async () => {
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

  test('2 — citizen creates complaint', async () => {
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

  test('3 — admin assigns complaint', async () => {
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: { action: 'ASSIGN', comments: 'Assigned by API E2E test' },
      }),
    });

    expect(resp.ok).toBe(true);
    const data: any = await resp.json();
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    console.log(`${serviceRequestId} → PENDINGATLME`);
  });

  test('4 — admin resolves complaint', async () => {
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: { action: 'RESOLVE', comments: 'Resolved by API E2E test' },
      }),
    });

    expect(resp.ok).toBe(true);
    const data: any = await resp.json();
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('RESOLVED');
    console.log(`${serviceRequestId} → RESOLVED`);
  });

  test('5 — citizen verifies complaint is resolved', async () => {
    const service = await fetchComplaint(citizenToken, citizenUserInfo, serviceRequestId);
    expect(service.applicationStatus).toBe('RESOLVED');
    console.log(`Citizen confirms ${serviceRequestId} is RESOLVED`);
  });
});
