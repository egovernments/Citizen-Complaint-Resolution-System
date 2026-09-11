/**
 * Keycloak SSO — API-only contract tests
 *
 * Covers the protocol surface the citizen SPA depends on:
 *   1. Realm OIDC discovery — issuer + endpoints all carry the /auth prefix
 *      (regression for the realm.attributes.frontendUrl fix; without it KC
 *      emits unprefixed URLs and the broker /login redirect 404s at Kong).
 *   2. Overlay password grant — POST /token-exchange/realms/:realm/protocol/
 *      openid-connect/token mints a KC-signed JWT. Validates the KC + DIGIT
 *      fallback path: first request for a stock-seeded DIGIT user (ADMIN)
 *      provisions the user in KC, returns tokens that decode to the right
 *      issuer + realm roles.
 *   3. Overlay-issued JWT works as a DIGIT bearer — round-trip a real API
 *      call through /token-exchange/* and assert we get a DIGIT response,
 *      not a 401 from the overlay's JWT validator.
 *   4. Authorize URL — building a /protocol/openid-connect/auth URL with
 *      the params our SPA actually sends (PKCE S256, kc_idp_hint=google)
 *      yields a 302 to Google's account chooser, not a KC 400 about a
 *      missing parameter or unauthorized client.
 *
 * Self-skips when the realm's OIDC discovery is unreachable (deployments
 * without keycloak enabled).
 *
 * Run against any deployment:
 *   BASE_URL=https://bometfeedbackhub.digit.org ROOT_TENANT=ke \
 *     npx playwright test tests/keycloak/kc-api.spec.ts
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  BASE_URL,
  ROOT_TENANT,
  ADMIN_USER,
  ADMIN_PASS,
  KC_BASE,
  KC_REALM,
  KC_CLIENT_ID,
  TOKEN_EXCHANGE_BASE,
  CITIZEN_BASENAME,
  decodeJwtPayload,
} from '../utils/env';

const REALM_BASE = `${KC_BASE}/realms/${encodeURIComponent(KC_REALM)}`;
const WELL_KNOWN = `${REALM_BASE}/.well-known/openid-configuration`;
const OVERLAY_TOKEN = `${TOKEN_EXCHANGE_BASE}/realms/${encodeURIComponent(KC_REALM)}/protocol/openid-connect/token`;

// Skip the whole file (rather than each test) when KC isn't deployed on the
// target — the run reports `skipped` cleanly instead of 4 individual 404s.
test.describe('Keycloak SSO — API contract', () => {
  test.beforeAll(async () => {
    const probe = await playwrightRequest.newContext({ timeout: 8000 });
    try {
      const r = await probe.get(WELL_KNOWN);
      test.skip(
        !r.ok(),
        `Keycloak realm ${KC_REALM} not reachable at ${WELL_KNOWN} ` +
          `(status=${r.status()}). Deploy KC + token-exchange-svc or set KC_BASE/KC_REALM.`,
      );
    } finally {
      await probe.dispose();
    }
  });

  test('OIDC discovery: issuer includes the /auth prefix (frontendUrl regression)', { tag: ['@persona:system'] }, async ({ request }) => {
    const resp = await request.get(WELL_KNOWN);
    expect(resp.ok(), `well-known unreachable at ${WELL_KNOWN}`).toBeTruthy();
    const cfg = await resp.json();

    // Without realm.attributes.frontendUrl, KC falls back to KC_HOSTNAME
    // with the path stripped — issuer comes out as https://host/realms/...
    // The unprefixed URL bypasses the nginx /auth/ route and 404s at Kong.
    // Pinning the issuer to /auth/realms/<realm> proves the fix is live.
    expect(cfg.issuer).toBe(`${BASE_URL}/auth/realms/${KC_REALM}`);
  });

  test('OIDC discovery: every endpoint URL lives under the issuer origin + /auth prefix', { tag: ['@persona:system'] }, async ({ request }) => {
    const cfg = await (await request.get(WELL_KNOWN)).json();
    const prefix = `${BASE_URL}/auth/realms/${KC_REALM}`;
    // The SPA computes its KC URLs from KC_BASE + REALM (not from the
    // well-known) — so a mismatch between what KC advertises here and what
    // the SPA constructs would break the OAuth round-trip silently. Pin
    // both shapes.
    expect(cfg.authorization_endpoint).toBe(`${prefix}/protocol/openid-connect/auth`);
    expect(cfg.token_endpoint).toBe(`${prefix}/protocol/openid-connect/token`);
    expect(cfg.end_session_endpoint).toBe(`${prefix}/protocol/openid-connect/logout`);
  });

  test('Overlay password grant mints a KC JWT for ADMIN (KC→DIGIT fallback on first login, KC direct after)', { tag: ['@persona:system'] }, async ({ request }) => {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: KC_CLIENT_ID,
      username: ADMIN_USER,
      password: ADMIN_PASS,
      scope: 'openid',
      tenantId: ROOT_TENANT,
      userType: 'EMPLOYEE',
    });
    const resp = await request.post(OVERLAY_TOKEN, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: body.toString(),
    });
    expect(resp.ok(), `overlay refused password grant: ${resp.status()} ${await resp.text()}`).toBeTruthy();

    const tokens = await resp.json();
    // Both refresh + id tokens are required for the SPA's silent renewal +
    // RP-initiated logout flows. If the overlay's KC fallback drops either
    // one, the UI silently regresses — pin it here.
    expect(tokens.access_token, 'access_token').toBeTruthy();
    expect(tokens.refresh_token, 'refresh_token').toBeTruthy();
    expect(tokens.id_token, 'id_token').toBeTruthy();

    const claims = decodeJwtPayload(tokens.access_token);
    // Issuer + realm_access.roles together prove the token actually came
    // from our realm (overlay wasn't passing through a DIGIT opaque token
    // unchanged). 'EMPLOYEE' is on every ADMIN-seeded user; assert it.
    expect(claims.iss).toBe(`${BASE_URL}/auth/realms/${KC_REALM}`);
    expect(claims.typ).toBe('Bearer');
    expect(claims.preferred_username, 'preferred_username').toBeTruthy();
    expect(claims.realm_access?.roles, 'realm_access.roles').toEqual(expect.arrayContaining(['EMPLOYEE']));
  });

  test('Overlay-issued JWT round-trips through the proxy: /mdms-v2 _search returns a DIGIT response (not 401)', { tag: ['@persona:system'] }, async ({ request }) => {
    // Mint a token via the overlay.
    const tokenResp = await request.post(OVERLAY_TOKEN, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams({
        grant_type: 'password',
        client_id: KC_CLIENT_ID,
        username: ADMIN_USER,
        password: ADMIN_PASS,
        scope: 'openid',
        tenantId: ROOT_TENANT,
        userType: 'EMPLOYEE',
      }).toString(),
    });
    expect(tokenResp.ok()).toBeTruthy();
    const accessToken = (await tokenResp.json()).access_token;

    // Use it as Authorization: Bearer against the overlay-routed MDMS API.
    // StateInfo is the canonical "any-tenant-has-this" probe (the same one
    // the deploy validation runs).
    const mdmsResp = await request.post(
      `${TOKEN_EXCHANGE_BASE}/mdms-v2/v2/_search`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        data: {
          RequestInfo: { authToken: accessToken },
          MdmsCriteria: {
            tenantId: ROOT_TENANT,
            moduleDetails: [
              { moduleName: 'common-masters', masterDetails: [{ name: 'StateInfo' }] },
            ],
          },
        },
      },
    );
    // The overlay validates the JWT first — a 401 here means the JWT
    // didn't survive the round-trip (most often: jwks_uri pointing at the
    // wrong realm, or KC_HOSTNAME / frontendUrl mismatch making the
    // overlay-side validator reject its own issuer's tokens). Anything
    // that's NOT 401 means the bearer was accepted; we don't gate on
    // MDMS having StateInfo seeded for this tenant.
    expect(
      mdmsResp.status(),
      `overlay rejected its own JWT (likely jwks mismatch): ${await mdmsResp.text()}`,
    ).not.toBe(401);
  });

  test('Authorize URL with PKCE + kc_idp_hint=google does not 400 at KC (realm allows the SPA client to redirect to Google)', { tag: ['@persona:system'] }, async ({ request }) => {
    // Mimic exactly what the SPA's buildAuthorizeUrl() emits: response_type=code,
    // scope=openid, PKCE S256, kc_idp_hint=google, redirect_uri in the
    // /citizen/* allowlist. KC would 400 if any of these were missing
    // requirements the realm/client enforces — that's the regression we
    // hit twice already (missing code_challenge_method, unauthorized_client).
    const redirectUri = `${BASE_URL}${CITIZEN_BASENAME}/auth/callback`;
    const challenge = 'EXAMPLECHALLENGE_'.padEnd(43, 'A'); // any 43..128 char base64url
    const params = new URLSearchParams({
      client_id: KC_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid',
      state: 'pwtest-state',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      kc_idp_hint: 'google',
    });

    // Follow no redirects — we only want to know KC accepted the params.
    // A 302 to Google's accounts.google.com is success; 400/200-error-page
    // means the realm or client config drifted.
    const resp = await request.get(`${REALM_BASE}/protocol/openid-connect/auth?${params.toString()}`, {
      maxRedirects: 0,
    });
    expect([302, 303, 307]).toContain(resp.status());
    const location = resp.headers()['location'] ?? '';
    expect(location, 'no Location header on the authorize redirect').toBeTruthy();
    // kc_idp_hint=google means the redirect should go to the google IdP
    // broker (which then 302s on to Google). Either intermediate is fine.
    expect(
      location.includes('/broker/google') || location.includes('accounts.google.com'),
      `unexpected redirect target: ${location}`,
    ).toBeTruthy();
  });

  test('Overlay healthz: status=ok and redis connected', { tag: ['@persona:system'] }, async ({ request }) => {
    const resp = await request.get(`${TOKEN_EXCHANGE_BASE}/healthz`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.status).toBe('ok');
    // Redis is load-bearing — the overlay caches keycloak:{sub}:{tenant}
    // → DIGIT user info there. If redis is "disconnected" every login
    // hits the slow path (DIGIT user search + provisioning) which
    // multiplies p99 by ~10x. Surface it.
    expect(body.redis).toBe('connected');
  });
});
