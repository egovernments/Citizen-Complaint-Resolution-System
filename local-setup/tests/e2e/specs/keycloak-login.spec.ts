/** Deployment smoke tests for the organization-aware Identity BFF. */
import { test, expect } from '@playwright/test';

const REALM = process.env.KEYCLOAK_REALM || 'digit';

test.describe('Identity BFF', () => {
  test('advertises only methods enabled in Keycloak', async ({ request }) => {
    const response = await request.get('/identity/v1/auth-methods');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(Array.isArray(body.methods)).toBe(true);
    expect(body.methods).toContainEqual(expect.objectContaining({ id: 'password' }));
  });

  test('starts OIDC authorization without exposing a Keycloak token', async ({ request }) => {
    const response = await request.get('/identity/v1/authorize?method=password', {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    const location = response.headers().location || '';
    expect(location).toContain(`/auth/realms/${REALM}/protocol/openid-connect/auth`);
    expect(location).toContain('code_challenge_method=S256');
    expect(response.headers()['set-cookie']).toContain('HttpOnly');
  });

  test('reports an anonymous session without returning tokens', async ({ request }) => {
    const response = await request.get('/identity/v1/session');
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toMatch(/access_token|refresh_token/i);
  });

  test('shared Organizations realm publishes OIDC discovery', async ({ request }) => {
    const response = await request.get(
      `/auth/realms/${REALM}/.well-known/openid-configuration`,
    );
    expect(response.ok()).toBeTruthy();
    const discovery = await response.json();
    expect(discovery.issuer).toContain(`/auth/realms/${REALM}`);
  });

  test('does not publish the internal identity control plane', async ({ request }) => {
    const response = await request.post('/internal/identity/v1/reconciliation/_run', {
      data: {},
    });
    expect([404, 401]).toContain(response.status());
  });
});
