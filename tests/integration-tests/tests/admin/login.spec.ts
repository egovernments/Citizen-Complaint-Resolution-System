import { test, expect } from '@playwright/test';
import { ADMIN_USER } from '../utils/env';
import { enterHostedUsername } from '../utils/identity-bff';
import { detectConfiguratorLogin } from '../utils/configurator-auth';

// Replaces the three legacy/form-conditional cases without conditional skips.
test.use({ storageState: { cookies: [], origins: [] } });
test.describe('Configurator hosted sign-in', () => {
  test('fresh configurator contains no credential or tenant inputs', { tag: ['@area:auth', '@area:configurator-manage', '@persona:admin'] }, async ({ page }) => {
    expect(await detectConfiguratorLogin(page)).toBe('hosted');
    // Credentials moved to Keycloak: a fresh configurator must hold none.
    await expect(page.locator('#username, #password, #tenantCode')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('crs-auth-state'))).toBeNull();
    await expect(page.getByRole('button', { name: /^Log in$/ })).toBeVisible();
  });

  test('hosted credential inputs start empty and declare password autocomplete', { tag: ['@area:auth', '@area:configurator-manage', '@persona:admin'] }, async ({ page }) => {
    await detectConfiguratorLogin(page);
    await page.getByRole('button', { name: /^Log in$/ }).click();
    // The original autofill guarantee now applies at the hosted credential form.
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#username')).toHaveValue('');
    await enterHostedUsername(page, ADMIN_USER);
    await expect(page.locator('#password')).toHaveValue('');
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.locator('#tenantCode')).toHaveCount(0);
  });

  test('Log in starts the password sign-in through identity-bff', { tag: ['@area:auth', '@area:configurator-manage', '@persona:admin'] }, async ({ page }) => {
    expect(await detectConfiguratorLogin(page)).toBe('hosted');
    const [authorize] = await Promise.all([
      page.waitForRequest(r => new URL(r.url()).pathname === '/identity/v1/authorize'),
      page.getByRole('button', { name: /^Log in$/ }).click(),
    ]);
    const params = new URL(authorize.url()).searchParams;
    expect(params.get('method')).toBe('password');
    expect(params.get('intent')).toBe('signin');
    expect(params.get('tenantSlug')).toBeNull();
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#username')).toHaveValue('');
  });
});
