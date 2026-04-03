import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { EmployeeHomePage } from '../pages/employee-home.page';
import { PgrInboxPage } from '../pages/pgr-inbox.page';

test.describe('PGR Inbox', () => {
  test.beforeEach(async ({ page }) => {
    const login = new LoginPage(page);
    await login.login('pg.citya', 'ADMIN', 'eGov@123');
    const home = new EmployeeHomePage(page);
    await home.waitForLoad();
  });

  test('navigates to inbox and renders', async ({ page }) => {
    const inbox = new PgrInboxPage(page);
    await inbox.goto();

    expect(page.url()).toContain('/pgr/inbox');
    const bodyText = await inbox.getBodyText();
    expect(bodyText.length).toBeGreaterThan(50);
  });

  test('displays data or empty state', async ({ page }) => {
    const inbox = new PgrInboxPage(page);
    await inbox.goto();

    const bodyText = await inbox.getBodyText();
    const hasComplaints = /PG-PGR-/.test(bodyText);
    const hasEmptyState = /no result|no complaints|no data/i.test(bodyText);
    const hasTableOrCards = await page.locator('table, [class*="card"], [class*="Card"]').count() > 0;

    expect(hasComplaints || hasEmptyState || hasTableOrCards).toBe(true);
  });

  test('no raw SERVICEDEFS keys in rendered page', async ({ page }) => {
    const inbox = new PgrInboxPage(page);
    await inbox.goto();

    const bodyText = await inbox.getBodyText();
    if (/PG-PGR-/.test(bodyText)) {
      expect(bodyText).not.toMatch(/SERVICEDEFS\./);
    }
  });
});
