import { tenantSlug } from '../utils/identity-bff';
/**
 * API Proxy Coverage Test
 *
 * Validates that every API endpoint the frontend calls works correctly
 * through the gateway with the DIGIT token the Identity BFF selects.
 *
 * This test captures all network requests during a full employee + citizen
 * flow and verifies:
 * 1. Every API call gets a non-error response (not 500/502)
 * 2. JWT-authenticated calls are proxied correctly
 * 3. No API calls are blocked or dropped by the proxy
 *
 * The Keycloak block (OIDC discovery/CORS and redirect URIs on the per-tenant
 * realm's public `digit-ui` client) was removed: #2088 deleted that realm and
 * client in favour of the Identity BFF, so it only ever skipped. Realm `digit`
 * discovery is covered by tests/keycloak/kc-api.spec.ts.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT, ROOT_TENANT, ADMIN_USER, ADMIN_PASS, LOCALES } from '../utils/env';
import { tryGetProfile } from '../utils/profile';
import { getDigitToken, loginViaApi } from '../utils/auth';


interface ApiCall {
  method: string;
  path: string;
  status: number;
  duration: number;
}

test.describe('API Proxy Coverage', () => {
  test('all employee flow APIs return valid responses through proxy', {
    tag: ['@area:proxy', '@kind:regression', '@layer:api', '@persona:cross'],
  }, async ({ page }) => {
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

    // 1. Login via token injection (portable across deployments). The digit-ui
    //    login form has diverged across builds (placeholder-less inputs, a
    //    custom city combobox, a disabled-until-valid submit) and the auth
    //    mechanism itself (classic /user/oauth/token vs the KC BFF /auth/login)
    //    differs per deployment — none of which is what this proxy-coverage
    //    test asserts. Injecting the token exercises the same post-login API
    //    surface (MDMS, localization, access, PGR, boundary, HRMS, workflow)
    //    while staying deployment-agnostic. loginViaApi navigates to /employee.
    await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    await page.waitForTimeout(3000);

    // 2. Employee home — triggers MDMS, localization, access, HRMS calls
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // 3. PGR Inbox — triggers PGR search, workflow, boundary calls
    await page.goto(`${BASE_URL}/${tenantSlug()}/digit-ui/employee/pgr/inbox-v2`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    // === Assertions ===
    // (Login itself is asserted implicitly: the authenticated MDMS/localization/
    //  access calls below only fire once the injected token is accepted.)

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

  test('all API calls carry JWT through proxy (no 401s after login)', {
    tag: ['@area:proxy', '@kind:regression', '@layer:api', '@persona:cross'],
  }, async ({ page }) => {
    const unauthorizedCalls: string[] = [];
    const authedApiCalls: string[] = [];

    page.on('response', (resp) => {
      const url = resp.url();
      if (!url.includes(BASE_URL.replace('https://', '').replace('http://', ''))) return;
      if (url.includes('/digit-ui/') || url.includes('/auth/login')) return;
      if (url.includes('unpkg') || url.includes('fonts') || url.includes('s3.ap')) return;
      // KC SSO iframe calls are expected to return 403
      if (url.includes('/realms/') && url.includes('iframe')) return;
      if (url.includes('/3p-cookies/')) return;

      const path = url.replace(BASE_URL, '').split('?')[0];
      authedApiCalls.push(`${resp.request().method()} ${path}`);
      if (resp.status() === 401) {
        unauthorizedCalls.push(`${resp.request().method()} ${path}`);
      }
    });

    // Login via token injection (portable — see the note in the first test).
    await loginViaApi(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    await page.waitForTimeout(3000);

    // Navigate through pages
    await page.goto(`${BASE_URL}/${tenantSlug()}/digit-ui/employee/pgr/inbox-v2`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    // Presence guard FIRST — without it this test is an absence assertion over a
    // possibly-empty set. If loginViaApi injected a token the SPA never used, or the
    // page failed to boot, zero calls would be recorded and `[] === []` would pass
    // while nothing was exercised. Its sibling above already asserts
    // `mdmsCalls.length >= 1`; this one did not.
    expect(
      authedApiCalls.length,
      'no authenticated API calls were observed — the 401 check would be vacuous',
    ).toBeGreaterThan(0);

    // No API call after login should return 401
    expect(unauthorizedCalls).toEqual([]);
  });

  test('MDMS, localization, and access APIs work with JWT auth', {
    tag: ['@area:proxy', '@kind:regression', '@layer:api', '@persona:cross'],
  }, async ({ page }) => {
    // Navigate to the domain first so fetch calls are same-origin
    await page.goto(`${BASE_URL}/${tenantSlug()}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Acquire a token through hosted sign-in + the BFF context exchange
    // (getDigitToken). This test is about proxy coverage of the downstream
    // service APIs, not the auth mechanism.
    const loginResp = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    expect(loginResp.access_token).toBeTruthy();
    const token = loginResp.access_token;

    // A real RequestInfo, not a bare `{apiId}`. Several DIGIT services dereference
    // these without a null check and answer an unhandled NullPointerException as a
    // 400 — pgr-services needs `userInfo` (`RequestInfo.getUserInfo().getType()`)
    // and egov-accesscontrol needs `ts` (`RequestInfo.getTs().longValue()`). With a
    // stub RequestInfo four of the seven endpoints below 400, which the old
    // `toBeLessThan(500)` assertion happily called "work with JWT auth".
    expect(
      loginResp.UserRequest,
      'token response should carry UserRequest to build a real RequestInfo',
    ).toBeTruthy();
    const requestInfo = {
      apiId: 'Rainmaker',
      ver: '.01',
      ts: 0,
      action: '_search',
      did: '1',
      key: '',
      msgId: 'proxy-coverage|en_IN',
      authToken: token,
      userInfo: loginResp.UserRequest,
    };

    // Test each critical API endpoint
    const endpoints = [
      {
        name: 'MDMS search',
        url: `${BASE_URL}/mdms-v2/v1/_search`,
        body: {
          RequestInfo: requestInfo,
          MdmsCriteria: {
            tenantId: ROOT_TENANT,
            moduleDetails: [{ moduleName: 'tenant', masterDetails: [{ name: 'tenants' }] }],
          },
        },
      },
      {
        // locale/tenantId/module are QUERY params on this service — sent in the
        // body they are simply absent and it 400s "Required request parameter
        // 'locale' ... is not present". Locale comes from the profile, not a literal.
        name: 'Localization search',
        url: `${BASE_URL}/localization/messages/v1/_search?tenantId=${ROOT_TENANT}&locale=${LOCALES[0]}&module=rainmaker-common`,
        body: { RequestInfo: requestInfo },
      },
      {
        // Needs tenantId + roleCodes (not `rolesCodes`, and not objects) — the old
        // shape 400d with "Tenant Id is required" + "Atleast One Role is Required".
        name: 'Access control',
        url: `${BASE_URL}/access/v1/actions/mdms/_get`,
        body: {
          RequestInfo: requestInfo,
          tenantId: ROOT_TENANT,
          roleCodes: ['EMPLOYEE'],
          actionMaster: 'actions-test',
          enabled: true,
        },
      },
      {
        name: 'PGR search',
        url: `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}`,
        body: { RequestInfo: requestInfo },
      },
      {
        name: 'Boundary search',
        url: `${BASE_URL}/boundary-service/boundary-relationships/_search?tenantId=${TENANT}&hierarchyType=${tryGetProfile()?.boundary.hierarchyType || 'ADMIN'}`,
        body: { RequestInfo: requestInfo },
      },
      {
        // tenantId is a QUERY param here too — in `criteria` it never arrives.
        name: 'HRMS employee count',
        url: `${BASE_URL}/egov-hrms/employees/_count?tenantId=${TENANT}`,
        body: { RequestInfo: requestInfo },
      },
      {
        name: 'Workflow business service',
        url: `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${TENANT}&businessServices=PGR`,
        body: { RequestInfo: requestInfo },
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
          return { status: resp.status, ok: resp.ok, body: (await resp.text()).slice(0, 300) };
        },
        { url: endpoint.url, body: endpoint.body, token },
      );

      // The endpoint must actually WORK, which is what this test's name claims.
      //
      // The previous assertion was `toBeLessThan(500)`, which cannot fail for any
      // reachable endpoint: a 400, a 401, even a 404 from a service that does not
      // exist all satisfy it. Four of the seven endpoints here were 400ing — one
      // with a server-side NullPointerException — under a green test. Verified:
      // pointing a URL at `/pgr-servicesXXX/...` returns 404, and 404 < 500, so the
      // old form stayed green even against a service that isn't there.
      expect(
        result.ok,
        `${endpoint.name} returned ${result.status}: ${result.body}`,
      ).toBe(true);
    }
  });

  test('citizen flow APIs work without authentication', {
    tag: ['@area:proxy', '@kind:regression', '@layer:api', '@persona:cross'],
  }, async ({ page }) => {
    // Citizen language/login page should load MDMS and localization without JWT
    await page.goto(`${BASE_URL}/${tenantSlug()}/digit-ui/citizen`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    // These calls should work without JWT (proxy forwards unchanged)
    const mdmsResult = await page.evaluate(
      async ({ baseUrl, rootTenant }) => {
        const resp = await fetch(`${baseUrl}/mdms-v2/v1/_search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker' },
            MdmsCriteria: {
              tenantId: rootTenant,
              moduleDetails: [{ moduleName: 'tenant', masterDetails: [{ name: 'tenants' }] }],
            },
          }),
        });
        return { status: resp.status };
      },
      { baseUrl: BASE_URL, rootTenant: ROOT_TENANT },
    );

    expect(mdmsResult.status).toBeLessThan(500);
  });
});
