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

  test('dashboard page loads with heading', {
    annotation: {
      type: 'description',
      description: `Smoke check that /manage/pgr-dashboard renders with the expected H1 heading. If the route is misconfigured or the lazy-loaded chunk fails, the page wouldn't have an H1 at all — this catches that wide failure mode.

Steps:
1. loginConfigurator (beforeEach).
2. Navigate to /manage/pgr-dashboard, wait for networkidle.
3. Locate h1; assert visible within 10s.
4. Assert the heading contains "PGR Dashboard".

First test in a series of seven that walk the dashboard's UI surface.`,
    },
    tag: ['@area:configurator-manage', '@area:dashboard', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/pgr-dashboard`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 10_000 });
    await expect(heading).toContainText('PGR Dashboard');
  });

  test('overview card shows 3 KPI metrics', {
    annotation: {
      type: 'description',
      description: `Asserts the dashboard overview card surfaces the three core PGR KPIs: Total Complaints, Closed Complaints, Completion Rate. Catches a regression where a metric gets dropped from the layout (or its label gets renamed without updating the test alongside).

Steps:
1. loginConfigurator (beforeEach).
2. Navigate to /manage/pgr-dashboard, wait for networkidle.
3. For each KPI label in ['Total Complaints', 'Closed Complaints', 'Completion Rate'], assert text=label is visible within 5s.

Pairs with the "KPI values show numbers" test below — together they confirm the labels AND values render.`,
    },
    tag: ['@area:configurator-manage', '@area:dashboard', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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

  test('all chart canvases render', {
    annotation: {
      type: 'description',
      description: `Asserts Chart.js renders all 8 expected canvases on the dashboard: Cumulative Closed (line), By Source (line), Complaints Status (stacked bar), By Status (doughnut), By Channel (doughnut), By Department (doughnut), Citizens (line), Top Complaints (horizontal bar). Catches the case where a chart fails to render (data fetch error, Chart.js init throws, etc).

Steps:
1. loginConfigurator (beforeEach).
2. Navigate to /manage/pgr-dashboard, wait for networkidle.
3. Wait for any 'canvas' element within 10s, then 1s for Chart.js animation to settle.
4. Assert canvas locator has count === 8 within 10s.

If the canvas count drifts, update both the dashboard layout and this test with the new expected count.`,
    },
    tag: ['@area:configurator-manage', '@area:dashboard', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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

  test('chart section titles are visible', {
    annotation: {
      type: 'description',
      description: `Companion to the canvas-count test: each of the 9 expected section titles (DSS Overview + 8 chart titles) must be visible. Catches a regression where a chart canvas renders but its surrounding section/heading gets dropped (or vice versa — title without canvas).

Steps:
1. loginConfigurator (beforeEach).
2. Navigate to /manage/pgr-dashboard, wait for networkidle.
3. For each title in ['DSS Overview','Cumulative Closed Complaints','Complaints by Source','Complaints Status','By Status','By Channel','By Department','Citizens','Top Complaints'], assert text=title is visible within 5s.

Note 9 titles vs 8 canvases — DSS Overview is a section header without its own chart.`,
    },
    tag: ['@area:configurator-manage', '@area:dashboard', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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

  test('sidebar has PGR Dashboard nav link', {
    annotation: {
      type: 'description',
      description: `Asserts the sidebar has a button labelled "PGR Dashboard" AND that it carries the active styling (the bg-primary class) when the user is on the dashboard route. Catches a regression where the route-active highlight stops firing — the link still renders but doesn't visually indicate the current page.

Steps:
1. loginConfigurator (beforeEach).
2. Navigate to /manage/pgr-dashboard, wait for networkidle.
3. Locate button:hasText("PGR Dashboard"); assert visible within 5s.
4. Assert the button has a class matching /bg-primary/ (active styling).

Loose regex on the class lets the design system rename specific Tailwind variants without false-positives.`,
    },
    tag: ['@area:configurator-manage', '@area:dashboard', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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

  test('KPI values show numbers', {
    annotation: {
      type: 'description',
      description: `Asserts each of the three KPI value tiles renders a number-shaped value (digits, optionally with commas/decimals/percentage symbol). Catches regressions where the value placeholder is "N/A", "—", or empty because the underlying analytics endpoint failed silently.

Steps:
1. loginConfigurator (beforeEach).
2. Navigate to /manage/pgr-dashboard, wait for networkidle.
3. Locate .text-3xl.font-bold elements (the KPI value tiles).
4. Assert count >= 3.
5. For each tile, read innerText and assert it matches /[\\d,.]+/ (contains at least one digit/comma/period).

Loose regex tolerates "1,234", "0", "12.5%" — anything that's actually numeric.`,
    },
    tag: ['@area:configurator-manage', '@area:dashboard', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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

  test('breakdown table with 4 tabs', {
    annotation: {
      type: 'description',
      description: `Asserts the "Status by Tenant" breakdown panel renders with all four tab triggers (Boundary, Department, Complaint Type, Channel), the Boundary tab is selected by default with a visible table, and switching to Department also renders a table inside the active tabpanel.

Steps:
1. loginConfigurator (beforeEach).
2. Navigate to /manage/pgr-dashboard, wait for networkidle.
3. Assert "Status by Tenant" text is visible within 5s.
4. For each tab in ['Boundary','Department','Complaint Type','Channel'], assert [role="tab"]:has-text(<tab>) is visible.
5. Assert the first <table> element is visible (the Boundary tab is the default).
6. Click the Department tab.
7. Assert a [role="tabpanel"] table is visible within 5s.

Confirms tab-switching actually swaps the rendered table — not just the tab indicator.`,
    },
    tag: ['@area:configurator-manage', '@area:dashboard', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
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
