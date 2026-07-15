import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

const AUTH_FILE = path.resolve('auth-api.json');

// Token-injection auth. Skips the UI login form entirely — used by smoke
// and api projects where login is a prerequisite, not the thing under test.
// Mirrors local-setup/tests/e2e/utils/auth.ts:loginViaApi.
setup('authenticate via api', async ({ page }) => {
  const tokenUrl = `${BASE_URL}/user/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    username: ADMIN_USER,
    password: ADMIN_PASS,
    tenantId: ROOT_TENANT,
    scope: 'read',
    userType: 'EMPLOYEE',
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
    },
    body: body.toString(),
  });

  expect(resp.ok, `ROPC token request failed (${resp.status})`).toBe(true);
  const tokenJson = await resp.json() as {
    access_token: string;
    UserRequest?: { uuid: string; name: string; roles: Array<{ code: string; tenantId: string }> };
  };
  expect(tokenJson.access_token).toBeTruthy();

  // localStorage is origin-scoped; navigate first to set the origin.
  await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  await page.evaluate(
    ({ token, userInfo, tenant }) => {
      localStorage.setItem('Employee.token', token);
      localStorage.setItem('Employee.tenant-id', tenant);
      localStorage.setItem('Employee.user-info', JSON.stringify(userInfo));
      localStorage.setItem('Employee.locale', 'en_IN');
      localStorage.setItem('token', token);
      localStorage.setItem('tenant-id', tenant);
      localStorage.setItem('user-info', JSON.stringify(userInfo));
    },
    {
      token: tokenJson.access_token,
      userInfo: tokenJson.UserRequest || {},
      tenant: ROOT_TENANT,
    },
  );

  await page.context().storageState({ path: AUTH_FILE });
});
