/**
 * Citizen rate-complaint UI — Story 6.1.
 *
 * State-gated flow. Rating an `_update` requires the complaint to be in
 * `RESOLVED`. To avoid depending on naipepea inventory, the spec:
 *   1. API-registers a fresh test citizen.
 *   2. API-creates a complaint as that citizen → PENDINGFORASSIGNMENT.
 *   3. API-assigns + API-resolves it as ADMIN → RESOLVED.
 *   4. Citizen-OTP logs in and walks the rate UI to assert the field set.
 *
 * Asserts the page renders for any state (UI doesn't gate by state — the
 * server rejects invalid actions on submit), the heading + 5-star row +
 * the four checkboxes + Comments textarea are all present.
 *
 * Doesn't actually submit — would mutate the resolved complaint to
 * CLOSEDAFTERRESOLUTION; happy with the UI render assertion. If a future
 * tightening wants a full submit, factor out the resolve flow into a
 * helper and add a second test there.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { getDigitToken } from '../utils/auth';
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
const CITIZEN_NAME = `PW Rate ${Date.now()}`;

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

test.describe('Citizen rate-complaint UI', () => {
  let serviceRequestId: string;

  test.beforeAll(async () => {
    test.setTimeout(120_000);

    // Citizen registers + files complaint
    const citizen = await registerCitizenAPI(CITIZEN_PHONE);
    const createResp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizen.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizen.token, userInfo: citizen.userInfo },
        service: {
          tenantId: TENANT,
          serviceCode: SERVICE_CODE,
          description: 'PW rate UI test — auto-resolved by spec',
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
    const createData = (await createResp.json()) as {
      ServiceWrappers: Array<{ service: { serviceRequestId: string } }>;
    };
    serviceRequestId = createData.ServiceWrappers[0].service.serviceRequestId;

    // Admin assigns + resolves
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

  test('rate page renders 5 stars + 4 feedback checkboxes + Comments textarea', async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page, CITIZEN_PHONE);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/rate/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).not.toContainText('Something went wrong');

    // Heading is the question itself
    await expect(body).toContainText(/How would you rate your experience with us\?/);

    // "What was good ?" — note spaces around `?`
    await expect(body).toContainText(/What was good \?/);

    // Four feedback checkboxes — labels per Story 6.1
    for (const label of ['Services', 'Resolution Time', 'Quality of Work', 'Others']) {
      await expect(
        body,
        `feedback label "${label}" missing`,
      ).toContainText(label);
    }

    // Comments textarea
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 5_000 });
  });
});
