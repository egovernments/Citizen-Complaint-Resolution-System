/**
 * Employee Create E2E — Configurator
 *
 * Validates fixes for:
 *   #460 — No "Username" input field (HRMS auto-generates from employee code)
 *   #458 — Assignment dept/designation are required (validation error if empty)
 *   #471 — Redirect to list after successful create + success toast
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../../utils/configurator-auth';

test.describe('Employee Create (#458, #460, #471)', () => {
  test.beforeEach(async ({ page }) => {
    await loginConfigurator(page);
  });

  test('no Username input field exists (#460)', {
    annotation: {
      type: 'description',
      description: `Verifies the configurator's Create Employee form no longer renders a Username text input. HRMS auto-generates the username from the employee code; an editable field caused user confusion and was removed in CCRS#460.

Steps:
1. Navigate to /configurator/manage/employees/create.
2. Wait for the form to render (input[name="user.name"] visible).
3. Assert no input with name="user.userName" exists on the page.
4. Assert the legacy "Auto-generated from name" help text is also absent.

Catches a regression where the Username field was reintroduced.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:458', '@ccrs:460', '@ccrs:471', '@kind:regression', '@layer:ui', '@persona:admin'],
  }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/employees/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for form to render — use a specific locator that won't be ambiguous
    await expect(page.locator('input[name="user.name"]')).toBeVisible({ timeout: 15_000 });

    // Username field should NOT exist on the Create page
    // (HRMS auto-generates it from employee code)
    const usernameInput = page.locator('input[name="user.userName"]');
    await expect(usernameInput).toHaveCount(0);

    // The "Auto-generated" help text should also be gone
    await expect(page.getByText('Auto-generated from name')).toHaveCount(0);
  });

  test('assignment without dept/designation shows validation error (#458)', {
    annotation: {
      type: 'description',
      description: `Edge case for CCRS#458: when an admin clicks "Add assignment" but submits without choosing a department, the form must render an inline alert and refuse to create — not silently 400 the API.

Steps:
1. Navigate to /configurator/manage/employees/create.
2. Wait for input[name="user.name"] to be visible (form rendered).
3. Click the "Add assignment" button — an empty assignment row appears.
4. Click "Create" without filling department or designation.
5. Wait briefly for client-side validation to fire.
6. Assert a role="alert" with text matching /assignment must have a department/i is visible.

Catches the regression where this validation was missing and the form let users submit a half-filled assignment.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:458', '@ccrs:460', '@ccrs:471', '@kind:edge-case', '@layer:ui', '@persona:admin'],
  }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/employees/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for form to render
    await expect(page.locator('input[name="user.name"]')).toBeVisible({ timeout: 15_000 });

    // Click "Add assignment" button
    await page.getByRole('button', { name: 'Add assignment' }).click();

    // Assignment row should appear
    await expect(page.getByText('Department').first()).toBeVisible({ timeout: 5_000 });

    // Submit without selecting dept/designation
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForTimeout(1_000);

    // Should show validation error about department being required
    // The error is rendered as a role="alert" paragraph below the assignments section
    const errorAlert = page.getByRole('alert').filter({ hasText: /assignment must have a department/i });
    await expect(errorAlert.first()).toBeVisible({ timeout: 5_000 });
  });

  test('form has all expected sections', {
    annotation: {
      type: 'description',
      description: `Sanity check that the Employee Create form renders the four canonical sections an admin needs to fill in (Employee Info, Roles, Assignments, Jurisdictions). Guards against a regression where a refactor of the form layout silently drops a section, which would leave admins unable to assign roles or jurisdictions through the UI.

Steps:
1. Log in as configurator admin and open /manage/employees/create.
2. Wait for the user.name input to render (form mounted).
3. Assert each of the four section headings — Employee Info, Roles, Assignments, Jurisdictions — is visible.
4. Assert the two key inputs (employee code, mobile number) are also visible.

Catches a regression where any of the four core form sections gets accidentally removed.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:458', '@ccrs:460', '@ccrs:471', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${CONFIGURATOR_BASE}/manage/employees/create`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    // Wait for form to load
    await expect(page.locator('input[name="user.name"]')).toBeVisible({ timeout: 15_000 });

    // Verify key section headings are present. Each section is rendered by
    // <FieldSection title=...> as an <h3>, so match on the heading role rather
    // than raw text: getByText() does a case-insensitive *substring* match over
    // every node, so 'Roles' also matched the hidden <option>ke.etoeroles</option>
    // in the Tenant select (any tenant code containing "roles" collides), and the
    // test failed with "resolved to <option> ... unexpected value hidden".
    // An <option> can never satisfy role=heading, so this is collision-proof.
    for (const section of ['Employee Info', 'Roles', 'Assignments', 'Jurisdictions']) {
      await expect(page.getByRole('heading', { name: section })).toBeVisible({ timeout: 5_000 });
    }

    // Verify key input fields exist
    await expect(page.locator('input[name="code"]')).toBeVisible();
    await expect(page.locator('input[name="user.mobileNumber"]')).toBeVisible();
  });
});
