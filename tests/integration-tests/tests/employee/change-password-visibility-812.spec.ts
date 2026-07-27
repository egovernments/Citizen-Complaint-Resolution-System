import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { loginViaApi } from '../utils/auth';

const PROFILE_URL = '/digit-ui/employee/user/profile';

test.describe('employee profile — change password button visibility #812', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Change Password button styling check', { tag: ['@persona:employee'] }, async ({ page }) => {
    page.on('request', (req) => {
      console.log(`[REQUEST] ${req.method()} ${req.url()}`);
    });
    page.on('response', (res) => {
      if (res.url().includes('tailwind.css')) {
        console.log(`[TAILWIND RESPONSE] ${res.status()} ${res.url()}`);
      }
      if (res.status() >= 400) {
        console.log(`[RESPONSE ERROR] ${res.status()} ${res.url()}`);
      }
    });

    // ============ Auth ============
    // Inject an employee session (ADMIN — always present at the root tenant
    // post-bootstrap) via the tenant-agnostic loginViaApi helper rather than
    // walking the login form. This spec checks the Change Password button's
    // styling on the profile page, not the login surface; the form's City
    // picker renders the tenant's short name rather than the configured
    // display label on deployments whose tenant-name localization is
    // unseeded, which made the form-driven variant hang.
    await loginViaApi(page, {
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

    // ============ Navigate to Edit Profile ============
    await page.goto(`${BASE_URL}${PROFILE_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4_500);

    // Wait for Change Password header to be visible so we know page loaded
    const changePasswordHeading = page.locator('h2:has-text("Change password")').first();
    await expect(changePasswordHeading).toBeVisible({ timeout: 15_000 });

    // Locate the "Change password" button
    const changePasswordBtn = page.locator('button:has-text("Change password")').first();
    await expect(changePasswordBtn).toBeVisible({ timeout: 5_000 });

    const classAttr = await changePasswordBtn.getAttribute('class');
    console.log("CHANGE_PASSWORD_BUTTON_CLASSES:", classAttr);

    // Print computed --v2-muted variable value
    const v2MutedVal = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).getPropertyValue('--v2-muted');
    });
    console.log("COMPUTED_V2_MUTED_VAR:", v2MutedVal);

    // Print computed styles
    const styles = await changePasswordBtn.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        backgroundColor: s.backgroundColor,
        border: s.border,
        borderColor: s.borderColor,
        boxShadow: s.boxShadow,
        color: s.color,
        padding: s.padding,
        borderRadius: s.borderRadius
      };
    });
    console.log("CHANGE_PASSWORD_BUTTON_STYLES:", JSON.stringify(styles, null, 2));

    // Assert that the button is styled like a primary/secondary button, and not a plain text / transparent link.
    // e.g. should have a background color different from white (rgb(255, 255, 255)) or transparent (rgba(0, 0, 0, 0)),
    // OR should have a visible border, etc.
    // Let's assert something that fails for plain text but passes for a clearly visible button.
    expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles.backgroundColor).not.toBe('rgb(255, 255, 255)');
  });
});
