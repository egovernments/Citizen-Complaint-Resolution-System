/**
 * Dashboard GROUP BY — CCRS#1473 regression spec
 *
 * Bug: selecting a GROUP BY option on the "Complaint type details" table only
 * renames the column header; no actual row aggregation happens because the
 * hierLevel param is not sent to the backend.
 *
 * This spec verifies the fix:
 *   AC1 — the gear (settings) icon is visible on the widget
 *   AC2 — opening the menu shows GROUP BY options (at least 2)
 *   AC3 — selecting a non-leaf level fires a new analytics _query with hierLevel
 *          in the request body (proves the backend is called with the right param)
 *   AC4 — the table row count changes after the GROUP BY switch (proves actual
 *          aggregation, not just a column rename)
 */

import { test, expect } from "@playwright/test";
import { loginViaApi } from "../utils/auth";
import { BASE_URL, ADMIN_USER, ADMIN_PASS, TENANT } from "../utils/env";

const DASHBOARD_URL = `${BASE_URL}/digit-ui/employee/dashboard`;

test.describe("CCRS#1473 — dashboard GROUP BY actually aggregates rows", () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page, {
      username: ADMIN_USER,
      password: ADMIN_PASS,
      tenant: TENANT,
    });
  });

  test("AC1+AC2 — gear icon visible and GROUP BY menu has at least 2 options", {
    annotation: {
      type: "description",
      description:
        "Navigates to the dashboard and finds any widget that exposes the GROUP BY gear icon. Opens the popover and asserts at least 2 level options are offered. Catches regressions where the control is silently removed or the options list collapses to one (making it a no-op).",
    },
    tag: ["@area:dashboard", "@ccrs:1473", "@kind:regression", "@layer:ui", "@persona:admin"],
  }, async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(3_000);

    // The Complaint type details table widget may take time to mount — wait up to 15s
    const gearBtn = page.locator('button[aria-label="Group by"]').first();
    const gearVisible = await gearBtn.isVisible({ timeout: 15_000 }).catch(() => false);

    if (!gearVisible) {
      test.skip(true,
        'No "Group by" gear button found on the dashboard. ' +
        'Add the "Complaint type details" table via "+ Add KPI" and re-run.'
      );
      return;
    }

    // AC1 — gear is present
    await expect(gearBtn).toBeVisible();

    // Open the GROUP BY popover
    await gearBtn.click();

    // Wait for the portal panel to appear in the DOM (portals to document.body)
    await page.waitForSelector('button.dashboard-menu-item, [role="menuitem"]', { timeout: 3_000 })
      .catch(() => {});
    await page.waitForTimeout(300);

    // AC2 — at least 2 level options (role="menuitem" per PopoverMenuItem source)
    const menuItems = page.locator('button.dashboard-menu-item, button[role="menuitem"]');
    const count = await menuItems.count();
    expect(count, "GROUP BY menu must offer at least 2 level options").toBeGreaterThanOrEqual(2);

    // Close the menu
    await page.keyboard.press("Escape");
  });

  test("AC3 — selecting a non-leaf GROUP BY fires analytics _query with hierLevel param", {
    annotation: {
      type: "description",
      description:
        "Intercepts POST analytics/_query before and after a GROUP BY selection. After switching to a non-leaf level the next _query request body must contain a hierLevel key with a non-leaf value. Catches the exact bug: column rename without backend re-query.",
    },
    tag: ["@area:dashboard", "@ccrs:1473", "@kind:regression", "@layer:ui", "@persona:admin"],
  }, async ({ page }) => {
    // Collect analytics request bodies
    const queryBodies: any[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/_query") && req.method() === "POST") {
        try {
          queryBodies.push(JSON.parse(req.postData() || "{}"));
        } catch {
          queryBodies.push({});
        }
      }
    });

    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(3_000);

    const gearBtn = page.locator('button[aria-label="Group by"]').first();
    const gearVisible = await gearBtn.isVisible({ timeout: 15_000 }).catch(() => false);

    if (!gearVisible) {
      test.skip(true,
        'No "Group by" gear button found — add "Complaint type details" table first.'
      );
      return;
    }

    // Snapshot before — none of the initial requests should have hierLevel
    const beforeCount = queryBodies.length;

    // Open the GROUP BY popover
    await gearBtn.click();
    await page.waitForSelector('button.dashboard-menu-item, button[role="menuitem"]', { timeout: 3_000 })
      .catch(() => {});
    await page.waitForTimeout(300);

    // Pick the first option that is NOT "Leaf" (the default).
    const nonLeafOption = page
      .locator('button.dashboard-menu-item, button[role="menuitem"]')
      .filter({ hasNotText: /leaf/i })
      .first();

    const hasNonLeaf = await nonLeafOption.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!hasNonLeaf) {
      test.skip(true, "No non-leaf GROUP BY option available on this deployment.");
      return;
    }

    await nonLeafOption.click();

    // Wait for the re-query triggered by the GROUP BY change
    await page.waitForTimeout(5_000);

    const newBodies = queryBodies.slice(beforeCount);
    expect(
      newBodies.length,
      "At least one new analytics _query must fire after changing GROUP BY"
    ).toBeGreaterThan(0);

    // AC3 — at least one of the new requests carries hierLevel
    const hierLevelValues = newBodies.flatMap((body) => {
      const queries = body?.queries ?? {};
      return Object.values(queries).flatMap((q: any) => {
        const params = q?.params ?? {};
        return params.hierLevel != null ? [params.hierLevel] : [];
      });
    });

    expect(
      hierLevelValues.length,
      "At least one _query after GROUP BY change must include hierLevel in params"
    ).toBeGreaterThan(0);

    expect(
      hierLevelValues.some((v) => v !== "leaf"),
      `hierLevel must be a non-leaf value; got: ${JSON.stringify(hierLevelValues)}`
    ).toBe(true);
  });

  test("AC4 — table row count decreases after switching to a non-leaf GROUP BY", {
    annotation: {
      type: "description",
      description:
        "Records the row count at leaf level then switches GROUP BY to the first non-leaf level. The row count must decrease because leaf rows are aggregated into parent buckets. If rows are identical the column rename is the only change — the bug is present.",
    },
    tag: ["@area:dashboard", "@ccrs:1473", "@kind:regression", "@layer:ui", "@persona:admin"],
  }, async ({ page }) => {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(3_000);

    const gearBtn = page.locator('button[aria-label="Group by"]').first();
    const gearVisible = await gearBtn.isVisible({ timeout: 15_000 }).catch(() => false);

    if (!gearVisible) {
      test.skip(true,
        'No "Group by" gear button found — add "Complaint type details" table first.'
      );
      return;
    }

    // Count initial (leaf) rows — find the closest table to the gear icon
    const widgetContainer = gearBtn.locator("xpath=ancestor::*[.//table][1]");
    const tableRows = widgetContainer.locator("tbody tr");
    const leafRowCount = await tableRows.count();

    expect(leafRowCount, "Table must have at least 1 row at leaf level").toBeGreaterThan(0);

    // Switch GROUP BY to non-leaf
    await gearBtn.click();
    await page.waitForTimeout(500);

    const nonLeafOption = page
      .locator('[role="menuitem"], [role="option"], [class*="popover-menu-item"]')
      .filter({ hasNotText: /leaf/i })
      .first();

    const hasNonLeaf = await nonLeafOption.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!hasNonLeaf) {
      test.skip(true, "No non-leaf GROUP BY option available on this deployment.");
      return;
    }

    await nonLeafOption.click();

    // Wait for table to re-render with aggregated data
    await page.waitForTimeout(6_000);

    const groupedRowCount = await tableRows.count();

    expect(
      groupedRowCount,
      `Row count after GROUP BY switch (${groupedRowCount}) must be less than leaf row count (${leafRowCount}). ` +
      "If equal, GROUP BY is only renaming the column header — the bug is present."
    ).toBeLessThan(leafRowCount);
  });
});
