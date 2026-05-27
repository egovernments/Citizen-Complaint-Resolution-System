/**
 * Keycloak SSO login smoke tests
 *
 * Exercises the post-cutover Nairobi deployment (or any tenant where
 * `enable_keycloak: true` and `auth_provider: keycloak` in host_vars).
 *
 * The whole suite is gated by AUTH_PROVIDER=keycloak — running it against
 * an OTP-mode deployment is meaningless and would just produce noisy
 * failures.
 *
 * Run against Nairobi:
 *   AUTH_PROVIDER=keycloak \
 *   BASE_URL=https://naipepea.digit.org \
 *   DIGIT_TENANT=ke.nairobi \
 *   npx playwright test specs/keycloak-login.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const AUTH_PROVIDER = process.env.AUTH_PROVIDER || '';

test.describe('Keycloak SSO login', () => {
  test.skip(
    () => AUTH_PROVIDER !== 'keycloak',
    "AUTH_PROVIDER env must be 'keycloak' to run this suite (set it after cutover)",
  );

  test('citizen login page redirects to Keycloak realm', async ({ page }) => {
    await page.goto('/digit-ui/citizen/login', { waitUntil: 'domcontentloaded' });
    // Auth-adapter from PR 1 detects AUTH_PROVIDER=keycloak in globalConfigs
    // and immediately replaces the location with the realm authorize URL.
    await page.waitForURL(
      /\/auth\/realms\/[^\/]+\/protocol\/openid-connect\/auth/,
      { timeout: 15_000 },
    );
    expect(page.url()).toContain('/auth/realms/');
    expect(page.url()).toContain('/protocol/openid-connect/auth');
  });

  test('employee login also routes through Keycloak', async ({ page }) => {
    await page.goto('/digit-ui/employee/user/login', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/auth\/realms\//, { timeout: 15_000 });
    expect(page.url()).toContain('/auth/realms/');
  });

  test('Keycloak login page renders Google SSO button when IdP configured', async ({ page }) => {
    await page.goto('/digit-ui/citizen/login', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/auth\/realms\//, { timeout: 15_000 });
    // Google IdP is optional (keycloak_google_client_id may be unset).
    // If wired, KC renders an "alternate login" anchor; if not, the form
    // is username+password only. Skip silently when absent.
    const googleButton = page.getByRole('link', { name: /google/i });
    const count = await googleButton.count();
    if (count > 0) {
      await expect(googleButton.first()).toBeVisible();
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'Google IdP not configured on this realm — skipped Google button check.',
      });
    }
  });

  test('token-exchange-svc health endpoint reachable', async ({ request }) => {
    const r = await request.get('/token-exchange/healthz');
    expect(r.ok(), `expected /token-exchange/healthz to return 2xx, got ${r.status()}`).toBeTruthy();
  });

  test('OIDC discovery doc has correct issuer for this deployment', async ({ request }) => {
    // Auto-derive the realm from the first redirect, so this test works on
    // any tenant where AUTH_PROVIDER=keycloak (not just ke.nairobi).
    const page = await request.get('/digit-ui/citizen/login', { maxRedirects: 0 });
    // The SPA may serve HTML that does a JS redirect, in which case we
    // can't extract the realm from a single HTTP hop. Fall back to the
    // most common realm name when that happens.
    const location = page.headers()['location'] || '';
    const m = location.match(/\/auth\/realms\/([^\/]+)\//);
    const realm = m?.[1] || 'ke';

    const resp = await request.get(`/auth/realms/${realm}/.well-known/openid-configuration`);
    expect(resp.ok(), `OIDC discovery for realm '${realm}' returned ${resp.status()}`).toBeTruthy();

    const discovery = await resp.json();
    const deploymentOrigin = new URL(BASE_URL).origin;
    expect(
      discovery.issuer,
      `issuer "${discovery.issuer}" should start with deployment origin "${deploymentOrigin}". ` +
        `Fix: update realm frontendUrl in KC admin → Realm Settings → General → Frontend URL.`,
    ).toContain(deploymentOrigin);
    expect(discovery.authorization_endpoint).toContain(deploymentOrigin);
    expect(discovery.token_endpoint).toContain(deploymentOrigin);
  });
});
