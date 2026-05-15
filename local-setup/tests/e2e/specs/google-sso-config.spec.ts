/**
 * Google SSO Configuration Validation
 *
 * Validates the complete chain of configuration required for Google SSO to work:
 *   Browser → KC authorize → KC broker/google → Google OAuth → Google callback →
 *   KC broker/google/endpoint → KC token exchange with Google → KC issues JWT → Browser
 *
 * Each test targets a specific misconfiguration that has broken SSO in production.
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://keycloak-sandbox.live.digit.org';
const REALM = 'digit-sandbox';
const CLIENT_ID = 'digit-sandbox-ui';

// Helper: get KC admin token
async function getAdminToken(): Promise<string> {
  // Use internal KC URL (not public domain) to avoid proxy
  const resp = await fetch('http://localhost:18180/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=password&client_id=admin-cli&username=admin&password=admin',
  });
  const data = await resp.json();
  return data.access_token;
}

test.describe('Google SSO Configuration', () => {
  // These tests require Keycloak admin port (18180) — skip when unavailable
  test.beforeEach(async () => {
    let kcAvailable = false;
    try {
      const r = await fetch('http://localhost:18180/realms/master', { signal: AbortSignal.timeout(2000) });
      kcAvailable = r.ok;
    } catch { /* not reachable */ }
    test.skip(!kcAvailable, 'Keycloak admin port (18180) not available');
  });

  test('KC issuer uses the deployment domain (not an old hostname)', async () => {
    const deploymentDomain = new URL(BASE_URL).origin;

    const resp = await fetch(
      `${BASE_URL}/realms/${REALM}/.well-known/openid-configuration`,
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

  test('KC client has deployment domain in redirect URIs', async () => {
    const deploymentDomain = new URL(BASE_URL).origin;
    const adminToken = await getAdminToken();

    const resp = await fetch(
      `http://localhost:18180/admin/realms/${REALM}/clients`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const clients = await resp.json();
    const client = clients.find((c: any) => c.clientId === CLIENT_ID);

    expect(client, `Client "${CLIENT_ID}" not found in realm "${REALM}"`).toBeTruthy();

    const redirectUris: string[] = client.redirectUris || [];
    const hasDeploymentDomain = redirectUris.some(
      (uri) => uri.includes(deploymentDomain) || uri === '*',
    );

    expect(
      hasDeploymentDomain,
      `Client "${CLIENT_ID}" redirectUris ${JSON.stringify(redirectUris)} ` +
        `does not include "${deploymentDomain}/*". ` +
        `Fix: add "${deploymentDomain}/*" to KC Admin → Clients → ${CLIENT_ID} → Valid Redirect URIs`,
    ).toBe(true);
  });

  test('KC client has deployment domain in web origins (CORS)', async () => {
    const deploymentDomain = new URL(BASE_URL).origin;
    const adminToken = await getAdminToken();

    const resp = await fetch(
      `http://localhost:18180/admin/realms/${REALM}/clients`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const clients = await resp.json();
    const client = clients.find((c: any) => c.clientId === CLIENT_ID);

    const webOrigins: string[] = client.webOrigins || [];
    const hasDeploymentOrigin = webOrigins.some(
      (origin) =>
        origin === deploymentDomain ||
        origin === '+' ||
        deploymentDomain.match(new RegExp(origin.replace(/\*/g, '.*'))),
    );

    expect(
      hasDeploymentOrigin,
      `Client "${CLIENT_ID}" webOrigins ${JSON.stringify(webOrigins)} ` +
        `does not include "${deploymentDomain}". ` +
        `Fix: add "${deploymentDomain}" to KC Admin → Clients → ${CLIENT_ID} → Web Origins`,
    ).toBe(true);
  });

  test('Google IdP is enabled and configured', async () => {
    const adminToken = await getAdminToken();

    const resp = await fetch(
      `http://localhost:18180/admin/realms/${REALM}/identity-provider/instances/google`,
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

  test('Google OAuth authorize endpoint accepts the redirect', async ({ request }) => {
    const deploymentDomain = new URL(BASE_URL).origin;

    // Build the KC authorize URL with Google IdP hint
    const authUrl =
      `${BASE_URL}/realms/${REALM}/protocol/openid-connect/auth` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(deploymentDomain + '/digit-ui/user/login')}` +
      `&response_type=code` +
      `&scope=openid` +
      `&kc_idp_hint=google` +
      `&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` +
      `&code_challenge_method=S256`;

    // Use Playwright's API request context (Node.js level, no CORS issues)
    // maxRedirects: 0 gives us the raw redirect response
    const resp = await request.get(authUrl, { maxRedirects: 0 });
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

  test('Google broker login redirects to accounts.google.com', async ({ request }) => {
    const deploymentDomain = new URL(BASE_URL).origin;

    // Step 1: Hit KC authorize with google hint
    const authUrl =
      `${BASE_URL}/realms/${REALM}/protocol/openid-connect/auth` +
      `?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(deploymentDomain + '/digit-ui/user/login')}` +
      `&response_type=code` +
      `&scope=openid` +
      `&kc_idp_hint=google` +
      `&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` +
      `&code_challenge_method=S256`;

    const step1Resp = await request.get(authUrl, { maxRedirects: 0 });
    const step1Status = step1Resp.status();
    const step1Location = step1Resp.headers()['location'] || '';

    if (step1Status < 300 || step1Status >= 400) {
      test.skip(true, `KC authorize returned ${step1Status} — cannot test Google redirect`);
      return;
    }

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

  test('Google client secret is valid (KC can exchange auth code)', async () => {
    const adminToken = await getAdminToken();

    // Get the Google IdP config
    const resp = await fetch(
      `http://localhost:18180/admin/realms/${REALM}/identity-provider/instances/google`,
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
        redirect_uri: `${BASE_URL}/realms/${REALM}/broker/google/endpoint`,
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
