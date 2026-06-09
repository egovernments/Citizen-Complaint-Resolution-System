/**
 * Lifecycle fixtures setup — runs once before any chromium test.
 *
 * Creates two complaints against the configured tenant:
 *  1. NON-TERMINAL: left at PENDINGFORASSIGNMENT.
 *  2. TERMINAL+RATED: walked through ASSIGN → RESOLVE → RATE
 *     to land at CLOSEDAFTERRESOLUTION with a 4-star rating.
 *
 * Writes `lifecycle-fixtures.json` next to `auth.json` so downstream
 * specs can read deterministic, deployment-fresh SRIDs instead of
 * pinning to historical seed data.
 *
 * Each transition asserts the workflow truths: status, workflow
 * action history, fields populated. If any assertion fails the
 * dependent chromium project never runs.
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS, FIXED_OTP,
  DEFAULT_PASSWORD,
  GRO_USER, GRO_PASS, EMPLOYEE_USER, EMPLOYEE_PASS,
  SERVICE_CODE, LOCALITY_CODE,
  generateCitizenPhone,
} from '../utils/env';
import { writeLifecycleFixtures, LifecycleFixtures } from '../utils/lifecycle-fixtures';

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = 'Lifecycle Setup Citizen';

interface Tokens {
  adminToken: string;
  adminUserInfo: Record<string, unknown>;
  groToken: string;
  groUserInfo: Record<string, unknown>;
  lmeToken: string;
  lmeUserInfo: Record<string, unknown>;
  citizenToken: string;
  citizenUserInfo: Record<string, unknown>;
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
  if (!resp.ok) throw new Error(`fetchComplaint ${srid}: HTTP ${resp.status}`);
  const data: any = await resp.json();
  return data.ServiceWrappers[0].service;
}

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
  if (!resp.ok) throw new Error(`citizen login failed: HTTP ${resp.status}`);
  const data: any = await resp.json();
  return { token: data.access_token, userInfo: data.UserRequest };
}

async function acquireTokens(): Promise<Tokens> {
  const adminResp = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  expect(adminResp.access_token, 'ADMIN must log in').toBeTruthy();

  const groResp = await getDigitToken({ tenant: ROOT_TENANT, username: GRO_USER, password: GRO_PASS });
  expect(groResp.access_token, `GRO user ${GRO_USER} must log in (set GRO_USER env)`).toBeTruthy();

  const lmeResp = await getDigitToken({ tenant: ROOT_TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });
  expect(lmeResp.access_token, `LME user ${EMPLOYEE_USER} must log in (set EMPLOYEE_USER env)`).toBeTruthy();

  const citizenResp = await registerCitizen(CITIZEN_PHONE);
  return {
    adminToken: adminResp.access_token, adminUserInfo: adminResp.UserRequest as Record<string, unknown>,
    groToken: groResp.access_token, groUserInfo: groResp.UserRequest as Record<string, unknown>,
    lmeToken: lmeResp.access_token, lmeUserInfo: lmeResp.UserRequest as Record<string, unknown>,
    citizenToken: citizenResp.token, citizenUserInfo: citizenResp.userInfo,
  };
}

async function createComplaint(t: Tokens, descriptionTag: string): Promise<string> {
  const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.citizenToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: t.citizenToken, userInfo: t.citizenUserInfo },
      service: {
        tenantId: TENANT,
        serviceCode: SERVICE_CODE,
        description: `lifecycle setup ${descriptionTag} — ${new Date().toISOString()}`,
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
  expect(resp.ok, `create complaint (${descriptionTag}) HTTP ${resp.status}`).toBe(true);
  const data: any = await resp.json();
  const srv = data.ServiceWrappers[0].service;
  const srid: string = srv.serviceRequestId;

  // Assert truths at this stage
  expect(srid, 'response must contain serviceRequestId').toMatch(/^[A-Z]+-PGR-/);
  expect(srv.applicationStatus, `${descriptionTag} initial status`).toBe('PENDINGFORASSIGNMENT');
  expect(srv.citizen?.mobileNumber, 'citizen mobile must echo through').toBe(CITIZEN_PHONE);

  return srid;
}

async function assignComplaint(t: Tokens, srid: string): Promise<void> {
  const fullService = await fetchComplaint(t.groToken, t.groUserInfo, srid);
  const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.groToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: t.groToken, userInfo: t.groUserInfo },
      service: fullService,
      workflow: { action: 'ASSIGN', assignes: [t.lmeUserInfo.uuid], comments: 'lifecycle setup assign' },
    }),
  });
  expect(resp.ok, `ASSIGN ${srid} as GRO must succeed`).toBe(true);
  const data: any = await resp.json();
  expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
}

async function resolveComplaint(t: Tokens, srid: string): Promise<void> {
  const fullService = await fetchComplaint(t.lmeToken, t.lmeUserInfo, srid);
  const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.lmeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: t.lmeToken, userInfo: t.lmeUserInfo },
      service: fullService,
      workflow: { action: 'RESOLVE', comments: 'lifecycle setup resolve' },
    }),
  });
  expect(resp.ok, `RESOLVE ${srid} as LME must succeed`).toBe(true);
  const data: any = await resp.json();
  expect(data.ServiceWrappers[0].service.applicationStatus).toBe('RESOLVED');
}

async function rateComplaint(t: Tokens, srid: string, rating: number): Promise<void> {
  const fullService = await fetchComplaint(t.citizenToken, t.citizenUserInfo, srid);
  fullService.rating = rating;
  const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.citizenToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: t.citizenToken, userInfo: t.citizenUserInfo },
      service: fullService,
      workflow: { action: 'RATE', comments: 'lifecycle setup rating' },
    }),
  });
  expect(resp.ok, `RATE ${srid} as citizen must succeed`).toBe(true);
  const data: any = await resp.json();
  expect(data.ServiceWrappers[0].service.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');
  expect(data.ServiceWrappers[0].service.rating).toBe(rating);
}

test('seed lifecycle fixtures (one non-terminal + one terminal-with-rating complaint)', async () => {
  console.log(`[lifecycle.setup] tenant=${TENANT} citizen=${CITIZEN_PHONE}`);
  const tokens = await acquireTokens();
  console.log('[lifecycle.setup] tokens acquired');

  // Complaint 1: non-terminal, left at PENDINGFORASSIGNMENT
  const nonTerminal = await createComplaint(tokens, 'non-terminal');
  console.log(`[lifecycle.setup] NON_TERMINAL ${nonTerminal} → PENDINGFORASSIGNMENT`);

  // Complaint 2: walk it end-to-end to CLOSEDAFTERRESOLUTION + rating
  const terminal = await createComplaint(tokens, 'terminal-rated');
  console.log(`[lifecycle.setup] terminal-track ${terminal} → PENDINGFORASSIGNMENT (will walk forward)`);
  await assignComplaint(tokens, terminal);
  console.log(`[lifecycle.setup] terminal-track ${terminal} → PENDINGATLME`);
  await resolveComplaint(tokens, terminal);
  console.log(`[lifecycle.setup] terminal-track ${terminal} → RESOLVED`);
  await rateComplaint(tokens, terminal, 4);
  console.log(`[lifecycle.setup] terminal-track ${terminal} → CLOSEDAFTERRESOLUTION rating=4`);

  // Persist the fixtures so downstream specs can read them.
  const fixtures: LifecycleFixtures = {
    generated_at: new Date().toISOString(),
    tenant: TENANT,
    complaints: {
      non_terminal: nonTerminal,
      terminal_rated: terminal,
    },
    citizen: { phone: CITIZEN_PHONE, name: CITIZEN_NAME },
  };
  const path = writeLifecycleFixtures(fixtures);
  console.log(`[lifecycle.setup] wrote fixtures to ${path}`);
});
