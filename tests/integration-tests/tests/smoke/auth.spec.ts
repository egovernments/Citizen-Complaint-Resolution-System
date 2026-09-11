import { test, expect } from '@playwright/test';
import { loginEmployee } from '../utils/launch-fixes/api.js';

test.describe('00-smoke: auth helper', () => {
  test('login returns token', {
    annotation: {
      type: 'description',
      description: `Smoke test for the API helper that all other API specs depend on. If this fails, every downstream API assertion is meaningless because no token can be acquired from the deployment.

Steps:
1. Call loginEmployee() — POSTs to /user/oauth/token with ADMIN credentials and the configured tenant.
2. Assert the response carries a non-empty access_token.

If this test fails, check egov-user is up and credentials in env match the deployment.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@kind:smoke', '@layer:api', '@persona:cross'],
  }, async () => {
    const auth = await loginEmployee();
    expect(auth.token).toBeTruthy();
  });
});
