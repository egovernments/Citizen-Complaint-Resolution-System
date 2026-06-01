/**
 * PGR Dashboard E2E
 *
 * Verifies the Chart.js-based PGR analytics dashboard loads correctly:
 *   1. Login via API session injection
 *   2. Navigate to /manage/pgr-dashboard
 *   3. Verify overview card renders with 3 KPIs
 *   4. Verify all chart canvases render
 *   5. Verify chart section titles
 *   6. Verify sidebar nav link is present
 *   7. Verify breakdown table with tabs
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../utils/configurator-auth';

test.describe('PGR Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginConfigurator(page);
  });

  test('dashboard page loads with heading', async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 10_000 });
    await expect(heading).toContainText('PGR Dashboard');
  });

  test('overview card shows 3 KPI metrics', async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    const expectedKpis = [
      'Total Complaints',
      'Closed Complaints',
      'Completion Rate',
    ];

    for (const kpi of expectedKpis) {
      await expect(page.locator(`text=${kpi}`).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test('all chart canvases render', async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for Chart.js to render canvases
    await page.waitForSelector('canvas', { timeout: 10_000 });
    await page.waitForTimeout(1_000); // Let animations complete

    // Expect 8 charts:
    // 1. Cumulative Closed (line)
    // 2. By Source (line)
    // 3. Complaints Status (stacked bar)
    // 4. By Status (doughnut)
    // 5. By Channel (doughnut)
    // 6. By Department (doughnut)
    // 7. Citizens (line)
    // 8. Top Complaints (horizontal bar)
    const canvases = page.locator('canvas');
    await expect(canvases).toHaveCount(8, { timeout: 10_000 });
  });

  test('chart section titles are visible', async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    const expectedTitles = [
      'DSS Overview',
      'Cumulative Closed Complaints',
      'Complaints by Source',
      'Complaints Status',
      'By Status',
      'By Channel',
      'By Department',
      'Citizens',
      'Top Complaints',
    ];

    for (const title of expectedTitles) {
      await expect(page.locator(`text=${title}`).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test('sidebar has PGR Dashboard nav link', async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // The sidebar should have a "PGR Dashboard" button with active styling
    const navLink = page.locator('button', { hasText: 'PGR Dashboard' });
    await expect(navLink).toBeVisible({ timeout: 5_000 });

    // Should have active state (primary color class)
    await expect(navLink).toHaveClass(/bg-primary/);
  });

  test('KPI values show numbers', async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Each KPI value should contain a number or percentage
    const kpiValues = page.locator('.text-3xl.font-bold');
    const count = await kpiValues.count();
    expect(count).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i++) {
      const text = await kpiValues.nth(i).innerText();
      expect(text).toMatch(/[\d,.]+/);
    }
  });

  test('breakdown table with 4 tabs', async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Should show "Status by Tenant" section
    await expect(page.locator('text=Status by Tenant').first()).toBeVisible({ timeout: 5_000 });

    // 4 tab triggers should be present
    const tabs = ['Boundary', 'Department', 'Complaint Type', 'Channel'];
    for (const tab of tabs) {
      await expect(page.locator(`[role="tab"]:has-text("${tab}")`)).toBeVisible({ timeout: 5_000 });
    }

    // Default tab (Boundary) should show a table
    await expect(page.locator('table').first()).toBeVisible({ timeout: 5_000 });

    // Click Department tab and verify table updates
    await page.locator('[role="tab"]:has-text("Department")').click();
    await expect(page.locator('[role="tabpanel"] table').first()).toBeVisible({ timeout: 5_000 });
  });
});
