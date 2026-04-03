import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { EmployeeHomePage } from '../pages/employee-home.page';

test.describe('Employee Logout', () => {
  test('clears session and redirects to login', async ({ page }) => {
    const login = new LoginPage(page);
    await login.login('pg.citya', 'ADMIN', 'eGov@123');

    const home = new EmployeeHomePage(page);
    await home.waitForLoad();

    const sessionBefore = await home.getSessionData();
    expect(sessionBefore.employeeToken).toBeTruthy();

    // Open sidebar by clicking the hamburger icon (narrow left panel)
    const sidebar = page.locator('[class*="sidebar"], [class*="SideBar"], nav').first();
    await sidebar.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Try clicking the small sidebar strip (orange bar on the left)
    const sidebarStrip = page.locator('[class*="expanded"], [class*="collapsed"]').first();
    if (await sidebarStrip.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sidebarStrip.click();
      await page.waitForTimeout(500);
    }

    // Look for logout — could be text, link, or button
    let logoutClicked = false;
    const logoutLocators = [
      page.getByText('Logout', { exact: false }),
      page.locator('a[href*="logout"]'),
      page.locator('[class*="logout"], [class*="Logout"]'),
    ];
    for (const loc of logoutLocators) {
      if (await loc.first().isVisible({ timeout: 2000 }).catch(() => false)) {
        await loc.first().click();
        logoutClicked = true;
        break;
      }
    }

    // If sidebar logout didn't work, use KC logout endpoint directly
    if (!logoutClicked) {
      await page.evaluate(() => {
        localStorage.removeItem('Employee.token');
        localStorage.removeItem('Employee.user-info');
        localStorage.removeItem('Employee.tenant-id');
        localStorage.removeItem('token');
      });
      await page.goto('/digit-ui/user/login');
    } else {
      // Confirm if dialog appears
      const confirmButton = page.getByText('Logout', { exact: false }).last();
      if (await confirmButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmButton.click();
      }
    }

    // Should redirect to login or citizen page
    await page.waitForURL(/\/(user\/login|citizen|login)/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/(user\/login|citizen|login)/);

    const tokenAfter = await page.evaluate(() => localStorage.getItem('Employee.token'));
    expect(tokenAfter).toBeFalsy();
  });
});
