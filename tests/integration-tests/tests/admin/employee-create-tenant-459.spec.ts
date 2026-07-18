/**
 * Admin — employee create on the form's selected tenant (CCRS #459 + #471 + #476).
 *
 * Three claims about the post-submit state:
 *   #459 — employees/_search post-create returns tenantId matching the
 *          form's Tenant field (not the upstream default).
 *   #471 — form clears after successful create: URL leaves /create AND
 *          the form input unmounts.
 *   #476 (create half) — enrichCreateRequest path is NPE-free on null
 *          AuditDetails (proven by the 2xx + post-create state walk).
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS, generateEmployeePhone } from '../utils/env';

const EMPLOYEES_URL = '/configurator/manage/employees';

test.describe('admin employee create — tenant + form-clears #459 #471 #476', () => {
  test('fills the create form and submits — tenant correct + form clears', { tag: ['@persona:admin'] }, async ({ page }) => {
    // Onboarding-data gap: this walk creates an employee AT THE ROOT (state)
    // tenant, whose jurisdiction picker needs leaf boundaries. Stock state
    // tenants carry no leaf boundaries (they live under the city sub-tenant),
    // so the "Select boundary" combobox is empty and the form can't be
    // completed. Left skipped rather than faked — re-enable on deployments
    // where the root tenant has a populated boundary tree.
    test.skip(true, 'root tenant has no jurisdiction boundaries to select in the employee-create form');
    const stamp = Date.now();
    const empCode = `INT_TEST_CSR_${stamp}`;
    // Mobile prefix from env (CITIZEN_PHONE_PREFIX) — no hardcoded Kenya '7'.
    const mobile = generateEmployeePhone();

    await page.goto(`${BASE_URL}${EMPLOYEES_URL}/create?cb=${stamp}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('input[name="user.name"]').first()).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(2_500);

    await page.locator('input[name="user.name"]').first().fill('Integration Test Employee');
    await page.locator('input[name="code"]').first().fill(empCode);
    await page.locator('input[name="user.mobileNumber"]').first().fill(mobile);

    // Native value setter for date inputs (ra-core onBlur).
    await page.evaluate(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const setDate = (name: string, val: string) => {
        const el = document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
        if (!el) return;
        el.focus();
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      };
      setDate('user.dob', '1990-01-01');
      setDate('dateOfAppointment', '2024-01-01');
    });
    await page.waitForTimeout(1_000);

    // Roles — typeahead.
    const rolesCombo = page.locator('input[placeholder*="Search roles" i]');
    await expect(rolesCombo).toBeVisible({ timeout: 15_000 });
    await rolesCombo.click();
    await page.keyboard.type('PGR_LME', { delay: 60 });
    await page.waitForTimeout(1_500);
    await page
      .getByRole('option')
      .filter({ hasText: /PGR_LME/i })
      .first()
      .click();
    await page.waitForTimeout(600);

    // Assignment block.
    await page.getByRole('button', { name: /^Add assignment$/i }).click();
    await page.waitForTimeout(700);
    const deptCombo = page.getByRole('combobox').filter({ hasText: /Select department/i }).first();
    await deptCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(600);
    const desigCombo = page.getByRole('combobox').filter({ hasText: /Select designation/i }).first();
    await desigCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(600);

    // Current-assignment radio via native setter.
    await page.evaluate(() => {
      const radios = [...document.querySelectorAll('input[type="radio"]')];
      for (const r of radios) {
        const wrapper = r.closest('div,label,fieldset');
        if (wrapper && /current assignment/i.test(wrapper.textContent || '')) {
          const input = r as HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!;
          setter.call(input, true);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('click', { bubbles: true }));
          (wrapper as HTMLElement).click();
          return;
        }
      }
    });
    await page.waitForTimeout(1_500);

    // Jurisdiction.
    await page.getByRole('button', { name: /^Add jurisdiction$/i }).click();
    await page.waitForTimeout(700);
    const hierCombo = page.getByRole('combobox').filter({ hasText: /Select hierarchy/i }).first();
    await hierCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(700);
    const btCombo = page.getByRole('combobox').filter({ hasText: /Select boundary type/i }).first();
    await btCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(800);
    const boundCombo = page
      .getByRole('combobox')
      .filter({ hasText: /Select boundary/i })
      .filter({ hasNotText: /type/i })
      .first();
    await boundCombo.click();
    await page.waitForTimeout(700);
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').first().click();
    await page.waitForTimeout(800);

    // Submit.
    const createBtn = page.getByRole('button', { name: /^Create$/i });
    await createBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const hrmsCreatePromise = page
      .waitForResponse(
        (r) => /\/egov-hrms\/employees\/_create/.test(r.url()) && r.status() < 500,
        { timeout: 25_000 },
      )
      .catch(() => null);
    await createBtn.click();
    const createResp = await hrmsCreatePromise;
    expect(createResp, 'Create POST must hit /egov-hrms/employees/_create').not.toBeNull();
    expect(createResp!.ok(), 'Create must return 2xx').toBeTruthy();
    await page.waitForTimeout(2_000);

    // ============ #471 — form clears (URL + DOM) ============
    await page.waitForURL(/\/manage\/employees(?!.*\/create)/, { timeout: 15_000 });
    expect(page.url(), '#471 — URL must leave /create').not.toMatch(/\/create($|\?)/);
    await expect(
      page.locator('input[name="code"]'),
      '#471 — form input must unmount',
    ).toHaveCount(0, { timeout: 8_000 });

    // ============ #459 — server-side tenant correctness ============
    const tokenResp = await page.request.post(`${BASE_URL}/user/oauth/token`, {
      headers: {
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: `username=${ADMIN_USER}&password=${encodeURIComponent(ADMIN_PASS)}&grant_type=password&scope=read&tenantId=${ROOT_TENANT}&userType=EMPLOYEE`,
    });
    expect(tokenResp.ok()).toBeTruthy();
    const token = (await tokenResp.json()).access_token as string;
    const hrmsResp = await page.request.post(
      `${BASE_URL}/egov-hrms/employees/_search?tenantId=${ROOT_TENANT}&codes=${empCode}`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { RequestInfo: { authToken: token } },
      },
    );
    expect(hrmsResp.ok()).toBeTruthy();
    const employees = (await hrmsResp.json()).Employees as Array<Record<string, unknown>>;
    expect(employees.length).toBeGreaterThan(0);
    expect(
      employees[0].tenantId,
      `#459 — Employee.tenantId must match the form's tenant (${ROOT_TENANT})`,
    ).toBe(ROOT_TENANT);
    expect((employees[0].user as Record<string, unknown>).tenantId).toBe(ROOT_TENANT);
  });
});
