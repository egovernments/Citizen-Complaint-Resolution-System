import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { loginConfigurator } from '../utils/configurator-auth';

const AUTH_FILE = path.resolve('auth.json');

// Optional overrides (deploy/*.env); unset falls back to tests/utils/env.ts.
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TENANT_CODE = process.env.TENANT_CODE;

// Admin session for the configurator, minted through the API rather than the
// login UI. The configurator's login is now hosted sign-in (#2107): Keycloak
// through identity-bff, with no credential fields of its own, so there is no
// form to walk, and a deployment's Keycloak users need not map to the tenant
// under test. The app restores its session from localStorage['crs-auth-state'],
// which is what identity-bff writes after sign-in too, so seeding it with an
// API-minted DIGIT token reaches the same /manage surface. The login pages
// themselves are covered by admin/login.spec.ts.
setup('authenticate', async ({ page }) => {
  // Not every target under test deploys the configurator (e.g. a local-setup
  // stack that only runs digit-ui-esbuild for PGR). `chromium`'s project
  // dependency on this fixture is purely for sequencing — employee/citizen
  // specs authenticate independently via API token injection and override
  // storageState themselves, so they never read auth.json's contents. Only
  // admin/configurator specs actually need it. Skip (not fail) when the
  // route 404s so a missing configurator doesn't block every other persona's
  // specs (previously required a manual `--no-deps` workaround).
  const response = await page.goto('/configurator/login');
  if (!response || !response.ok()) {
    setup.skip(
      true,
      `configurator not reachable on this target (GET /configurator/login -> ${response ? response.status() : 'no response'}) — admin/configurator specs will skip for lack of auth.json, but employee/citizen specs authenticate independently and are unaffected`,
    );
    return;
  }

  await loginConfigurator(page, { username: ADMIN_USER, password: ADMIN_PASSWORD, tenant: TENANT_CODE });

  // The app accepted the seeded session: it stayed on /manage instead of
  // bouncing to /login (a rejected token clears the session and redirects).
  await expect(page).toHaveURL(/\/configurator\/manage/, { timeout: 30_000 });
  const hasAuthState = await page.evaluate(() => !!localStorage.getItem('crs-auth-state'));
  expect(hasAuthState).toBe(true);

  await page.context().storageState({ path: AUTH_FILE });
});
