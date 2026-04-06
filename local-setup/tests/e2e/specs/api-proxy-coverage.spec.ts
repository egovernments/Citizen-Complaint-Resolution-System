/**
 * API Proxy Coverage Test
 *
 * Validates that every API endpoint the frontend calls works correctly
 * through the token-exchange-svc v2 proxy with KC JWT authentication.
 *
 * This test captures all network requests during a full employee + citizen
 * flow and verifies:
 * 1. Every API call gets a non-error response (not 500/502)
 * 2. JWT-authenticated calls are proxied correctly
 * 3. No API calls are blocked or dropped by the proxy
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://keycloak-sandbox.live.digit.org';

interface ApiCall {
  method: string;
  path: string;
  status: number;
  duration: number;
}

test.describe('API Proxy Coverage', () => {
  test('all employee flow APIs return valid responses through proxy', async ({ page }) => {
    test.slow(); // This test navigates through multiple pages

    const apiCalls: ApiCall[] = [];
    const apiErrors: string[] = [];

    // Capture all API calls (exclude static assets, CDN, fonts)
    page.on('response', (resp) => {
      const url = resp.url();
      if (!url.includes(BASE_URL.replace('https://', '').replace('http://', ''))) return;
      if (url.includes('/digit-ui/') && !url.includes('/auth/')) return;
      if (url.includes('unpkg') || url.includes('fonts') || url.includes('s3.ap')) return;

      const path = url.replace(BASE_URL, '').split('?')[0];
      const status = resp.status();

      apiCalls.push({
        method: resp.request().method(),
        path,
        status,
        duration: 0,
      });

      // Track server errors (proxy failures)
      if (status >= 500) {
        apiErrors.push(`${resp.request().method()} ${path} → ${status}`);
      }
    });

    // 1. Login
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    const pwdField = page.getByPlaceholder(/password/i);
    await pwdField.waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByPlaceholder(/username/i).fill('ADMIN');
    await pwdField.fill('eGov@123');

    const tenantSelect = page.locator('select').first();
    if (await tenantSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tenantSelect.selectOption({ label: 'City A' }).catch(() => {});
    }

    await page.getByRole('button', { name: /login/i }).click();
    await page.waitForURL(/\/employee/, { timeout: 30_000 });
    await page.waitForTimeout(3000);

    // 2. Employee home — triggers MDMS, localization, access, HRMS calls
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // 3. PGR Inbox — triggers PGR search, workflow, boundary calls
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/inbox-v2`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    // === Assertions ===

    // Must have called /auth/login (BFF)
    const loginCalls = apiCalls.filter((c) => c.path === '/auth/login');
    expect(loginCalls.length).toBeGreaterThanOrEqual(1);
    expect(loginCalls[0].status).toBeLessThan(400);

    // Must have called MDMS
    const mdmsCalls = apiCalls.filter((c) => c.path.includes('/mdms-v2/'));
    expect(mdmsCalls.length).toBeGreaterThanOrEqual(1);
    expect(mdmsCalls.every((c) => c.status < 500)).toBe(true);

    // Must have called localization
    const locCalls = apiCalls.filter((c) => c.path.includes('/localization/'));
    expect(locCalls.length).toBeGreaterThanOrEqual(1);
    expect(locCalls.every((c) => c.status < 500)).toBe(true);

    // Must have called access control
    const accessCalls = apiCalls.filter((c) => c.path.includes('/access/'));
    expect(accessCalls.length).toBeGreaterThanOrEqual(1);
    expect(accessCalls.every((c) => c.status < 500)).toBe(true);

    // No 500/502 errors from proxy
    expect(apiErrors).toEqual([]);

    // Print summary
    const uniquePaths = new Map<string, { method: string; status: number; count: number }>();
    for (const call of apiCalls) {
      const key = `${call.method} ${call.path}`;
      if (!uniquePaths.has(key)) {
        uniquePaths.set(key, { method: call.method, status: call.status, count: 1 });
      } else {
        uniquePaths.get(key)!.count++;
      }
    }
    console.log(`\n=== API Coverage: ${uniquePaths.size} unique endpoints ===`);
    for (const [path, info] of uniquePaths) {
      console.log(`  ${info.status} ${path} (×${info.count})`);
    }
  });

  test('all API calls carry JWT through proxy (no 401s after login)', async ({ page }) => {
    const unauthorizedCalls: string[] = [];

    page.on('response', (resp) => {
      const url = resp.url();
      if (!url.includes(BASE_URL.replace('https://', '').replace('http://', ''))) return;
      if (url.includes('/digit-ui/') || url.includes('/auth/login')) return;
      if (url.includes('unpkg') || url.includes('fonts') || url.includes('s3.ap')) return;
      // KC SSO iframe calls are expected to return 403
      if (url.includes('/realms/') && url.includes('iframe')) return;
      if (url.includes('/3p-cookies/')) return;

      if (resp.status() === 401) {
        const path = url.replace(BASE_URL, '').split('?')[0];
        unauthorizedCalls.push(`${resp.request().method()} ${path}`);
      }
    });

    // Login
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    const pwdField = page.getByPlaceholder(/password/i);
    await pwdField.waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByPlaceholder(/username/i).fill('ADMIN');
    await pwdField.fill('eGov@123');
    await page.getByRole('button', { name: /login/i }).click();
    await page.waitForURL(/\/employee/, { timeout: 30_000 });
    await page.waitForTimeout(3000);

    // Navigate through pages
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/inbox-v2`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    // No API call after login should return 401
    expect(unauthorizedCalls).toEqual([]);
  });

  test('MDMS, localization, and access APIs work with JWT auth', async ({ page }) => {
    // Navigate to the domain first so fetch calls are same-origin
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Get a token via BFF
    const loginResp = await page.evaluate(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ADMIN', password: 'eGov@123', tenantId: 'pg.citya' }),
      });
      return resp.json();
    }, BASE_URL);

    expect(loginResp.access_token).toBeTruthy();
    const token = loginResp.access_token;

    // Test each critical API endpoint
    const endpoints = [
      {
        name: 'MDMS search',
        url: `${BASE_URL}/mdms-v2/v1/_search`,
        body: {
          RequestInfo: { apiId: 'Rainmaker' },
          MdmsCriteria: {
            tenantId: 'pg',
            moduleDetails: [{ moduleName: 'tenant', masterDetails: [{ name: 'tenants' }] }],
          },
        },
      },
      {
        name: 'Localization search',
        url: `${BASE_URL}/localization/messages/v1/_search`,
        body: {
          RequestInfo: { apiId: 'Rainmaker' },
          tenantId: 'pg',
          locale: 'en_IN',
          module: 'rainmaker-common',
        },
      },
      {
        name: 'Access control',
        url: `${BASE_URL}/access/v1/actions/mdms/_get`,
        body: {
          RequestInfo: { apiId: 'Rainmaker' },
          rolesCodes: [{ code: 'EMPLOYEE' }],
        },
      },
      {
        name: 'PGR search',
        url: `${BASE_URL}/pgr-services/v2/request/_search?tenantId=pg.citya`,
        body: {
          RequestInfo: { apiId: 'Rainmaker' },
          tenantId: 'pg.citya',
        },
      },
      {
        name: 'Boundary search',
        url: `${BASE_URL}/boundary-service/boundary-relationships/_search?tenantId=pg.citya&hierarchyType=ADMIN`,
        body: {
          RequestInfo: { apiId: 'Rainmaker' },
        },
      },
      {
        name: 'HRMS employee count',
        url: `${BASE_URL}/egov-hrms/employees/_count`,
        body: {
          RequestInfo: { apiId: 'Rainmaker' },
          criteria: { tenantId: 'pg.citya' },
        },
      },
      {
        name: 'Workflow business service',
        url: `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=pg.citya&businessServices=PGR`,
        body: {
          RequestInfo: { apiId: 'Rainmaker' },
        },
      },
    ];

    for (const endpoint of endpoints) {
      const result = await page.evaluate(
        async ({ url, body, token }) => {
          const resp = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });
          return { status: resp.status, ok: resp.ok };
        },
        { url: endpoint.url, body: endpoint.body, token },
      );

      // API should not return 500/502 (proxy error)
      expect(
        result.status,
        `${endpoint.name} returned ${result.status}`,
      ).toBeLessThan(500);
    }
  });

  test('KC OIDC endpoints are accessible (not blocked by proxy)', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen`, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    // These endpoints go directly to Keycloak (not through proxy)
    const kcEndpoints = [
      `${BASE_URL}/realms/digit-sandbox/.well-known/openid-configuration`,
      `${BASE_URL}/realms/digit-sandbox/protocol/openid-connect/certs`,
    ];

    for (const url of kcEndpoints) {
      const resp = await page.evaluate(async (url) => {
        const r = await fetch(url);
        return { status: r.status, ok: r.ok };
      }, url);

      expect(resp.status, `${url} returned ${resp.status}`).toBe(200);
    }
  });

  test('citizen flow APIs work without authentication', async ({ page }) => {
    // Citizen language/login page should load MDMS and localization without JWT
    await page.goto(`${BASE_URL}/digit-ui/citizen`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    // These calls should work without JWT (proxy forwards unchanged)
    const mdmsResult = await page.evaluate(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/mdms-v2/v1/_search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'Rainmaker' },
          MdmsCriteria: {
            tenantId: 'pg',
            moduleDetails: [{ moduleName: 'tenant', masterDetails: [{ name: 'tenants' }] }],
          },
        }),
      });
      return { status: resp.status };
    }, BASE_URL);

    expect(mdmsResult.status).toBeLessThan(500);
  });
});

test.describe('Domain Configuration', () => {
  test('KC client has deployment domain in redirect URIs', async ({ page }) => {
    const deploymentDomain = new URL(BASE_URL).origin;

    // Check OIDC discovery to get the client registration info
    const discovery = await page.evaluate(async (baseUrl) => {
      const resp = await fetch(
        `${baseUrl}/realms/digit-sandbox/.well-known/openid-configuration`,
      );
      return resp.json();
    }, BASE_URL);

    expect(discovery.issuer).toBeTruthy();
    expect(discovery.authorization_endpoint).toBeTruthy();

    // Verify the authorization endpoint is accessible and accepts our redirect_uri
    const authUrl = new URL(discovery.authorization_endpoint);
    authUrl.searchParams.set('client_id', 'digit-sandbox-ui');
    authUrl.searchParams.set('redirect_uri', `${deploymentDomain}/digit-ui/user/login`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid');

    const authResp = await page.evaluate(async (url) => {
      const resp = await fetch(url, { redirect: 'manual' });
      return { status: resp.status, location: resp.headers.get('location') };
    }, authUrl.toString());

    // Should redirect to login page (302) or return the login page (200)
    // NOT return an error about invalid redirect_uri
    expect(
      authResp.status,
      `KC should accept redirect_uri for ${deploymentDomain}. Got ${authResp.status}. ` +
        `If this fails, add '${deploymentDomain}/*' to the KC client's redirectUris.`,
    ).not.toBe(400);
  });

  test('KC CORS allows deployment domain', async ({ page }) => {
    await page.goto(`${BASE_URL}/digit-ui/citizen`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    // Test that KC OIDC endpoint allows CORS from our domain
    const corsResult = await page.evaluate(async (baseUrl) => {
      try {
        const resp = await fetch(
          `${baseUrl}/realms/digit-sandbox/.well-known/openid-configuration`,
          { mode: 'cors' },
        );
        return { ok: resp.ok, status: resp.status, corsBlocked: false };
      } catch {
        return { ok: false, status: 0, corsBlocked: true };
      }
    }, BASE_URL);

    expect(
      corsResult.corsBlocked,
      `KC CORS blocks ${BASE_URL}. Add the domain to webOrigins in KC client config.`,
    ).toBe(false);
    expect(corsResult.ok).toBe(true);
  });
});
