import { chromium, request, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Authenticate ADMIN against the live ovh deployment and stash the result as a
 * Playwright storage-state file that primes the configurator's localStorage
 * before every test.
 *
 * Why this shape:
 *   The configurator persists its session under the localStorage key
 *   `crs-auth-state` (see configurator/src/App.tsx). The shape is
 *   { authToken, user, environment, tenant, targetTenant, mode,
 *     currentPhase, completedPhases }. App.tsx restores apiClient + the
 *     bridge digitClient from that blob on mount, so reproducing it offline
 *     gives us the same logged-in state without needing the UI login form.
 *
 *   We hit `/user/oauth/token` with the empty-secret basic auth header
 *   (`egov-user-client:` -> base64 `ZWdvdi11c2VyLWNsaWVudDo=`, see the
 *   naipepea oauth note in MEMORY.md) and ADMIN/eGov@123 on tenant
 *   `ke.citya`. The returned access_token + UserRequest payload is
 *   marshalled into the localStorage blob.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://57.131.32.64';
const TENANT = process.env.PLAYWRIGHT_TENANT ?? 'ke.citya';
const USERNAME = process.env.PLAYWRIGHT_USERNAME ?? 'ADMIN';
const PASSWORD = process.env.PLAYWRIGHT_PASSWORD ?? 'eGov@123';
// `egov-user-client:` with EMPTY secret (naipepea oauth note).
const BASIC_AUTH = 'Basic ZWdvdi11c2VyLWNsaWVudDo=';

const STORAGE_DIR = path.resolve(__dirname, 'storage-state');
const STORAGE_PATH = path.join(STORAGE_DIR, 'admin.json');

async function fetchAdminToken(): Promise<{ token: string; user: Record<string, unknown> }> {
  const ctx = await request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
  const form = new URLSearchParams({
    username: USERNAME,
    password: PASSWORD,
    grant_type: 'password',
    scope: 'read',
    tenantId: TENANT,
    userType: 'EMPLOYEE',
  });
  const resp = await ctx.post('/user/oauth/token', {
    headers: {
      Authorization: BASIC_AUTH,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: form.toString(),
  });
  if (!resp.ok()) {
    throw new Error(`oauth/token failed: ${resp.status()} ${await resp.text()}`);
  }
  const body = await resp.json();
  const token = body.access_token as string;
  const u = body.UserRequest as Record<string, unknown>;
  if (!token || !u) throw new Error(`oauth/token missing token/UserRequest: ${JSON.stringify(body)}`);
  await ctx.dispose();
  return { token, user: u };
}

function buildAuthStateBlob(token: string, userRequest: Record<string, unknown>) {
  // Mirror the shape `restoreApiClientFromStorage` (configurator/src/App.tsx)
  // expects. `user` here is a thin DTO; roles must be a string[] of codes.
  const roles = Array.isArray(userRequest.roles)
    ? (userRequest.roles as Array<Record<string, unknown>>).map((r) => String(r.code ?? r.name ?? ''))
    : [];
  return {
    isAuthenticated: true,
    authToken: token,
    user: {
      id: userRequest.id,
      uuid: userRequest.uuid,
      name: userRequest.userName ?? userRequest.name ?? USERNAME,
      mobileNumber: userRequest.mobileNumber ?? '',
      email: userRequest.emailId ?? '',
      roles,
    },
    environment: BASE_URL,
    tenant: TENANT,
    targetTenant: TENANT,
    // Management mode is the gate for `/manage/*` (react-admin) routes —
    // EmployeeCreate, ComplaintCreate, etc. all live there. App.tsx routes
    // onboarding-mode users to /phase/1 instead.
    mode: 'management',
    currentPhase: 1,
    completedPhases: [],
  };
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });

  // Some tests (the bomet demo recordings) do their own login via the UI
  // and don't want any pre-seeded storage state. Skip the configurator-
  // ADMIN oauth dance when asked.
  if (process.env.PLAYWRIGHT_SKIP_SETUP === '1') {
    fs.writeFileSync(STORAGE_PATH, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }

  const { token, user } = await fetchAdminToken();
  const authBlob = buildAuthStateBlob(token, user);

  // Boot a real Chromium so we can attach localStorage to BASE_URL's origin
  // and then dump storageState. Setting via request context alone misses
  // localStorage (storageState only captures cookies + origins visited).
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // Hit the configurator first so the origin is registered. The page JS will
  // try to read crs-auth-state on mount — we inject BEFORE any subsequent
  // navigation by setting it here and then reloading once.
  await page.goto('/configurator/', { timeout: 90000 });
  await page.evaluate((blob) => {
    localStorage.setItem('crs-auth-state', JSON.stringify(blob));
  }, authBlob);
  // Reload so App.tsx's restoreApiClientFromStorage() runs against the seeded
  // blob; surfaces token problems in global setup instead of in each test.
  await page.goto('/configurator/', { timeout: 90000 });
  await page.waitForLoadState('domcontentloaded');

  await ctx.storageState({ path: STORAGE_PATH });
  await browser.close();

  // Also persist the raw token so individual tests can call APIs directly.
  fs.writeFileSync(
    path.join(STORAGE_DIR, 'token.json'),
    JSON.stringify({ token, tenant: TENANT, baseUrl: BASE_URL }, null, 2),
  );
}
