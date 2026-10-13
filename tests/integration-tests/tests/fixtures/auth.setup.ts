import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { BASE_URL, TENANT } from '../utils/env';
import { CONFIGURATOR_BASE, loginConfigurator } from '../utils/configurator-auth';

const AUTH_FILE = path.resolve('auth.json');

/**
 * The Configurator keeps an admin in /onboarding/... until the workspace's
 * setup steps are DONE (pgr-services onboarding Workspace), and only then
 * serves /manage. Every admin spec needs /manage, so say which gate held.
 */
function assertPastWorkspaceGate(url: string): void {
  if (!url.includes('/configurator/onboarding/')) return;
  throw new Error(
    `Workspace gate: the Configurator sent the admin to ${new URL(url).pathname} instead of /configurator/manage. ` +
      `Workspace setup for ${TENANT} is not DONE (pgr-services onboarding Workspace _search). Finish its onboarding ` +
      'steps in the Configurator, or target a workspace created through Configurator signup (#2398).',
  );
}

// Save both the hosted BFF session cookie and selected DIGIT context.
setup('authenticate', async ({ page, baseURL }) => {
  // One host for everything: the specs open relative /configurator/... on the
  // project's baseURL, so the token (env BASE_URL) and the seeded session
  // (CONFIGURATOR_BASE) must target that same host, or the specs run without one.
  const origin = (u: string) => new URL(u).origin;
  expect(origin(BASE_URL), `env BASE_URL (${BASE_URL}) must be Playwright's baseURL host (${baseURL}); set BASE_URL`).toBe(
    origin(baseURL!),
  );
  expect(origin(CONFIGURATOR_BASE), `CONFIGURATOR_BASE_URL (${CONFIGURATOR_BASE}) must be on ${baseURL}`).toBe(
    origin(baseURL!),
  );

  await loginConfigurator(page);

  // Logged in, positively: the management layout rendered...
  await expect(page).toHaveURL(/\/configurator\/(manage|onboarding\/)/, { timeout: 30_000 });
  assertPastWorkspaceGate(page.url());
  await expect(page.locator('main#main-content')).toBeVisible({ timeout: 30_000 });
  // ...the session survived the app's first data requests (a 401 there signs it
  // out; the workspace sync can still move it to onboarding)...
  await page.waitForLoadState('networkidle');
  assertPastWorkspaceGate(page.url());
  await expect(page).toHaveURL(/\/configurator\/manage/);
  // ...and DIGIT accepts the stored token (401 for a dead one). Its value is never printed.
  const session = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('crs-auth-state') || '{}') as {
        authToken?: string;
        tenant?: string;
        user?: { uuid?: string };
      },
  );
  expect(session.authToken, 'crs-auth-state must hold a token').toBeTruthy();
  const self = await page.request.post(`${BASE_URL}/user/_search`, {
    data: { RequestInfo: { authToken: session.authToken }, uuid: [session.user?.uuid], tenantId: session.tenant },
  });
  expect(self.status(), 'DIGIT must accept the session token (POST /user/_search for the signed-in user)').toBe(200);

  await page.context().storageState({ path: AUTH_FILE });
});
