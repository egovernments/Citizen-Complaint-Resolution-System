/**
 * Citizen reopen-complaint UI — Story 7.1.
 *
 * State-gated flow. Reopen requires the complaint to be in `RESOLVED`
 * (server-side check). Same beforeAll pattern as rate.spec.ts:
 *   1. API-register a citizen.
 *   2. API-file a complaint.
 *   3. ADMIN ASSIGN + RESOLVE.
 *   4. Walk the citizen reopen UI for step-0 contract.
 *
 * Asserts step 0 (Reason) renders the catalogued title + 4 radio
 * options. Subsequent steps (Upload / Additional / Response) aren't
 * walked here — too brittle without an explicit fixture, and the doc
 * marks them inferred. If they get wired up cleanly, extend this spec
 * + Story 7.1 in the same PR.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { getDigitToken } from '../utils/auth';
import { pgrCreate, resolveServiceCode } from '../utils/launch-fixes/api';
import {
  ADMIN_PASS,
  ADMIN_USER,
  BASE_URL,
  DEFAULT_PASSWORD,
  FIXED_OTP,
  LOCALITY_CODE,
  ROOT_TENANT,
  SERVICE_CODE,
  TENANT,
  generateCitizenPhone,
} from '../utils/env';

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = `PW Reopen ${Date.now()}`;

interface CitizenAuth {
  token: string;
  userInfo: Record<string, unknown>;
}

async function registerCitizenAPI(phone: string): Promise<CitizenAuth> {
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: phone, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  });

  const oauth = async () =>
    fetch(`${BASE_URL}/user/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: phone,
        password: FIXED_OTP,
        tenantId: ROOT_TENANT,
        scope: 'read',
        userType: 'CITIZEN',
      }).toString(),
    });

  let resp = await oauth();
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
    resp = await oauth();
  }

  const data = (await resp.json()) as { access_token: string; UserRequest: Record<string, unknown> };
  return { token: data.access_token, userInfo: data.UserRequest };
}

async function fetchService(token: string, userInfo: Record<string, unknown>, srId: string) {
  const r = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${srId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data = (await r.json()) as { ServiceWrappers: Array<{ service: unknown }> };
  return data.ServiceWrappers[0].service;
}

async function workflowAction(
  token: string,
  userInfo: Record<string, unknown>,
  service: unknown,
  action: string,
  comments: string,
): Promise<void> {
  const r = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo },
      service,
      workflow: { action, comments },
    }),
  });
  expect(r.ok, `workflow action ${action} should succeed`).toBe(true);
}

test.describe('Citizen reopen-complaint UI', () => {
  let serviceRequestId: string;

  test.beforeAll(async () => {
    test.setTimeout(120_000);

    const citizen = await registerCitizenAPI(CITIZEN_PHONE);
    // Resolve a valid service code for this deployment (ke uses different codes
    // than the default SERVICE_CODE which may only exist on Ethiopia).
    const resolvedServiceCode = await resolveServiceCode(BASE_URL, citizen.token, TENANT, SERVICE_CODE);
    const created = await pgrCreate({
      baseUrl: BASE_URL,
      auth: citizen,
      tenantId: TENANT,
      serviceCode: resolvedServiceCode,
      localityCode: LOCALITY_CODE,
      description: 'PW reopen UI test — auto-resolved by spec',
      citizenName: CITIZEN_NAME,
      citizenPhone: CITIZEN_PHONE,
    });
    serviceRequestId = created.serviceRequestId;

    const admin = await getDigitToken({
      tenant: ROOT_TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });
    const adminUserInfo = admin.UserRequest as Record<string, unknown>;

    let svc = await fetchService(admin.access_token, adminUserInfo, serviceRequestId);
    await workflowAction(admin.access_token, adminUserInfo, svc, 'ASSIGN', 'PW assign');
    svc = await fetchService(admin.access_token, adminUserInfo, serviceRequestId);
    await workflowAction(admin.access_token, adminUserInfo, svc, 'RESOLVE', 'PW resolve');

    console.log(`Seeded ${serviceRequestId} → RESOLVED for ${CITIZEN_PHONE}`);
  });

  test('reopen step 0 renders title + 4 reason radios + Next button', {
    annotation: {
      type: 'description',
      description: `Story 7.1 contract for /citizen/pgr/reopen/{srid} step 0: the page renders the heading "Choose Reason to Re-open the Complaint", the four radio reasons, and a Next control. Subsequent steps (Upload / Additional / Response) aren't walked here because they're inferred in the doc and brittle without an explicit fixture.

Steps:
1. setTimeout 120s; citizenOtpLogin.
2. Navigate to /digit-ui/citizen/pgr/reopen/{seeded SR id} (seeded by beforeAll → register + create + ASSIGN + RESOLVE).
3. Wait 5s; assert body does NOT contain "Something went wrong".
4. Assert body matches /Choose Reason to Re-open the Complaint/.
5. For each reason ['No work was done','Only partial work was done','Employee did not turn up','No permanent solution'], assert body contains it.
6. Assert body matches /Next/i (Next is sometimes a styled element, not always a semantic button).

beforeAll is API-only because the reopen UI requires the complaint to be in RESOLVED state and the citizen needs to own it.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:api', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page, CITIZEN_PHONE);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/reopen/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');
    await expect(body).toContainText(/Choose Reason to Re-open the Complaint/);

    // Four radio reasons — Story 7.1 enumeration
    for (const reason of [
      'No work was done',
      'Only partial work was done',
      'Employee did not turn up',
      'No permanent solution',
    ]) {
      await expect(
        body,
        `reopen reason "${reason}" missing`,
      ).toContainText(reason);
    }

    // Next control present (rendered as a styled element on this build,
    // not always a semantic <button>).
    await expect(
      body,
      'reopen step 0 should expose a Next control',
    ).toContainText(/Next/i);
  });
});
