import { test, expect } from '@playwright/test';
import { identityJson } from '../utils/identity-bff';
import { baseURL, missingConfig } from './fixtures';

test('gate targets a live Keycloak issuer and ready BFF dependencies', async ({ request }) => {
  const missing = missingConfig();
  test.skip(missing.length > 0, `Pending root real gate; unset: ${missing.join(', ')}`);
  const issuer = process.env.KEYCLOAK_URL!.replace(/\/$/, '');
  const discovery = await identityJson<{ issuer: string; authorization_endpoint: string; jwks_uri: string }>(
    await request.get(`${issuer}/.well-known/openid-configuration`),
  );
  expect(discovery.issuer).toBe(issuer);
  expect(discovery.authorization_endpoint).toBe(`${issuer}/protocol/openid-connect/auth`);
  expect((await request.get(discovery.jwks_uri)).status()).toBe(200);
  const ready = await identityJson<{ status: string; checks: Record<string, unknown> }>(await request.get(`${baseURL()}/readyz`));
  expect(ready.status).toBe('ready');
  for (const name of ['redis', 'jwks', 'keycloakAdmin', 'digit']) expect(ready.checks[name]).toBe('ok');
});
