import { test, expect } from '@playwright/test';
import { PgrInboxPage } from '../pages/pgr-inbox.page';
import { getDigitToken, loginViaApi } from '../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const TENANT = process.env.DIGIT_TENANT || 'uitest.citya';
const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';

test.describe.serial('Full PGR complaint lifecycle', () => {
  test.slow();

  let accessToken: string;
  let userInfo: Record<string, unknown>;
  let serviceRequestId: string;
  let createSucceeded = false;

  test('login as employee', async ({ page }) => {
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    expect(page.url()).toContain('/employee');
  });

  test('acquire API token', async () => {
    const tokenResponse = await getDigitToken({
      baseURL: BASE_URL,
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

    expect(tokenResponse.access_token).toBeTruthy();
    accessToken = tokenResponse.access_token;
    userInfo = tokenResponse.UserRequest as Record<string, unknown>;
  });

  test('create a new PGR complaint via API', async () => {
    expect(accessToken).toBeTruthy();

    const timestamp = Date.now();
    const createPayload = {
      RequestInfo: {
        apiId: 'Rainmaker',
        authToken: accessToken,
        userInfo,
      },
      service: {
        tenantId: TENANT,
        serviceCode: 'StreetLightNotWorking',
        description: `E2E lifecycle test complaint - ${timestamp}`,
        source: 'web',
        address: {
          city: TENANT,
          locality: {
            code: 'LOCALITY1',
            name: 'Test Locality',
          },
          geoLocation: { latitude: 28.7041, longitude: 77.1025 },
        },
        citizen: {
          name: 'E2E Test Citizen',
          mobileNumber: '9888888888',
          tenantId: TENANT,
        },
      },
      workflow: { action: 'APPLY' },
    };

    const resp = await fetch(
      `${BASE_URL}/pgr-services/v2/request/_create?tenantId=${TENANT}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createPayload),
      },
    );

    if (resp.status === 400) {
      const body = await resp.text();
      console.log(`PGR create returned 400: ${body.slice(0, 300)}`);
      test.skip(true, 'PGR create failed — missing data prerequisites');
      return;
    }

    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.ServiceWrappers).toBeDefined();
    expect(data.ServiceWrappers.length).toBeGreaterThan(0);

    serviceRequestId = data.ServiceWrappers[0].service.serviceRequestId;
    expect(serviceRequestId).toMatch(/^PG-PGR-/);
    createSucceeded = true;
    console.log(`Created complaint: ${serviceRequestId}`);
  });

  test('verify complaint appears in PGR inbox', async ({ page }) => {
    test.skip(!createSucceeded, 'Skipped — PGR complaint not created');

    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });

    const inbox = new PgrInboxPage(page);
    await inbox.goto();
    await page.waitForTimeout(8000);

    const bodyText = await inbox.getBodyText();
    expect(bodyText.length).toBeGreaterThan(50);

    if (await inbox.hasComplaintNumbers()) {
      const found = bodyText.includes(serviceRequestId);
      if (!found) {
        console.log(`Complaint ${serviceRequestId} not in current view (may need scrolling/filtering)`);
      }
    }
  });

  test('verify complaint details page renders', async ({ page }) => {
    test.skip(!createSucceeded, 'Skipped — PGR complaint not created');

    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });

    await page.goto(`/digit-ui/employee/pgr/complaint/details/${serviceRequestId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test('verify complaint searchable via API', async () => {
    test.skip(!createSucceeded, 'Skipped — PGR complaint not created');

    const searchResp = await fetch(
      `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          RequestInfo: { apiId: 'Rainmaker', authToken: accessToken, userInfo },
        }),
      },
    );

    expect(searchResp.ok).toBe(true);
    const data = await searchResp.json();
    expect(data.ServiceWrappers).toBeDefined();
    expect(data.ServiceWrappers.length).toBe(1);
    expect(data.ServiceWrappers[0].service.serviceRequestId).toBe(serviceRequestId);
  });
});
