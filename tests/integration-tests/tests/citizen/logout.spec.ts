import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test('citizen logout redirects to login page', {
  annotation: {
    type: 'description',
    description: `Story 9.1 contract: a citizen who clicks Logout in the sidebar, then confirms via the "Yes, Logout" dialog, must land on /citizen/login — not on /all-services or any other authenticated surface. Catches a regression where the dialog closes without firing the actual logout, or the post-logout redirect points to the wrong place.

Steps:
1. setTimeout 90s; OTP-login as a fresh citizen.
2. Wait 3s; locate the Logout sidebar item; assert it is visible.
3. Click Logout and wait 1s for the confirmation dialog.
4. Locate button:has-text("Yes, Logout"); wait for visibility, click.
5. Wait 5s for the redirect to settle.
6. Assert page.url() contains '/citizen/login' and does NOT contain '/all-services'.

Tighter selector ("Yes, Logout") than the previous union of "Yes / Logout / CS_COMMON_LOGOUT" — relies on the 2026-04-29 walk's verified dialog copy.`,
  },
  tag: ['@area:auth', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
  test.setTimeout(90_000);
  const phone = generateCitizenPhone();
  await citizenOtpLogin(page, phone);

  // Verify we're logged in by checking the sidebar
  await page.waitForTimeout(3000);
  const logoutLink = page.locator('text=Logout').first();
  await expect(logoutLink).toBeVisible({ timeout: 10_000 });

  // Click logout
  await logoutLink.click();
  await page.waitForTimeout(1000);

  // Confirm the logout dialog — the actual button label per the
  // 2026-04-29 walk is "Yes, Logout" (Story 9.1). Tighter selector
  // than the previous "Yes" / "Logout" / "CS_COMMON_LOGOUT" union.
  const confirmButton = page.locator('button:has-text("Yes, Logout")').first();
  await confirmButton.waitFor({ state: 'visible', timeout: 5_000 });
  await confirmButton.click();
  await page.waitForTimeout(5000);

  // Should be on the login page, NOT /all-services
  const currentUrl = page.url();
  console.log('Post-logout URL:', currentUrl);

  expect(currentUrl).toContain('/citizen/login');
  expect(currentUrl).not.toContain('/all-services');
});
