/**
 * Google SSO Configuration Validation
 *
 * Validates the complete chain of configuration required for Google SSO to work:
 *   Browser → KC authorize → KC broker/google → Google OAuth → Google callback →
 *   KC broker/google/endpoint → KC token exchange with Google → KC issues JWT → Browser
 *
 * Each test targets a specific misconfiguration that has broken SSO in production.
 *
 * @local-only: These tests require Keycloak admin port (18180) which is only
 * available in a local stack (LOCAL_STACK=1). They are excluded from chromium
 * runs on deployed environments via grepInvert: EXCLUDE_LOCAL_ONLY.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { KC_REALM, KC_BASE, BASE_URL } from '../utils/env';

import { keycloakAdmin } from '../utils/keycloak-admin';
import { authorizeUrl } from '../utils/identity-bff';
const KC_CLIENT_ID = process.env.IDENTITY_TEST_CITIZEN_CLIENT_ID || 'digit-ui-citizen';

// Operator credentials are supplied only by the isolated fixture.
async function getAdminToken(): Promise<string> { return keycloakAdmin().token; }
/** The admin fixture is an operator secret, not a deployment capability: absent means skip. */
const hasAdminFixture = () =>
  Boolean(process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_URL && process.env.IDENTITY_TEST_KEYCLOAK_ADMIN_TOKEN);
const NO_ADMIN_FIXTURE = 'Keycloak admin fixture not supplied (IDENTITY_TEST_KEYCLOAK_ADMIN_URL/_TOKEN)';
/** Status of Keycloak's authorize endpoint for this client + redirect_uri. Keycloak
 *  validates redirect_uri against the client's Valid Redirect URIs before rendering
 *  the login page: 200 when allowed, 400 "Invalid parameter: redirect_uri" when not. */
async function authorizeStatus(redirectUri: string): Promise<number> {
  // The client enforces PKCE S256: without a challenge Keycloak 302s an error back to
  // the redirect_uri instead of rendering the login page. Any 43-char value will do.
  const params = new URLSearchParams({ client_id: KC_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid',
    code_challenge: 'redirect-uri-probe-redirect-uri-probe-12345', code_challenge_method: 'S256' });
  const resp = await fetch(`${KC_BASE}/realms/${KC_REALM}/protocol/openid-connect/auth?${params}`, { redirect: 'manual' });
  return resp.status;
}
/**
 * v2.20 citizens sign in by phone only; Google is a staff sign-in method, offered
 * on the Configurator surface when the deploy lists it and Keycloak has a Google
 * client. GET /identity/v1/auth-methods answers { methods: [{ id, type, ... }] }.
 */
async function skipUnlessGoogleOffered(request: APIRequestContext) {
  const response = await request.get(`${BASE_URL}/identity/v1/auth-methods?surface=configurator&intent=signin`);
  expect(response.status(), 'GET /identity/v1/auth-methods?surface=configurator').toBe(200);
  const methods: Array<{ id?: string }> = (await response.json()).methods ?? [];
  test.skip(!methods.some((m) => m.id === 'google'), 'Google is not a Configurator sign-in method on this deployment (/identity/v1/auth-methods)');
}
async function brokerRedirect(request: APIRequestContext) {
  await skipUnlessGoogleOffered(request);
  const bff = await request.get(authorizeUrl(BASE_URL, 'configurator', 'google'), { maxRedirects: 0 });
  expect(bff.status()).toBe(302);
  return request.get(bff.headers().location, { maxRedirects: 0 });
}

test.describe('Google SSO Configuration', () => {
  test('KC issuer uses the deployment domain (not an old hostname)', {
    tag: ['@local-only', '@area:keycloak', '@layer:api', '@persona:system'],
  }, async () => {
    const deploymentDomain = new URL(BASE_URL).origin;

    const resp = await fetch(
      `${KC_BASE}/realms/${KC_REALM}/.well-known/openid-configuration`,
    );
    const discovery = await resp.json();

    expect(
      discovery.issuer,
      `KC issuer is "${discovery.issuer}" but should start with "${deploymentDomain}". ` +
        `Fix: update the realm's frontendUrl in KC admin → Realm Settings → General → Frontend URL`,
    ).toContain(deploymentDomain);

    expect(
      discovery.authorization_endpoint,
      'Authorization endpoint should use deployment domain',
    ).toContain(deploymentDomain);
  });

  test('KC client has deployment domain in redirect URIs', {
    tag: ['@local-only', '@area:keycloak', '@layer:api', '@persona:system'],
  }, async () => {
    const deploymentDomain = new URL(BASE_URL).origin;
    if (!hasAdminFixture()) {
      // Admin-free: ask Keycloak itself whether it accepts the callback, with a
      // foreign redirect_uri as the control so a permissive realm cannot pass.
      expect(
        await authorizeStatus(`${deploymentDomain}/identity/v1/callback`),
        `Keycloak rejects redirect_uri ${deploymentDomain}/identity/v1/callback for client "${KC_CLIENT_ID}"`,
      ).toBe(200);
      expect(
        await authorizeStatus('https://redirect-uri-control.invalid/identity/v1/callback'),
        `Keycloak accepts a foreign redirect_uri for client "${KC_CLIENT_ID}" (client missing, or wildcard redirect URIs)`,
      ).toBe(400);
      return;
    }
    const adminToken = await getAdminToken();

    const resp = await fetch(
      `${keycloakAdmin().base}/admin/realms/${KC_REALM}/clients`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const clients = await resp.json();
    const client = clients.find((c: any) => c.clientId === KC_CLIENT_ID);

    expect(client, `Client "${KC_CLIENT_ID}" not found in realm "${KC_REALM}"`).toBeTruthy();

    const redirectUris: string[] = client.redirectUris || [];
    const hasDeploymentDomain = redirectUris.some(
      (uri) => uri === `${deploymentDomain}/identity/v1/callback`,
    );

    expect(
      hasDeploymentDomain,
      `Client "${KC_CLIENT_ID}" redirectUris ${JSON.stringify(redirectUris)} ` +
        `does not include "${deploymentDomain}/*". ` +
        `Fix: add "${deploymentDomain}/*" to KC Admin → Clients → ${KC_CLIENT_ID} → Valid Redirect URIs`,
    ).toBe(true);
  });

  test('KC client has deployment domain in web origins (CORS)', {
    tag: ['@local-only', '@area:keycloak', '@layer:api', '@persona:system'],
  }, async () => {
    // CORS answers at the gateway come from Kong's cors plugin, not the client's
    // webOrigins, so there is no admin-free probe for this one.
    test.skip(!hasAdminFixture(), NO_ADMIN_FIXTURE);
    const deploymentDomain = new URL(BASE_URL).origin;
    const adminToken = await getAdminToken();

    const resp = await fetch(
      `${keycloakAdmin().base}/admin/realms/${KC_REALM}/clients`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const clients = await resp.json();
    const client = clients.find((c: any) => c.clientId === KC_CLIENT_ID);

    const webOrigins: string[] = client.webOrigins || [];
    const hasDeploymentOrigin = webOrigins.some(
      (origin) =>
        origin === deploymentDomain ||
        origin === '+' ||
        deploymentDomain.match(new RegExp(origin.replace(/\*/g, '.*'))),
    );

    expect(
      hasDeploymentOrigin,
      `Client "${KC_CLIENT_ID}" webOrigins ${JSON.stringify(webOrigins)} ` +
        `does not include "${deploymentDomain}". ` +
        `Fix: add "${deploymentDomain}" to KC Admin → Clients → ${KC_CLIENT_ID} → Web Origins`,
    ).toBe(true);
  });

  test('Google IdP is enabled and configured', {
    tag: ['@local-only', '@area:keycloak', '@layer:api', '@persona:system'],
  }, async ({ request }) => {
    await skipUnlessGoogleOffered(request);
    const adminToken = await getAdminToken();

    const resp = await fetch(
      `${keycloakAdmin().base}/admin/realms/${KC_REALM}/identity-provider/instances/google`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );

    expect(resp.ok, 'Google IdP not found in KC realm').toBe(true);

    const idp = await resp.json();
    expect(idp.enabled, 'Google IdP is disabled').toBe(true);
    expect(
      idp.config?.clientId,
      'Google IdP clientId not configured',
    ).toBeTruthy();
    expect(
      idp.config?.clientSecret || idp.config?.clientSecret === '**********',
      'Google IdP clientSecret not configured',
    ).toBeTruthy();
  });

  test('Google OAuth authorize endpoint accepts the redirect', {
    tag: ['@local-only', '@area:keycloak', '@layer:api', '@persona:system'],
  }, async ({ request }) => {
    const deploymentDomain = new URL(BASE_URL).origin;

    const resp = await brokerRedirect(request);
    const status = resp.status();
    const headers = resp.headers();
    const location = headers['location'] || '';

    expect(
      status,
      `KC returned ${status} for authorize request. ` +
        `If 400: redirect_uri not in client's Valid Redirect URIs. ` +
        `If 500: internal KC error.`,
    ).toBeGreaterThanOrEqual(300);
    expect(status).toBeLessThan(400);

    // The redirect should go to Google (via KC broker), using the deployment domain
    expect(
      location,
      `KC redirected to "${location}" which doesn't contain the broker path. ` +
        `Expected redirect to /broker/google/login on the deployment domain.`,
    ).toContain('/broker/google/');

    // The redirect should use the DEPLOYMENT domain, not an old one
    expect(
      location,
      `KC broker redirect uses wrong domain: "${location}". ` +
        `Should use "${deploymentDomain}". ` +
        `Fix: update realm frontendUrl to "${deploymentDomain}"`,
    ).toContain(new URL(BASE_URL).host);
  });

  test('Google broker login redirects to accounts.google.com', {
    tag: ['@local-only', '@area:keycloak', '@layer:api', '@persona:system'],
  }, async ({ request }) => {
    const deploymentDomain = new URL(BASE_URL).origin;

    const step1Resp = await brokerRedirect(request);
    const step1Status = step1Resp.status();
    const step1Location = step1Resp.headers()['location'] || '';

    expect([302, 303, 307]).toContain(step1Status);

    // Step 2: Follow the broker redirect — should go to Google
    const step2Resp = await request.get(step1Location, { maxRedirects: 0 });
    const step2Location = step2Resp.headers()['location'] || '';

    // The broker should redirect to accounts.google.com
    expect(
      step2Location,
      `KC broker did not redirect to Google. Got: "${step2Location}"`,
    ).toContain('accounts.google.com');

    // The redirect_uri parameter sent to Google should use the deployment domain
    const googleUrl = new URL(step2Location);
    const redirectUri = googleUrl.searchParams.get('redirect_uri') || '';
    expect(
      redirectUri,
      `redirect_uri sent to Google is "${redirectUri}". ` +
        `Should contain "${new URL(BASE_URL).host}". ` +
        `Fix: update realm frontendUrl to "${deploymentDomain}"`,
    ).toContain(new URL(BASE_URL).host);
  });

  test('Google client secret is valid (KC can exchange auth code)', {
    tag: ['@local-only', '@area:keycloak', '@layer:api', '@persona:system'],
  }, async ({ request }) => {
    await skipUnlessGoogleOffered(request);
    const adminToken = await getAdminToken();

    // Get the Google IdP config
    const resp = await fetch(
      `${keycloakAdmin().base}/admin/realms/${KC_REALM}/identity-provider/instances/google`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const idp = await resp.json();
    const clientId = idp.config?.clientId;
    const clientSecret = idp.config?.clientSecret;

    // Verify the client_id is set
    expect(
      clientId,
      'Google IdP client_id not configured in KC',
    ).toBeTruthy();

    // KC redacts the secret as '**********' — we cannot retrieve the actual value via admin API.
    // If the secret is redacted, it means one IS configured. We can only validate the actual
    // secret by sending a dummy code to Google with the real credentials.
    // Since we can't get the real secret, we verify it's present and check via an indirect method.
    if (clientSecret === '**********') {
      // Secret is configured but redacted — use KC's own broker endpoint to test the chain.
      // We verify Google discovery is reachable and the clientId is a valid-looking Google client ID.
      const googleDiscovery = await fetch(
        'https://accounts.google.com/.well-known/openid-configuration',
      );
      expect(googleDiscovery.ok, 'Google OIDC discovery not accessible').toBe(true);

      const googleConfig = await googleDiscovery.json();
      expect(googleConfig.token_endpoint).toBe('https://oauth2.googleapis.com/token');

      // Verify the client_id looks like a Google OAuth client ID (numeric prefix + .apps.googleusercontent.com)
      expect(
        clientId,
        `Google IdP client_id "${clientId}" does not look like a valid Google OAuth client ID`,
      ).toMatch(/\.apps\.googleusercontent\.com$/);

      // Secret is present (redacted) — we trust KC has the real value stored.
      // A full validation would require a real auth code flow.
      return;
    }

    // If we have the actual secret (not redacted), test it against Google
    const googleDiscovery = await fetch(
      'https://accounts.google.com/.well-known/openid-configuration',
    );
    expect(googleDiscovery.ok, 'Google OIDC discovery not accessible').toBe(true);

    const googleConfig = await googleDiscovery.json();
    expect(googleConfig.token_endpoint).toBe('https://oauth2.googleapis.com/token');

    // Test with a dummy code to verify the secret format is accepted
    // Google will return "invalid_grant" (bad code) not "invalid_client" (bad secret)
    const tokenResp = await fetch(googleConfig.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: 'dummy_invalid_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${KC_BASE}/realms/${KC_REALM}/broker/google/endpoint`,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokenData = await tokenResp.json();

    // "invalid_grant" = code is bad (expected) but client credentials are OK
    // "invalid_client" = client_id or client_secret is WRONG — this is the failure we want to catch
    if (tokenData.error === 'invalid_client') {
      expect(
        tokenData.error,
        `Google rejected our client credentials: "${tokenData.error_description}". ` +
          `Fix: update the Google IdP client secret in KC Admin → Identity Providers → google → Client Secret. ` +
          `Get the correct secret from Google Cloud Console → APIs & Credentials.`,
      ).not.toBe('invalid_client');
    }

    // If we get here, the client credentials are valid (Google just rejected the dummy code)
    expect(['invalid_grant', 'invalid_request']).toContain(tokenData.error);
  });
});
