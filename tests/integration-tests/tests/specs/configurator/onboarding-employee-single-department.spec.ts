/**
 * Onboarding Add employee takes one department (#2649).
 *
 * HRMS keeps exactly one current assignment per employee, so the Add dialog
 * in the onboarding Employees step offers a single Department select, the same
 * as Edit, and sends one department. It used to offer checkboxes and store each
 * extra department as a one-day past assignment.
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../../utils/configurator-auth';
import { ROOT_TENANT } from '../../utils/env';
import { getMobileValidationRule, generateValidMobile } from '../../utils/mdms-mobile';
import { employeeSearch, loadAuth } from '../../utils/manage/api';

test.describe('Onboarding Add employee (#2649)', () => {
  test.beforeEach(async ({ page }) => {
    await loginConfigurator(page);
  });

  test('Add shows a single Department select and saves exactly one assignment', {
    annotation: {
      type: 'description',
      description: `CCRS#2649: the onboarding Employees step's Add dialog used to list Departments as checkboxes while Edit used a single select. HRMS allows one current assignment, so every extra department ticked on Add was stored as a one-day past assignment. Add now has the same single Department select as Edit and sends one department.

Steps:
1. Log in as configurator admin and open /configurator/onboarding/employees.
2. Click "Add employee" and assert the dialog has a Department combobox and no "Departments" checkbox group.
3. Fill a unique employee, choose the first department and designation, tick the first jurisdiction and submit.
4. Read the employee back from HRMS and assert it has exactly one assignment, and that it is current.

Needs a workspace with at least one department, designation and boundary. The employee is left in place (HRMS has no delete).`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:2649', '@kind:regression', '@layer:ui', '@persona:admin'],
  }, async ({ page }) => {
    test.slow();
    const rule = await getMobileValidationRule(ROOT_TENANT);
    const code = `E2E${Date.now().toString().slice(-8)}`;

    await page.goto(`${CONFIGURATOR_BASE}/onboarding/employees`, { waitUntil: 'networkidle', timeout: 30_000 });
    const add = page.getByRole('button', { name: /^Add employee$/ }).first();
    // Once setup is finished the route shows the manage console, which has no onboarding Add dialog.
    const available = await add.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    test.skip(!available, 'workspace setup already complete; the onboarding Add dialog is unavailable');
    await add.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // One select, no checkbox group: Add matches Edit.
    const department = dialog.getByRole('combobox', { name: /^Department/ });
    await expect(department).toBeVisible();
    await expect(dialog.getByRole('group', { name: /^Departments/ })).toHaveCount(0);
    await expect(dialog.getByText(/Choose one or more/i)).toHaveCount(0);

    await dialog.getByLabel(/^Employee code/).fill(code);
    await dialog.getByLabel(/^Full name/).fill(`E2E Single Department ${code}`);
    await dialog.getByLabel(/^Mobile number/).fill(generateValidMobile(rule));
    await dialog.getByLabel(/^Email/).fill(`${code.toLowerCase()}@example.org`);

    await department.click();
    await page.getByRole('option').first().click();
    await dialog.getByRole('combobox', { name: /^Designation/ }).click();
    await page.getByRole('option').first().click();
    await dialog.getByRole('group', { name: /^Jurisdictions/ }).getByRole('checkbox').first().check();

    await dialog.getByRole('button', { name: /^Add employee$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const employees = await employeeSearch(loadAuth(), ROOT_TENANT, { limit: 500 });
    const saved = employees.find((e) => e.code === code) as { assignments?: { isCurrentAssignment?: boolean }[] } | undefined;
    expect(saved, `employee ${code} should be in HRMS`).toBeTruthy();
    expect(saved!.assignments).toHaveLength(1);
    expect(saved!.assignments![0].isCurrentAssignment).toBe(true);
  });
});
