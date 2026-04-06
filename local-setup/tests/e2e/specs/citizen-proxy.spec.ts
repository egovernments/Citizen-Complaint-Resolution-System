/**
 * Citizen Proxy Flow Test
 *
 * Simulates the EXACT flow of a new user logging in via Google SSO:
 * 1. Create a fresh KC user (simulates first-time Google SSO)
 * 2. Get a JWT for that user
 * 3. Make API calls through the proxy with that JWT
 * 4. Verify the proxy provisions a DIGIT user and proxies successfully
 *
 * This test catches the CITIZEN OTP auth bug and any other provisioning issues.
 * It must NOT use the ADMIN user — it must create a brand new CITIZEN.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://keycloak-sandbox.live.digit.org';
const KC_INTERNAL = 'http://localhost:18180';
const REALM = 'digit-sandbox';
const CLIENT_ID = 'digit-sandbox-ui';

// Generate unique test user email to avoid collisions
const TEST_EMAIL = `e2e-citizen-${Date.now()}@test.example.com`;
const TEST_PASSWORD = 'TestCitizen@123';

async function getKcAdminToken(): Promise<string> {
  const resp = await fetch(`${KC_INTERNAL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=password&client_id=admin-cli&username=admin&password=admin',
  });
  return (await resp.json()).access_token;
}

test.describe('New Citizen Proxy Flow (simulates Google SSO)', () => {
  let kcAdminToken: string;
  let kcUserId: string;
  let citizenJwt: string;

  test.beforeAll(async () => {
    kcAdminToken = await getKcAdminToken();

    // Create a fresh user in KC (simulates what Google SSO does)
    const createResp = await fetch(`${KC_INTERNAL}/admin/realms/${REALM}/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kcAdminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: TEST_EMAIL,
        email: TEST_EMAIL,
        enabled: true,
        emailVerified: true,
        firstName: 'E2E',
        lastName: 'Citizen',
        credentials: [{ type: 'password', value: TEST_PASSWORD, temporary: false }],
      }),
    });

    expect(
      createResp.status,
      `Failed to create test user in KC: ${createResp.status} ${await createResp.text()}`,
    ).toBe(201);

    // Get the user ID
    const usersResp = await fetch(
      `${KC_INTERNAL}/admin/realms/${REALM}/users?email=${encodeURIComponent(TEST_EMAIL)}&exact=true`,
      { headers: { Authorization: `Bearer ${kcAdminToken}` } },
    );
    const users = await usersResp.json();
    kcUserId = users[0].id;

    // Get a JWT for this citizen (ROPC)
    const tokenResp = await fetch(
      `${KC_INTERNAL}/realms/${REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: CLIENT_ID,
          username: TEST_EMAIL,
          password: TEST_PASSWORD,
          scope: 'openid',
        }).toString(),
      },
    );

    expect(tokenResp.ok, 'Failed to get JWT for test citizen').toBe(true);
    const tokenData = await tokenResp.json();
    citizenJwt = tokenData.access_token;
    expect(citizenJwt).toBeTruthy();
  });

  test.afterAll(async () => {
    // Cleanup: delete test user from KC
    if (kcUserId && kcAdminToken) {
      await fetch(`${KC_INTERNAL}/admin/realms/${REALM}/users/${kcUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${kcAdminToken}` },
      });
    }
  });

  test('MDMS search works for new citizen through proxy', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    const result = await page.evaluate(
      async ({ baseUrl, token }) => {
        const resp = await fetch(`${baseUrl}/mdms-v2/v1/_search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker' },
            MdmsCriteria: {
              tenantId: 'pg',
              moduleDetails: [{ moduleName: 'tenant', masterDetails: [{ name: 'tenants' }] }],
            },
          }),
        });
        const body = await resp.text();
        return { status: resp.status, body: body.substring(0, 500) };
      },
      { baseUrl: BASE_URL, token: citizenJwt },
    );

    expect(
      result.status,
      `MDMS search returned ${result.status} for new citizen. Response: ${result.body}. ` +
        `This means the proxy failed to provision the DIGIT user or get a token. ` +
        `Check token-exchange-svc logs for "getUserToken failed" errors.`,
    ).toBeLessThan(500);
  });

  test('localization search works for new citizen through proxy', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    const result = await page.evaluate(
      async ({ baseUrl, token }) => {
        const resp = await fetch(`${baseUrl}/localization/messages/v1/_search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker' },
            tenantId: 'pg',
            locale: 'en_IN',
            module: 'rainmaker-common',
          }),
        });
        return { status: resp.status };
      },
      { baseUrl: BASE_URL, token: citizenJwt },
    );

    expect(result.status).toBeLessThan(500);
  });

  test('access control works for new citizen through proxy', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    const result = await page.evaluate(
      async ({ baseUrl, token }) => {
        const resp = await fetch(`${baseUrl}/access/v1/actions/mdms/_get`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker' },
            rolesCodes: [{ code: 'CITIZEN' }],
          }),
        });
        return { status: resp.status };
      },
      { baseUrl: BASE_URL, token: citizenJwt },
    );

    expect(result.status).toBeLessThan(500);
  });

  test('PGR complaint creation works for new citizen through proxy', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    const result = await page.evaluate(
      async ({ baseUrl, token }) => {
        const resp = await fetch(`${baseUrl}/pgr-services/v2/request/_create`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker' },
            service: {
              tenantId: 'pg.citya',
              serviceCode: 'StreetLightNotWorking',
              description: 'E2E citizen proxy test complaint',
              source: 'web',
              address: {
                city: 'pg.citya',
                locality: { code: 'LOCALITY1', name: 'Test Locality' },
              },
              citizen: {
                name: 'E2E Test Citizen',
                mobileNumber: '9888888888',
                tenantId: 'pg.citya',
              },
            },
            workflow: { action: 'APPLY' },
          }),
        });
        const body = await resp.text();
        return { status: resp.status, body: body.substring(0, 500) };
      },
      { baseUrl: BASE_URL, token: citizenJwt },
    );

    // 200 = complaint created, 400 = missing data (acceptable)
    // 500 = proxy/auth failure (the bug we're catching)
    expect(
      result.status,
      `PGR create returned ${result.status} for new citizen. Response: ${result.body}`,
    ).toBeLessThan(500);
  });
});
