import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test('citizen logout redirects to login page', {
  annotation: {
    type: 'description',
    description: `Story 9.1 contract: a citizen who clicks Logout, then confirms in the logout dialog, must land on the tenant's /citizen/login — not on /all-services or any other authenticated surface. Catches a regression where the dialog closes without firing the actual logout, or the post-logout redirect points to the wrong place.

Steps:
1. setTimeout 90s; OTP-login as a fresh citizen (BFF phone OTP).
2. Click the rail's Logout button (role button /log ?out/i; its label is CORE_COMMON_LOGOUT).
3. In the LogoutDialog (.digit-logout-popup-wrapper), click the confirm button. Since #2038 it reads "Log out" (CORE_LOGOUT_CONFIRM_ACTION), not "Yes, Logout".
4. Wait for the redirect to the tenant's /citizen/login (identityBffLogoutRedirect).
5. Assert the URL does NOT contain '/all-services'.`,
  },
  tag: ['@area:auth', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
  test.setTimeout(90_000);
  const phone = generateCitizenPhone();
  await citizenOtpLogin(page, phone);

  // The desktop rail's Logout (SidebarFoot) opens the confirm dialog.
  const logoutButton = page.getByRole('button', { name: /log ?out/i }).first();
  await expect(logoutButton).toBeVisible({ timeout: 10_000 });
  await logoutButton.click();

  // #2038: the confirm button reads "Log out" (CORE_LOGOUT_CONFIRM_ACTION).
  // Scope to the dialog so the rail's own Logout button cannot match.
  const dialog = page.locator('.digit-logout-popup-wrapper');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.getByRole('button', { name: /log ?out/i }).click();
  await page.waitForURL(/\/citizen\/login/, { timeout: 15_000 });

  // Should be on the login page, NOT /all-services
  const currentUrl = page.url();
  console.log('Post-logout URL:', currentUrl);

  expect(currentUrl).toContain('/citizen/login');
  expect(currentUrl).not.toContain('/all-services');
});
