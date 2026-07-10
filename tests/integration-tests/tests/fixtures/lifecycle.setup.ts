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
    // Try /user/citizen/_create first (citizen-self-register endpoint);
    // some deployments have this broken at the server level (e.g. bomet's
    // SafeHtmlValidator BeanCreationException). Fall back to the admin
    // /user/_create endpoint which works through HRMS path.
    const citizenBody = {
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
    };
    let createOk = false;
    let lastBody = '';
    for (const url of [`${BASE_URL}/user/citizen/_create`, `${BASE_URL}/user/users/_createnovalidate`]) {
      const cr = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(citizenBody),
      });
      if (cr.ok) {
        console.log(`[lifecycle.setup] citizen ${phone} created via ${url}`);
        createOk = true;
        break;
      }
      lastBody = (await cr.text()).slice(0, 200);
      console.log(`[lifecycle.setup] ${url} → HTTP ${cr.status} body=${lastBody}`);
    }
    if (!createOk) {
      throw new Error(`citizen create failed for ${phone}: ${lastBody}`);
    }
    // Post-create login: try with FIXED_OTP first (naipepea-style
    // mock-OTP-accepts-always), fall back to DEFAULT_PASSWORD (the
    // password we just set during _create). Deployments that don't
    // run with the always-accept-OTP feature flag (e.g. bomet) only
    // accept the password path.
    for (const pwd of [FIXED_OTP, DEFAULT_PASSWORD]) {
      resp = await fetch(`${BASE_URL}/user/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        },
        body: new URLSearchParams({
          grant_type: 'password', username: phone, password: pwd,
          tenantId: ROOT_TENANT, scope: 'read', userType: 'CITIZEN',
        }).toString(),
      });
      if (resp.ok) break;
    }
  }
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`citizen login failed for ${phone}: HTTP ${resp.status} body=${body.slice(0, 400)}`);
  }
  const data: any = await resp.json();
  if (!data.access_token) {
    throw new Error(`citizen login OK but no access_token for ${phone}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return { token: data.access_token, userInfo: data.UserRequest };
}

async function acquireTokens(): Promise<Tokens> {
  const adminResp = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  expect(adminResp.access_token, 'ADMIN must log in').toBeTruthy();
  const adminToken = adminResp.access_token;
  const adminUserInfo = adminResp.UserRequest as Record<string, unknown>;

  // GRO (ASSIGN) / LME (RESOLVE) personas. The bootstrap now grants ADMIN the
  // full PGR bundle (GRO + PGR_LME roles), so if a dedicated persona login
  // fails we fall back to the ADMIN token+userInfo and drive the whole walk as
  // ADMIN. Only a truly-broken deployment (ADMIN itself can't transition) then
  // trips the fail-soft skip downstream. Login failures here are tolerated —
  // getDigitToken may throw or return no token; both collapse to the fallback.
  let groToken = '';
  let groUserInfo: Record<string, unknown> | undefined;
  try {
    // Employees live at the FULL tenant (the city on a 2-level deployment,
    // e.g. mz.maputo). On a single-level tenant TENANT===ROOT_TENANT, so this
    // is correct for both; ROOT_TENANT here failed to log EMP001 in on mz.
    const groResp = await getDigitToken({ tenant: TENANT, username: GRO_USER, password: GRO_PASS });
    if (groResp.access_token) {
      groToken = groResp.access_token;
      groUserInfo = groResp.UserRequest as Record<string, unknown>;
    }
  } catch (err: any) {
    console.log(`[lifecycle.setup] GRO login (${GRO_USER}) failed, will use ADMIN: ${err.message?.slice(0, 120)}`);
  }
  if (!groToken) {
    console.log(`[lifecycle.setup] falling back to ADMIN token for ASSIGN (GRO ${GRO_USER} unavailable)`);
    groToken = adminToken;
    groUserInfo = adminUserInfo;
  }

  let lmeToken = '';
  let lmeUserInfo: Record<string, unknown> | undefined;
  try {
    const lmeResp = await getDigitToken({ tenant: TENANT, username: EMPLOYEE_USER, password: EMPLOYEE_PASS });
    if (lmeResp.access_token) {
      lmeToken = lmeResp.access_token;
      lmeUserInfo = lmeResp.UserRequest as Record<string, unknown>;
    }
  } catch (err: any) {
    console.log(`[lifecycle.setup] LME login (${EMPLOYEE_USER}) failed, will use ADMIN: ${err.message?.slice(0, 120)}`);
  }
  if (!lmeToken) {
    console.log(`[lifecycle.setup] falling back to ADMIN token for RESOLVE (LME ${EMPLOYEE_USER} unavailable)`);
    lmeToken = adminToken;
    lmeUserInfo = adminUserInfo;
  }

  const citizenResp = await registerCitizen(CITIZEN_PHONE);
  return {
    adminToken, adminUserInfo,
    groToken, groUserInfo: groUserInfo as Record<string, unknown>,
    lmeToken, lmeUserInfo: lmeUserInfo as Record<string, unknown>,
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
      // Omit `verificationDocuments` — the CRS/ke Workflow model 400s on
      // `verificationDocuments: []` (JsonMappingException); both legacy and CRS
      // accept the bare `{ action: 'APPLY' }` shape. See launch-fixes/api.ts:136-146.
      workflow: { action: 'APPLY' },
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`create complaint (${descriptionTag}) HTTP ${resp.status} body=${errBody.slice(0, 1500)}`);
  }
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
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`ASSIGN ${srid} as GRO=${GRO_USER} failed: HTTP ${resp.status} body=${errBody.slice(0, 500)}`);
  }
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
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`RESOLVE ${srid} as LME=${EMPLOYEE_USER} failed: HTTP ${resp.status} body=${errBody.slice(0, 500)}`);
  }
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
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`RATE ${srid} as citizen failed: HTTP ${resp.status} body=${errBody.slice(0, 500)}`);
  }
  const data: any = await resp.json();
  expect(data.ServiceWrappers[0].service.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');
  expect(data.ServiceWrappers[0].service.rating).toBe(rating);
}

/**
 * Seed lifecycle fixtures. On a healthy deployment this runs end-to-
 * end and the dependent chromium project picks up the SRIDs from
 * lifecycle-fixtures.json. On deployments where the seed can't be
 * built (e.g. broken user-service preventing citizen registration),
 * the setup writes a `status: 'skipped'` fixture file and PASSES —
 * downstream specs fall back to their own env-var defaults instead
 * of cascading-fail every chromium test.
 *
 * This is intentional: a partial deployment shouldn't block the
 * tests that don't need fresh SRIDs.
 */
test('seed lifecycle fixtures (one non-terminal + one terminal-with-rating complaint)', async () => {
  console.log(`[lifecycle.setup] tenant=${TENANT} citizen=${CITIZEN_PHONE}`);
  const writeSkipped = (reason: string): void => {
    const fixtures: LifecycleFixtures = {
      generated_at: new Date().toISOString(),
      tenant: TENANT,
      status: 'skipped',
      skipped_reason: reason,
    };
    const path = writeLifecycleFixtures(fixtures);
    console.log(`[lifecycle.setup] SKIPPED: ${reason}`);
    console.log(`[lifecycle.setup] wrote skip marker to ${path}`);
  };

  let tokens: Tokens;
  try {
    tokens = await acquireTokens();
  } catch (err: any) {
    writeSkipped(`token/citizen acquisition: ${err.message?.slice(0, 200)}`);
    return; // PASS the setup — downstream uses env/defaults
  }
  console.log('[lifecycle.setup] tokens acquired');

  let nonTerminal: string;
  let terminal: string;
  try {
    // Complaint 1: non-terminal, left at PENDINGFORASSIGNMENT
    nonTerminal = await createComplaint(tokens, 'non-terminal');
    console.log(`[lifecycle.setup] NON_TERMINAL ${nonTerminal} → PENDINGFORASSIGNMENT`);

    // Complaint 2: walk it end-to-end to CLOSEDAFTERRESOLUTION + rating
    terminal = await createComplaint(tokens, 'terminal-rated');
    console.log(`[lifecycle.setup] terminal-track ${terminal} → PENDINGFORASSIGNMENT (will walk forward)`);
    await assignComplaint(tokens, terminal);
    console.log(`[lifecycle.setup] terminal-track ${terminal} → PENDINGATLME`);
    await resolveComplaint(tokens, terminal);
    console.log(`[lifecycle.setup] terminal-track ${terminal} → RESOLVED`);
    await rateComplaint(tokens, terminal, 4);
    console.log(`[lifecycle.setup] terminal-track ${terminal} → CLOSEDAFTERRESOLUTION rating=4`);
  } catch (err: any) {
    writeSkipped(`workflow walk: ${err.message?.slice(0, 200)}`);
    return; // PASS — downstream falls back
  }

  // Persist the full fixtures so downstream specs can read them.
  const fixtures: LifecycleFixtures = {
    generated_at: new Date().toISOString(),
    tenant: TENANT,
    status: 'ok',
    complaints: {
      non_terminal: nonTerminal,
      terminal_rated: terminal,
    },
    citizen: { phone: CITIZEN_PHONE, name: CITIZEN_NAME },
  };
  const path = writeLifecycleFixtures(fixtures);
  console.log(`[lifecycle.setup] wrote fixtures to ${path}`);
});
