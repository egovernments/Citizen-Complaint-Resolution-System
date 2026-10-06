import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { CONFIGURATOR_BASE, detectConfiguratorLogin, loginConfigurator } from '../utils/configurator-auth';

const AUTH_FILE = path.resolve('auth.json');

// Admin session for the configurator, saved to auth.json for the admin specs.
// Form builds walk the real sign-in form, so a login regression fails here. Hosted
// sign-in builds (#2107: Keycloak through identity-bff, no credential fields on the
// configurator, and a deployment's Keycloak users need not map to the tenant under
// test) get the session seeded with an API-minted DIGIT token instead, the shape
// identity-bff writes after sign-in; admin/login.spec.ts covers that login page.
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

  // Not every target under test deploys the configurator (e.g. a local-setup
  // stack that only runs digit-ui-esbuild for PGR). `chromium`'s project
  // dependency on this fixture is purely for sequencing — employee/citizen
  // specs authenticate independently via API token injection and override
  // storageState themselves, so they never read auth.json's contents. Only
  // admin/configurator specs actually need it. Skip (not fail) when the
  // route 404s so a missing configurator doesn't block every other persona's
  // specs (previously required a manual `--no-deps` workaround).
  const response = await page.request.get('/configurator/login');
  if (!response.ok()) {
    setup.skip(
      true,
      `configurator not reachable on this target (GET /configurator/login -> ${response.status()}) — admin/configurator specs will skip for lack of auth.json, but employee/citizen specs authenticate independently and are unaffected`,
    );
    return;
  }

  if ((await detectConfiguratorLogin(page)) === 'form') {
    await page.locator('#username').fill(ADMIN_USER);
    await page.locator('#password').fill(ADMIN_PASS);
    const tenantInput = page.locator('#tenantCode');
    await tenantInput.click();
    await tenantInput.fill(ROOT_TENANT);
    // Management mode lands on /manage rather than onboarding's /phase/1. The
    // button has no role=button attribute of its own; match it by visible text.
    await page.getByRole('button', { name: /^Management$/ }).click();
    await Promise.all([
      page.waitForURL(/\/configurator\/manage/, { timeout: 30_000 }),
      page.getByRole('button', { name: /Sign In/i }).click(),
    ]);
  } else {
    await loginConfigurator(page);
  }

  // Logged in, positively: the management layout rendered...
  await expect(page).toHaveURL(/\/configurator\/manage/, { timeout: 30_000 });
  await expect(page.locator('main#main-content')).toBeVisible({ timeout: 30_000 });
  // ...the session survived the app's first data requests (a 401 there signs it out)...
  await page.waitForLoadState('networkidle');
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
