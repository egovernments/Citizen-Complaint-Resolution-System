/** BFF replacement for the six token-exchange-overlay API cases. */
import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS, KC_BASE, KC_REALM } from '../utils/env';
import { staffContext } from '../utils/auth';
import { authorizeUrl, identityJson } from '../utils/identity-bff';

const issuer = `${KC_BASE}/realms/${encodeURIComponent(KC_REALM)}`;
test.use({ storageState: { cookies: [], origins: [] } });
test.describe('Keycloak through identity-bff — API contract', () => {
  test('OIDC discovery: issuer includes the /auth prefix (frontendUrl regression)', { tag: ['@area:keycloak', '@persona:system'] }, async ({ request }) => {
    const discovery = await identityJson<{ issuer: string }>(await request.get(`${issuer}/.well-known/openid-configuration`));
    expect(discovery.issuer).toBe(issuer);
    expect(new URL(discovery.issuer).origin).toBe(new URL(BASE_URL).origin);
  });

  test('OIDC discovery: every endpoint URL lives under the issuer origin + /auth prefix', { tag: ['@area:keycloak', '@persona:system'] }, async ({ request }) => {
    const discovery = await identityJson<Record<string, string>>(await request.get(`${issuer}/.well-known/openid-configuration`));
    for (const [field, suffix] of [['authorization_endpoint', 'auth'], ['token_endpoint', 'token'], ['end_session_endpoint', 'logout']]) {
      expect(discovery[field]).toBe(`${issuer}/protocol/openid-connect/${suffix}`);
    }
  });

  test('Hosted sign-in and _select mint an EMPLOYEE DIGIT context', { tag: ['@area:keycloak', '@persona:system'] }, async ({ page }) => {
    const context = await staffContext(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS }, 'employee');
    expect(Boolean(context.access_token)).toBe(true);
    expect(context.UserRequest.type).toBe('EMPLOYEE');
    expect(context.UserRequest.tenantId).toBe(TENANT);
    expect(context.UserRequest.roles).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'EMPLOYEE' })]));
    // BFF keeps Keycloak refresh/id tokens server-side.
    expect('refresh_token' in context).toBe(false);
    expect('id_token' in context).toBe(false);
    expect((await page.request.get(`${BASE_URL}/identity/v1/session?surface=employee`)).status()).toBe(200);
  });

  test('Selected DIGIT token round-trips directly to MDMS', { tag: ['@area:keycloak', '@persona:system'] }, async ({ page }) => {
    const context = await staffContext(page, { tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS }, 'employee');
    const response = await page.request.post(`${BASE_URL}/mdms-v2/v2/_search`, {
      data: { RequestInfo: { authToken: context.access_token }, MdmsCriteria: { tenantId: TENANT,
        schemaCode: 'common-masters.StateInfo', limit: 1, offset: 0 } },
    });
    expect(response.status()).toBe(200);
    // mdms-v2's v2 search answers `mdms` (MdmsRes is the v1 shape).
    expect(Array.isArray((await response.json()).mdms)).toBe(true);
  });

  test('BFF authorize owns PKCE and the configured Google IdP hint', { tag: ['@area:keycloak', '@persona:system'] }, async ({ request }) => {
    const offered = await identityJson<{ methods?: Array<{ id?: string }> }>(
      await request.get(`${BASE_URL}/identity/v1/auth-methods?surface=citizen&intent=signin`));
    test.skip(!offered.methods?.some(m => m.id === 'google'), 'this deployment offers citizens no Google sign-in (/identity/v1/auth-methods)');
    const response = await request.get(authorizeUrl(BASE_URL, 'citizen', 'google'), { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const destination = new URL(response.headers().location);
    expect(destination.pathname).toBe(`/auth/realms/${KC_REALM}/protocol/openid-connect/auth`);
    expect(destination.searchParams.get('code_challenge_method')).toBe('S256');
    expect(destination.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(destination.searchParams.get('kc_idp_hint')).toBe('google');
    expect(destination.searchParams.get('redirect_uri')).toBe(`${BASE_URL}/identity/v1/callback`);
  });

  // /readyz is the BFF container's own endpoint; deployed nginx does not route it.
  test('BFF readiness reports Redis and all identity dependencies', { tag: ['@local-only', '@area:keycloak', '@persona:system'] }, async ({ request }) => {
    const body = await identityJson<{ status: string; checks: Record<string, unknown> }>(await request.get(`${BASE_URL}/readyz`));
    expect(body.status).toBe('ready');
    expect(body.checks.redis).toBe('ok');
    expect(body.checks.jwks).toBe('ok');
    expect(body.checks.keycloakAdmin).toBe('ok');
    expect(body.checks.digit).toBe('ok');
    for (const field of ['catalog', 'poller', 'reconcile']) expect(body.checks).toHaveProperty(field);
  });
});
