/**
 * Keycloak SSO — UI (Playwright)
 *
 * Drives the citizen SPA's login surface as a real user would:
 *   1. Mobile + OTP form: enter mobile, enter fixed OTP, hit Send Code,
 *      then Verify — assert the SPA navigates into the citizen dashboard
 *      AND that the POST that authenticated us went through the overlay
 *      (token endpoint), not directly to /user/oauth/token. Proves the
 *      overlay's KC + DIGIT fallback path is what's actually being
 *      exercised — not the legacy direct-DIGIT path.
 *   2. "Continue with Google" button: click — assert the browser
 *      navigates to KC's /authorize endpoint with the params the OAuth2
 *      Authorization Code + PKCE + IdP-hint flow needs. We can't drive
 *      Google's consent screen, but we can pin every param KC would
 *      validate (code_challenge_method, kc_idp_hint, redirect_uri).
 *      Catches the two regressions we hit during cutover (missing PKCE,
 *      missing realm.frontendUrl).
 *
 * Self-skips when the citizen SPA isn't running in KC mode on the target.
 *
 * Run:
 *   BASE_URL=https://bometfeedbackhub.digit.org \
 *     npx playwright test tests/keycloak/kc-ui.spec.ts
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import {
  BASE_URL,
  ROOT_TENANT,
  KC_REALM,
  KC_CLIENT_ID,
  KC_BASE,
  TOKEN_EXCHANGE_BASE,
  CITIZEN_BASENAME,
  CITIZEN_PHONE_PREFIX,
  FIXED_OTP,
  decodeJwtPayload,
} from '../utils/env';

const CITIZEN_URL = `${BASE_URL}${CITIZEN_BASENAME}/`;
const LOGIN_URL = `${BASE_URL}${CITIZEN_BASENAME}/login`;
const REALM_BASE = `${KC_BASE}/realms/${encodeURIComponent(KC_REALM)}`;

test.describe('Keycloak SSO — citizen SPA UI', () => {
  // Don't use the configurator's auth.json — these are pre-auth flows.
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    // Skip the whole file when the SPA isn't running in KC mode. We probe
    // the page's globalConfigs-equivalent via the rendered HTML: when KC
    // is active the bundle ships the "Continue with Google" string. When
    // it's not (legacy /digit-ui only deploys, or AUTH_PROVIDER unset),
    // skip — we'd just be reporting "/citizen/ wasn't found" 4 times.
    const probe = await playwrightRequest.newContext({ timeout: 8000 });
    try {
      const r = await probe.get(CITIZEN_URL);
      const live = r.ok() && (await probe.get(`${TOKEN_EXCHANGE_BASE}/healthz`)).ok();
      test.skip(
        !live,
        `Citizen SPA + token-exchange not both reachable at ${BASE_URL} — KC mode not deployed.`,
      );
    } finally {
      await probe.dispose();
    }
  });

  test('mobile + OTP (existing citizen) authenticates via overlay and lands at dashboard with KC tokens', { tag: ['@persona:citizen'] }, async ({ page, request }) => {
    // Mint a unique 9-digit mobile valid for the Kenya regex.
    const mobile = `${CITIZEN_PHONE_PREFIX}${Date.now().toString().slice(-(9 - CITIZEN_PHONE_PREFIX.length))}`;

    // Pre-register the citizen via the legacy API. The SPA's KC path
    // requires the user to already exist in DIGIT (overlay's KC+DIGIT
    // fallback resolves an existing DIGIT user → provisions the KC side).
    // For a fresh mobile the SPA falls back to legacy /user/citizen/_create
    // which doesn't go through KC at all — that's a known SPA gap, not
    // what we're testing here. Pre-registering reproduces the steady-
    // state path: existing user → overlay → KC JWT.
    const regResp = await request.post(`${BASE_URL}/user/citizen/_create?tenantId=${ROOT_TENANT}`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        RequestInfo: { apiId: 'kc-ui-test', action: '_create' },
        User: {
          name: `KC Test ${mobile.slice(-4)}`,
          username: mobile,
          mobileNumber: mobile,
          otpReference: FIXED_OTP,
          tenantId: ROOT_TENANT,
          type: 'CITIZEN',
        },
      },
    });
    expect(regResp.ok(), `pre-registration of test citizen failed: ${regResp.status()}`).toBeTruthy();

    // Capture every network call made during login so we can later assert
    // WHICH endpoint did the auth (overlay vs direct /user/oauth/token).
    // Mocking is forbidden in this suite — we passively listen, we don't
    // intercept.
    const authRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/token|\/oauth\/token|\/_create|\/protocol\/openid-connect\/token/.test(req.url())) {
        authRequests.push(req.url());
      }
    });

    await page.goto(LOGIN_URL);

    // The page renders both surfaces when KC mode is on: the SSO button
    // above and the mobile form below. We're testing the mobile path.
    await expect(page.getByLabel(/mobile number/i)).toBeVisible({ timeout: 15_000 });
    await page.getByLabel(/mobile number/i).fill(mobile);
    await page.getByRole('button', { name: /send otp/i }).click();

    // OTP step. Field is labeled "One-time code", button is "Sign in".
    // egov-user has CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE=123456 in this preview.
    await expect(page.getByLabel(/one-time code/i)).toBeVisible({ timeout: 15_000 });
    await page.getByLabel(/one-time code/i).fill(FIXED_OTP);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    // Landing assertion — the citizen lands on /dashboard (or /all-services
    // depending on the SPA's default route). Anything UNDER /citizen/ that
    // isn't /login means we're authenticated.
    await page.waitForURL(/\/citizen\/(?!login\b).+/, { timeout: 30_000 });
    expect(page.url()).not.toContain('/citizen/login');

    // Pin the routing FIRST — that's the load-bearing claim. Even if the
    // legacy DIGIT path "works" (the citizen logs in and the dashboard
    // loads), bypassing the overlay means we lose the KC integration
    // entirely. Capture all auth POSTs so the failure message tells us
    // what actually happened, not just "the token is missing".
    const overlayCall = authRequests.find((u) => u.includes('/token-exchange/') && u.includes('/protocol/openid-connect/token'));
    const legacyCall = authRequests.find((u) => /\/user\/oauth\/token$/.test(u));
    expect(
      overlayCall,
      `expected POST to /token-exchange/realms/.../token. Captured auth POSTs: ${JSON.stringify(authRequests)}`,
    ).toBeTruthy();
    expect(
      legacyCall,
      `legacy /user/oauth/token was called — overlay routing regressed. Captured: ${JSON.stringify(authRequests)}`,
    ).toBeFalsy();

    // The overlay's response is a KC-signed JWT. The SPA stashes it in
    // localStorage under digit_ui_v2_kc_access (see api/config.ts in
    // digit-ui-v2). Read the full localStorage so the failure message
    // tells us WHICH key actually has the token if the SPA stored it
    // somewhere we don't expect.
    const ls = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)!;
        out[k] = (window.localStorage.getItem(k) ?? '').slice(0, 80);
      }
      return out;
    });
    const stashed = ls['digit_ui_v2_kc_access'];
    expect(
      stashed,
      `KC access_token not at digit_ui_v2_kc_access. localStorage keys: ${JSON.stringify(Object.keys(ls))}. Auth POSTs: ${JSON.stringify(authRequests)}`,
    ).toBeTruthy();
    const full = await page.evaluate(() => window.localStorage.getItem('digit_ui_v2_kc_access'));
    const claims = decodeJwtPayload(full!);
    expect(claims.iss).toBe(`${BASE_URL}/auth/realms/${KC_REALM}`);
  });

  test('Continue with Google emits an /authorize URL with PKCE S256 + kc_idp_hint=google', { tag: ['@persona:citizen'] }, async ({ page }) => {
    await page.goto(LOGIN_URL);

    // The button only renders in KC mode — its absence is itself a
    // regression (SPA built without VITE_AUTH_PROVIDER=keycloak).
    const googleBtn = page.getByRole('button', { name: /continue with google/i });
    await expect(googleBtn).toBeVisible({ timeout: 15_000 });

    // Click → the SPA computes the authorize URL (PKCE verifier +
    // challenge, state, kc_idp_hint) and window.location.assigns it.
    // We don't follow the redirect to Google — we just snapshot the URL
    // the browser is about to navigate to, parse it, and pin every
    // param KC would 400 on if missing.
    //
    // `waitForRequest` against a navigation works because the browser
    // issues a top-level GET for the authorize endpoint before KC's
    // 302 to Google.
    const [authReq] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().startsWith(`${REALM_BASE}/protocol/openid-connect/auth`),
        { timeout: 15_000 },
      ),
      googleBtn.click(),
    ]);

    const url = new URL(authReq.url());
    expect(url.searchParams.get('client_id')).toBe(KC_CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid');
    // PKCE — the digit-ui client is public, the realm requires S256.
    // Missing this is "Missing parameter: code_challenge_method".
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge'), 'PKCE code_challenge missing').toBeTruthy();
    // The "skip the account chooser" hint — without it the button still
    // works but the user sees an extra screen.
    expect(url.searchParams.get('kc_idp_hint')).toBe('google');
    // redirect_uri must be in the client's allowlist — pinning to the
    // /citizen/* callback proves the realm import wired the right URI.
    const redirect = url.searchParams.get('redirect_uri') ?? '';
    expect(redirect).toBe(`${BASE_URL}${CITIZEN_BASENAME}/auth/callback`);

    // The code_challenge in the URL is a SHA-256 of a verifier the SPA
    // generated and persisted to localStorage. We can't read localStorage
    // here because the click already navigated us off the SPA origin —
    // but the challenge in the URL is sufficient evidence that the
    // verifier was generated. RFC 7636 says it's base64url of a 256-bit
    // digest = exactly 43 chars, no padding.
    const challenge = url.searchParams.get('code_challenge') ?? '';
    expect(challenge.length).toBe(43);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});
