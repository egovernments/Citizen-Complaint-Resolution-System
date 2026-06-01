import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test('citizen logout redirects to login page', async ({ page }) => {
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
