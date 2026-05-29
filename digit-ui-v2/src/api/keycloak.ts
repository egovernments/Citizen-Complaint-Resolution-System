/**
 * OAuth2 Authorization Code Flow helper for Keycloak.
 *
 * Public client `digit-ui` is pre-seeded in the realm template; no client
 * secret. We don't use PKCE here because (a) the realm is also accessed by
 * server-side flows that need confidential semantics, and (b) the overlay
 * service immediately revalidates the JWT signature on every request — the
 * code's window of usefulness is the round-trip time to /token, after which
 * it's consumed and discarded.
 *
 * The endpoints below are all on `${KEYCLOAK_URL}/realms/${REALM}/...`.
 * `KEYCLOAK_URL` is browser-relative ("/auth"), so the browser resolves
 * to the same origin as the SPA. nginx proxies `/auth` → Keycloak.
 *
 * All token operations live in localStorage:
 *   digit_ui_v2_kc_access   short-lived access JWT (sent as Bearer)
 *   digit_ui_v2_kc_refresh  long-lived refresh token (used on 401 retry)
 *   digit_ui_v2_kc_id       id_token, only needed for RP-initiated logout
 *   digit_ui_v2_kc_oauth_state   CSRF state, lives only between /authorize
 *                                redirect and /callback
 *   digit_ui_v2_kc_expires_at    epoch ms — UI hint, not enforced
 *
 * Note: storing tokens in localStorage is the established pattern for this
 * SPA (the OTP-derived DIGIT token is also in localStorage). The overlay
 * defends against XSS-stolen tokens by checking the JWT signature + iss
 * claim on every call.
 */
import {
  KEYCLOAK_URL,
  KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID,
  KC_STORAGE_KEYS,
  TOKEN_EXCHANGE_URL,
  getOriginBaseUrl,
} from './config';

export interface KcTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  token_type?: string;
  scope?: string;
}

/**
 * Decode the payload of a JWT without verifying its signature. The overlay
 * always re-validates the signature server-side on every call — this is
 * just for the SPA to extract claims for UI display.
 */
export function decodeJwtPayload(jwt: string): Record<string, any> {
  try {
    const part = jwt.split('.')[1];
    if (!part) return {};
    // base64url → base64
    const pad = part.length % 4 === 2 ? '==' : part.length % 4 === 3 ? '=' : '';
    const b64 = (part + pad).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch {
    return {};
  }
}

// ── localStorage helpers ───────────────────────────────────────────────────

export function getKcAccessToken(): string | null {
  try {
    return localStorage.getItem(KC_STORAGE_KEYS.access);
  } catch {
    return null;
  }
}

export function getKcRefreshToken(): string | null {
  try {
    return localStorage.getItem(KC_STORAGE_KEYS.refresh);
  } catch {
    return null;
  }
}

export function getKcIdToken(): string | null {
  try {
    return localStorage.getItem(KC_STORAGE_KEYS.id);
  } catch {
    return null;
  }
}

export function hasKcToken(): boolean {
  return !!getKcAccessToken();
}

export function saveKcTokens(tokens: KcTokenResponse): void {
  localStorage.setItem(KC_STORAGE_KEYS.access, tokens.access_token);
  localStorage.setItem(KC_STORAGE_KEYS.refresh, tokens.refresh_token);
  localStorage.setItem(KC_STORAGE_KEYS.id, tokens.id_token);
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  localStorage.setItem(KC_STORAGE_KEYS.expiresAt, String(expiresAt));
}

export function clearKcTokens(): void {
  localStorage.removeItem(KC_STORAGE_KEYS.access);
  localStorage.removeItem(KC_STORAGE_KEYS.refresh);
  localStorage.removeItem(KC_STORAGE_KEYS.id);
  localStorage.removeItem(KC_STORAGE_KEYS.expiresAt);
}

// ── KC URL builders ────────────────────────────────────────────────────────

function realmBase(): string {
  // KEYCLOAK_URL is relative ("/auth"); browser resolves against the current
  // origin so we get e.g. https://naipepea.digit.org/auth/realms/ke/...
  return `${KEYCLOAK_URL}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/protocol/openid-connect`;
}

function absoluteRedirectUri(path: string): string {
  // Normalize so callers can pass either '/citizen/auth/callback' or full URL.
  if (/^https?:\/\//.test(path)) return path;
  return `${getOriginBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

function generateState(): string {
  // crypto.getRandomValues is universally available in browsers we ship to.
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── PKCE (RFC 7636) ─────────────────────────────────────────────────────────
//
// Keycloak's `digit-ui` client is a public client (no client_secret in the
// browser), so the realm requires PKCE. Flow:
//   1. /authorize → send `code_challenge` (S256 hash of a random verifier) +
//      `code_challenge_method=S256`. Save the verifier in localStorage.
//   2. KC remembers the challenge against the issued code.
//   3. /token → send the original `code_verifier`. KC re-hashes it and checks
//      it matches what it stored. Mismatch → 400.
// PKCE costs ~100 bytes of localStorage and one extra POST param. There's
// no reason not to do it on every authorize call.

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier(): string {
  // 32 random bytes → 43-char base64url — meets the RFC's 43..128 range.
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

async function computeCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export function getStoredCodeVerifier(): string | null {
  try {
    return localStorage.getItem(KC_STORAGE_KEYS.pkceVerifier);
  } catch {
    return null;
  }
}

export function clearStoredCodeVerifier(): void {
  try {
    localStorage.removeItem(KC_STORAGE_KEYS.pkceVerifier);
  } catch {
    /* best-effort */
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the /authorize redirect URL and persist the CSRF state so the
 * callback can verify it.
 *
 * @param redirectPath path the callback page lives at — e.g.
 *   '/citizen/auth/callback'. We turn it into an absolute redirect_uri
 *   because Keycloak requires that.
 */
export async function buildAuthorizeUrl(redirectPath: string, idpHint?: string): Promise<string> {
  const state = generateState();
  const verifier = generateCodeVerifier();
  const challenge = await computeCodeChallenge(verifier);
  try {
    localStorage.setItem(KC_STORAGE_KEYS.state, state);
    localStorage.setItem(KC_STORAGE_KEYS.pkceVerifier, verifier);
  } catch {
    // If localStorage is unavailable the callback will fail state +
    // PKCE verification and fall through to the error path — better than
    // silently allowing CSRF or an unhashed-public-client flow.
  }
  const params = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    redirect_uri: absoluteRedirectUri(redirectPath),
    response_type: 'code',
    scope: 'openid',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  // `kc_idp_hint` skips the Keycloak account-chooser screen and routes
  // straight to the named identity provider (e.g. `google`). The realm
  // must have the IdP provisioned with that exact alias — see the ansible
  // `keycloak-bootstrap — wire Google IdP` task.
  if (idpHint) params.set('kc_idp_hint', idpHint);
  return `${realmBase()}/auth?${params.toString()}`;
}

/**
 * OAuth2 Resource Owner Password Credentials grant against the overlay's
 * `/realms/:realm/protocol/openid-connect/token` endpoint. The overlay
 * tries the KC realm first; on KC failure it transparently falls back to
 * DIGIT (egov-user `/user/oauth/token`) and provisions the KC side from
 * the DIGIT user info. Net result: mobile+OTP citizens authenticate
 * locally (no redirect) while the SPA still ends up with KC-signed JWTs
 * for subsequent API calls — exactly what `kc_idp_hint=google` does for
 * SSO, just without leaving the SPA.
 */
export async function passwordGrantViaOverlay(opts: {
  username: string;
  password: string;
  tenantId?: string;
  userType?: string;
}): Promise<KcTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: KEYCLOAK_CLIENT_ID,
    username: opts.username,
    password: opts.password,
    scope: 'openid',
  });
  // Overlay reads these from the form body (KC ignores them; DIGIT
  // fallback needs them to call /user/oauth/token correctly).
  if (opts.tenantId) body.set('tenantId', opts.tenantId);
  if (opts.userType) body.set('userType', opts.userType);

  const origin = getOriginBaseUrl();
  const url = `${origin}${TOKEN_EXCHANGE_URL}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/protocol/openid-connect/token`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_description || err.error || `password grant failed: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Exchange an authorization code for tokens. Throws on any non-2xx — the
 * caller (callback page) is expected to surface the error to the user.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<KcTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: absoluteRedirectUri(redirectUri),
    client_id: KEYCLOAK_CLIENT_ID,
  });
  // PKCE: send back the original verifier we generated at /authorize.
  // KC re-hashes it server-side and matches against the challenge it
  // stored against the code — public-client requirement, can't skip.
  const verifier = getStoredCodeVerifier();
  if (verifier) body.set('code_verifier', verifier);

  const res = await fetch(`${realmBase()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  clearStoredCodeVerifier();   // single-use whether the request succeeded or not
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Keycloak token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as KcTokenResponse;
}

/**
 * Use the stored refresh_token to mint a new access_token. Throws if the
 * refresh token is missing or rejected — caller should clearKcTokens() and
 * redirect to login on failure.
 */
export async function refreshKcToken(): Promise<KcTokenResponse> {
  const refresh = getKcRefreshToken();
  if (!refresh) throw new Error('No refresh_token available');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: KEYCLOAK_CLIENT_ID,
  });
  const res = await fetch(`${realmBase()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Keycloak refresh failed (${res.status})`);
  }
  const tokens = (await res.json()) as KcTokenResponse;
  saveKcTokens(tokens);
  return tokens;
}

/**
 * Verify the state value returned on the callback matches what we stored.
 * Consumes the stored state (single-use). Returns true on match.
 */
export function consumeAndVerifyState(returnedState: string | null): boolean {
  if (!returnedState) return false;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KC_STORAGE_KEYS.state);
    localStorage.removeItem(KC_STORAGE_KEYS.state);
  } catch {
    return false;
  }
  return !!stored && stored === returnedState;
}

/**
 * RP-initiated logout — Keycloak revokes the session, then redirects back
 * to the post_logout_redirect_uri. Browser navigates away; this function
 * never returns.
 */
export function logoutKc(idToken: string | null, postLogoutPath = '/citizen/login'): void {
  const postLogout = absoluteRedirectUri(postLogoutPath);
  const params = new URLSearchParams({ post_logout_redirect_uri: postLogout });
  if (idToken) params.set('id_token_hint', idToken);
  // client_id is also accepted by Keycloak when id_token_hint is unavailable.
  params.set('client_id', KEYCLOAK_CLIENT_ID);
  window.location.assign(`${realmBase()}/logout?${params.toString()}`);
}
