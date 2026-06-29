/**
 * Citizen track-complaint flow — Stories 4.1, 5.1, 5.2.
 *
 * Files a complaint via API as the test citizen, then walks the citizen
 * UI for the My Complaints list + Complaint Detail + Timeline sections.
 * API-creates so we don't depend on naipepea inventory state for the
 * test citizen — the same phone hits the UI later for browse-only.
 *
 * Asserts the route divergence flagged in the catalogue Routes table:
 * the detail URL is `/citizen/pgr/complaints/:id` (PLURAL), NOT
 * `/complaint/details/:id` as `Routes.js` exports.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import {
  BASE_URL,
  TENANT,
  ROOT_TENANT,
  FIXED_OTP,
  DEFAULT_PASSWORD,
  SERVICE_CODE,
  LOCALITY_CODE,
  generateCitizenPhone,
} from '../utils/env';
import { readProvisionedCitizen } from '../utils/citizen-provision';

// Disable trace/video so the spec runs cleanly with --no-deps (the
// .playwright-artifacts-0 dir is only created by the full setup DAG).
test.use({ trace: 'off', video: 'off' });

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = `PW Track ${Date.now()}`;

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

async function createComplaintAPI(auth: CitizenAuth): Promise<string> {
  const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: auth.token, userInfo: auth.userInfo },
      service: {
        tenantId: TENANT,
        serviceCode: SERVICE_CODE,
        description: `PW track-complaint test — auto-filed`,
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
  expect(resp.ok, 'API _create should succeed').toBe(true);
  const data = (await resp.json()) as { ServiceWrappers: Array<{ service: { serviceRequestId: string } }> };
  return data.ServiceWrappers[0].service.serviceRequestId;
}

test.describe.serial('Citizen track-complaint', () => {
  let serviceRequestId: string;

  test.beforeAll(async () => {
    const auth = await registerCitizenAPI(CITIZEN_PHONE);
    serviceRequestId = await createComplaintAPI(auth);
    console.log(`Seeded complaint ${serviceRequestId} for ${CITIZEN_PHONE}`);
  });

  test('My Complaints list shows the seeded complaint with OPEN badge', {
    annotation: {
      type: 'description',
      description: `Story 4.1 contract for /citizen/pgr/complaints: a freshly-filed complaint (still in PENDINGFORASSIGNMENT) must appear in the citizen's My Complaints list with the OPEN badge and the localized "Pending for assignment" status text.

Steps:
1. setTimeout 120s; citizenOtpLogin.
2. Navigate to /digit-ui/citizen/pgr/complaints, wait 5s.
3. Assert body contains "My Complaints", the seeded serviceRequestId, /OPEN/, and /Pending for assignment/i.
4. Assert body does NOT contain "Something went wrong".

beforeAll is API-only — registers a fresh citizen and files a complaint via PGR _create — so the test isn't tied to whatever's currently seeded on naipepea.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page, CITIZEN_PHONE);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).toContainText('My Complaints');
    await expect(body).toContainText(serviceRequestId);
    await expect(body).toContainText(/OPEN/);
    await expect(body).toContainText(/Pending for assignment/i);
    await expect(body).not.toContainText('Something went wrong');
  });

  test('Detail page renders Summary / Details / Map / Timeline sections', {
    annotation: {
      type: 'description',
      description: `Story 5.1 / 5.2 contract for the complaint detail page. Asserts the four canonical sections are visible — Complaint Summary, Complaint Details, Complaint Timeline, plus the Application Status row and the SR id itself.

Steps:
1. setTimeout 120s; citizenOtpLogin.
2. Navigate to /digit-ui/citizen/pgr/complaints/{seeded id}, wait 5s.
3. Assert body contains "Complaint Summary", "Complaint Details", "Complaint Timeline", the SR id, and "Application Status".
4. Assert body does NOT contain "Something went wrong".

The Map widget + "Open in Maps" only render when geoLocation has non-zero coords. This spec API-seeds with {0,0} so the map isn't asserted here — wizard.spec.ts walks the UI and drops a real pin so the map renders there.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page, CITIZEN_PHONE);
    await page.goto(
      `${BASE_URL}/digit-ui/citizen/pgr/complaints/${serviceRequestId}`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.waitForTimeout(5000);

    const body = page.locator('body');
    await expect(body).toContainText('Complaint Summary');
    await expect(body).toContainText('Complaint Details');
    // Ethiopia renders "Activity timeline"; Kenya renders "Complaint Timeline".
    await expect(body).toContainText(/Complaint Timeline|Activity timeline/i);
    await expect(body).toContainText(serviceRequestId);
    await expect(body).toContainText('Application Status');

    // Map widget + "Open in Maps" button only render when geoLocation
    // has non-zero coords. This spec API-seeds with {0,0} so the map
    // can't be asserted here — wizard.spec.ts walks the UI and drops a
    // real pin, so the map renders there. Tracked under Story 5.1.

    // No crash fallback
    await expect(body).not.toContainText('Something went wrong');
  });

  test('Detail URL uses /complaints/:id (PLURAL) — Routes.js export diverges', {
    annotation: {
      type: 'description',
      description: `Documents the route divergence flagged in citizen-flows.md Routes table. The detail URL is /citizen/pgr/complaints/:id (PLURAL), NOT /complaint/details/:id as Routes.js exports. The card click is implemented via an onClick on a div (no <a> href to inspect), so the test navigates to the plural URL directly and asserts the page serves correctly.

Steps:
1. setTimeout 120s; citizenOtpLogin and visit /citizen/pgr/complaints (warm cache).
2. Navigate directly to /digit-ui/citizen/pgr/complaints/{seeded id}; wait 4s.
3. Assert page.url() matches /\\/digit-ui\\/citizen\\/pgr\\/complaints\\/<PGR_ID_PREFIX>-PGR-\\d{4}-\\d{2}-\\d{2}-\\d+/ (prefix from env).
4. Assert page.url() does NOT contain '/complaint/details/' (no auto-redirect to the singular form).
5. Assert body contains "Complaint Summary".
6. Assert body does NOT contain "Something went wrong".

If the SPA ever redirects plural → singular (or 404s), this test catches the change.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page, CITIZEN_PHONE);
    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/complaints`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    // The card click is implemented via an onClick handler on a div,
    // not an <a> anchor — there's no href to inspect. Navigate to the
    // PLURAL detail URL directly and assert it loads the detail page
    // (URL stays plural after redirect-resolution; detail content
    // renders rather than 404). The complementary test — that the
    // singular form does NOT serve the page — is captured by
    // verifying the page didn't redirect to /complaint/details/.
    await page.goto(
      `${BASE_URL}/digit-ui/citizen/pgr/complaints/${serviceRequestId}`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.waitForTimeout(4000);

    const url = page.url();
    // Deployment-specific complaint-ID prefix (NCCG on Nairobi, PG on
    // Ethiopia + ke.etoebeta) is discovered by citizen.setup.ts via
    // egov-idgen and persisted on the provisioned citizen.
    const pgrIdPrefix = readProvisionedCitizen()?.pgrIdPrefix ?? 'NCCG';
    const detailUrlRe = new RegExp(
      `/digit-ui/citizen/pgr/complaints/${pgrIdPrefix}-PGR-\\d{4}-\\d{2}-\\d{2}-\\d+`,
    );
    expect(url, 'plural /complaints/:id URL should serve the detail page').toMatch(detailUrlRe);
    expect(url, 'should NOT have redirected to the Routes.js-exported singular form').not.toContain(
      '/complaint/details/',
    );

    // Detail content renders (not a 404 / not the error fallback)
    const body = page.locator('body');
    await expect(body).toContainText('Complaint Summary');
    await expect(body).not.toContainText('Something went wrong');
  });
});
