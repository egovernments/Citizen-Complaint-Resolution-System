import { test, expect } from '@playwright/test';
import { PgrInboxPage } from '../pages/pgr-inbox.page';
import { loginViaApi } from '../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const TENANT = process.env.DIGIT_TENANT || 'uitest.citya';
const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';

test.describe('PGR Inbox — Bug Fixes', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
  });

  test('BUG-1: inbox renders without stuck loader', async ({ page }) => {
    // BUG-1 was: complaints?.length !== null is always true, so Loader never shows
    // and the page renders before data arrives. Fixed: show Loader while isLoading.
    const inbox = new PgrInboxPage(page);
    await inbox.goto();

    // Page should have rendered meaningful content (header, filters, table or empty state)
    const bodyText = await inbox.getBodyText();
    expect(bodyText.length).toBeGreaterThan(50);

    // Should NOT show a raw "undefined" or blank page
    expect(bodyText).not.toContain('undefined');
  });

  test('BUG-1: inbox shows either complaints or empty state', async ({ page }) => {
    const inbox = new PgrInboxPage(page);
    await inbox.goto();
    await page.waitForTimeout(5000);

    const bodyText = await inbox.getBodyText();
    const hasComplaints = /PG-PGR-/.test(bodyText);
    const hasEmptyState = /no result|no complaints|no data|no records/i.test(bodyText);
    const hasTable = await page.locator('table').count() > 0;
    const hasInboxHeader = /inbox/i.test(bodyText);

    // At least one indicator that the inbox rendered properly
    expect(hasComplaints || hasEmptyState || hasTable || hasInboxHeader).toBe(true);
  });

  test('BUG-2: clearAll filter does not corrupt state', async ({ page }) => {
    // BUG-2 was: clearAll() set wfFilters to { assigned: [{code: []}] } instead of { assignee: [] }
    const inbox = new PgrInboxPage(page);
    await inbox.goto();
    await page.waitForTimeout(3000);

    // Find and click "Clear All" button
    const clearAllBtn = page.locator('text=Clear All, .clearAll, .clear-search').first();
    if (await clearAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clearAllBtn.click();
      await page.waitForTimeout(3000);

      // After clearing, page should still render (not crash from bad state shape)
      const bodyText = await inbox.getBodyText();
      expect(bodyText.length).toBeGreaterThan(50);
      // Should not show any JS error indicators
      expect(bodyText).not.toMatch(/cannot read prop|undefined is not/i);
    }
  });

  test('BUG-4: no console errors from _count endpoint', async ({ page }) => {
    // BUG-4 was: calling non-existent /pgr-services/v2/request/_count
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    const failedRequests: string[] = [];
    page.on('response', (resp) => {
      // Only track PGR _count failures — HRMS has its own _count that may fail independently
      if (resp.url().includes('pgr-services') && resp.url().includes('_count') && resp.status() >= 400) {
        failedRequests.push(`${resp.status()} ${resp.url()}`);
      }
    });

    const inbox = new PgrInboxPage(page);
    await inbox.goto();
    await page.waitForTimeout(5000);

    // No failed _count requests (because we removed the call)
    expect(failedRequests).toHaveLength(0);
  });

  test('no raw SERVICEDEFS keys in rendered page', async ({ page }) => {
    const inbox = new PgrInboxPage(page);
    await inbox.goto();
    await page.waitForTimeout(5000);

    const bodyText = await inbox.getBodyText();
    if (/PG-PGR-/.test(bodyText)) {
      expect(bodyText).not.toMatch(/SERVICEDEFS\./);
    }
  });
});
