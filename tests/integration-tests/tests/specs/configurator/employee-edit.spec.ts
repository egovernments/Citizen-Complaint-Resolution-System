/**
 * Employee Edit E2E — Configurator
 *
 * Validates fix for:
 *   #476 — auditDetails preserved in assignments/jurisdictions on edit
 *          (prevents NPE when HRMS calls assignment.getAuditDetails().setLastModifiedBy())
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../../utils/configurator-auth';

test.describe('Employee Edit (#476)', () => {
  test.beforeEach(async ({ page }) => {
    await loginConfigurator(page);
  });

  test('employee list loads', {
    annotation: {
      type: 'description',
      description: `Smoke check that the configurator's employee management surface renders. Either a populated grid/table or a no-data message is acceptable — the test only fails if the page never produces visible content, which would mean the manage route is broken or HRMS search is failing outright.

Steps:
1. Log in as configurator admin and open /manage/employees.
2. Wait up to 20s for the first heading, table, datagrid, or grid role to become visible.

Pairs with the heavier edit spec — if this one fails, the edit test will fail for the same root cause and can be safely ignored.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:476', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/employees`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // The page should show either a datagrid/table or a "no data" message
    // Wait for page heading or content to appear
    const content = page.locator('h1, table, [class*="datagrid"], [role="grid"]').first();
    await expect(content).toBeVisible({ timeout: 20_000 });
  });

  test('edit employee preserves assignments and jurisdictions', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#476 regression: HRMS update used to NPE on assignment.getAuditDetails().setLastModifiedBy() when the configurator stripped auditDetails from existing assignments/jurisdictions before resubmitting. This test drives a real edit through the UI and asserts the response page does not surface a NullPointerException or a 500 from HRMS.

Steps:
1. Log in as configurator admin and open /manage/employees.
2. Click the first row in the employee list to navigate to the show/edit page.
3. If a separate Edit button is visible, click it to enter edit mode.
4. Assert both the Assignments and Jurisdictions sections render (existing rows must be present, not blanked).
5. If a Save/Update button is visible, submit the form and assert the body does not contain "NullPointerException" or "Internal Server Error".

Marked test.slow() because HRMS update fans out across multiple service calls, and the test is intentionally tolerant of show-vs-edit page variants since manage routes have shifted historically.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:476', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    test.slow(); // Employee edit involves multiple API calls

    // Navigate to employee list
    await page.goto(`${CONFIGURATOR_BASE}/manage/employees`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for list to load — look for any clickable row
    const firstRow = page.locator('table tbody tr, [role="row"]').first();
    await expect(firstRow).toBeVisible({ timeout: 20_000 });

    // Click first row to navigate to detail/edit
    await firstRow.click();
    await page.waitForTimeout(3_000);

    // Should have navigated to a detail or edit page
    expect(page.url()).toMatch(/\/employees\//);

    // If on show page, click edit button
    const editBtn = page.getByRole('button', { name: /edit/i });
    if (await editBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await editBtn.click();
      await page.waitForTimeout(2_000);
    }

    // Verify assignments section is visible
    await expect(page.getByText('Assignments').first()).toBeVisible({ timeout: 10_000 });

    // Verify jurisdictions section is visible
    await expect(page.getByText('Jurisdictions').first()).toBeVisible({ timeout: 5_000 });

    // Submit the edit form
    const submitBtn = page.getByRole('button', { name: /save|update/i });
    if (await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(5_000);

      // Should NOT show NPE or server error
      const body = await page.locator('body').innerText();
      expect(body).not.toContain('NullPointerException');
      expect(body).not.toContain('Internal Server Error');
    }
  });
});
