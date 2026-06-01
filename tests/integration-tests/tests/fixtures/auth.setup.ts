import { test as setup, expect } from '@playwright/test';
import path from 'node:path';

const AUTH_FILE = path.resolve('auth.json');

const ADMIN_USER = process.env.ADMIN_USER || 'ADMIN';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'eGov@123';
const TENANT_CODE = process.env.TENANT_CODE || 'ke';

// UI login flow against the configurator. We intentionally walk the form
// rather than injecting localStorage so the spec exercises the same login
// surface a real admin uses (and catches regressions in the login form).
setup('authenticate', async ({ page }) => {
  await page.goto('/configurator/login');

  // The login page boots client-side — wait for the username field to mount.
  const usernameInput = page.locator('#username');
  await expect(usernameInput).toBeVisible();

  await usernameInput.fill(ADMIN_USER);
  await page.locator('#password').fill(ADMIN_PASSWORD);

  const tenantInput = page.locator('#tenantCode');
  await tenantInput.click();
  await tenantInput.fill(TENANT_CODE);

  // Choose Management mode so we land on /manage rather than /phase/1.
  // The button has no role=button — it's a styled <button type="button">.
  // Match by visible text. Onboarding is the default so this is required.
  const managementButton = page.getByRole('button', { name: /^Management$/ });
  await managementButton.click();

  // Submit and wait for navigation away from the login screen.
  await Promise.all([
    page.waitForURL(/\/configurator\/(manage|phase\/1)/, { timeout: 30_000 }),
    page.getByRole('button', { name: /Sign In/i }).click(),
  ]);

  // Sanity: localStorage should now hold the configurator session blob.
  // We don't print the token — only assert presence.
  const hasAuthState = await page.evaluate(
    () => !!localStorage.getItem('crs-auth-state'),
  );
  expect(hasAuthState).toBe(true);

  await page.context().storageState({ path: AUTH_FILE });
});
