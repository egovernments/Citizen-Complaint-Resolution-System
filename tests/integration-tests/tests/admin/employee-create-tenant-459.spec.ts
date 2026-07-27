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
import {
  BASE_URL,
  ROOT_TENANT,
  TENANT,
  ADMIN_USER,
  ADMIN_PASS,
  generateEmployeePhone,
} from '../utils/env';

const EMPLOYEES_URL = '/configurator/manage/employees';

/** Records this suite created on earlier runs and never cleaned up. Boundary
 *  hierarchies in particular are 48-to-1 junk on a long-lived deployment, so
 *  "pick the first option" reliably picks a hierarchy with no boundaries. */
const PW_JUNK = /(^|_)PW[A-Z_]/i;

/** Escape a live code so it can be matched verbatim inside a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('admin employee create — tenant + form-clears #459 #471 #476', () => {
  test('fills the create form and submits — tenant correct + form clears', {
    annotation: {
      type: 'description',
      description: `Drives the whole Create Employee form and then checks three post-submit claims.

#459 is the reason the Tenant field is DRIVEN rather than left at its default. EmployeeCreate.tsx seeds \`defaults.tenantId\` from the session tenant (the root, e.g. mz) and its \`transform()\` used to let that session value shadow the form value, so every create landed on the session tenant no matter what the operator picked. Asserting against the DEFAULT therefore proves nothing — root == session tenant, so the regression and the fix look identical. This test picks the CITY tenant (which is NOT the session tenant) and asserts the employee lands there.

Jurisdiction walk: the picker is Hierarchy + one cascading select PER HIERARCHY LEVEL (on MAPUTO_ADMIN: Município -> Distrito Municipal -> Bairro -> Quarteirão), each gated on its parent — NOT the "hierarchy / boundary type / boundary" triple an earlier version looked for. Those three comboboxes never existed, which is what actually blocked this test; the recorded reason ("root tenant has no boundary hierarchy at all") was wrong. boundaryHierarchyGetList unions the root tenant with its children, so the real hierarchy IS offered at the root and its boundaries resolve against the city tenant.

Steps:
1. Open /manage/employees/create; fill name, code, mobile, dob, dateOfAppointment.
2. Tenant -> the CITY tenant (deliberately not the session default).
3. Roles -> PGR_LME via the typeahead.
4. Assignment -> first department + designation, mark current assignment.
5. Jurisdiction -> first non-PW_ hierarchy, then walk every enabled level picking the first option.
6. Submit; assert /egov-hrms/employees/_create returned 2xx.
7. #471 — URL leaves /create and the form input unmounts.
8. #459 — employees/_search on the PICKED tenant returns the employee with that tenantId (and user.tenantId), proving the form value beat the session default.`,
    },
    tag: ['@persona:admin'] }, async ({ page }) => {
    test.setTimeout(180_000);

    // The tenant we DRIVE the form to. It must differ from the session tenant
    // (the root) for #459 to be a real claim rather than a restatement of the
    // form default — see the annotation above.
    const targetTenant = TENANT;
    const discriminating = targetTenant !== ROOT_TENANT;
    if (!discriminating) {
      test.info().annotations.push({
        type: 'note',
        description:
          `flat deployment: city tenant (${TENANT}) === root tenant (${ROOT_TENANT}), so the Tenant ` +
          'field is still driven but #459 cannot distinguish the form value from the session default here',
      });
    }

    const stamp = Date.now();
    const empCode = `INT_TEST_CSR_${stamp}`;
    // Mobile prefix from env (CITIZEN_PHONE_PREFIX) — no hardcoded Kenya '7'.
    const mobile = generateEmployeePhone();

    await page.goto(`${BASE_URL}${EMPLOYEES_URL}/create?cb=${stamp}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('input[name="user.name"]').first()).toBeVisible({ timeout: 25_000 });

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

    /** Options of whichever radix Select is currently open. */
    const openOptions = page.locator('[role="listbox"][data-state="open"] [role="option"]');

    // ---- Tenant — the point of #459 ----
    // The radix SelectTrigger carries no accessible name, so anchor on the
    // field's <Label> text and take the combobox in the innermost wrapper.
    const tenantCombo = page
      .locator('div')
      .filter({ has: page.getByText(/^Tenant$/) })
      .filter({ has: page.getByRole('combobox') })
      .last()
      .getByRole('combobox')
      .first();
    await expect(tenantCombo, 'the create form must offer a Tenant field').toBeVisible({
      timeout: 15_000,
    });
    await expect(
      tenantCombo,
      'the Tenant field must default to the session tenant — that default is exactly what #459 must not be mistaken for',
    ).toHaveText(ROOT_TENANT);
    await tenantCombo.click();
    const tenantOption = openOptions
      .filter({ hasText: new RegExp(`^${escapeRegex(targetTenant)}$`) })
      .first();
    await expect(
      tenantOption,
      `the Tenant dropdown must offer ${targetTenant}`,
    ).toBeVisible({ timeout: 15_000 });
    await tenantOption.click();
    await expect(tenantCombo, 'the Tenant field must hold the picked tenant').toHaveText(
      targetTenant,
    );

    // ---- Roles — typeahead ----
    const rolesCombo = page.locator('input[placeholder*="Search roles" i]');
    await expect(rolesCombo).toBeVisible({ timeout: 15_000 });
    await rolesCombo.click();
    await page.keyboard.type('PGR_LME', { delay: 60 });
    const roleOption = page.getByRole('option').filter({ hasText: /PGR_LME/i }).first();
    await expect(roleOption, 'PGR_LME must be offered by the roles typeahead').toBeVisible({
      timeout: 15_000,
    });
    await roleOption.click();

    // ---- Assignment ----
    await page.getByRole('button', { name: /^Add assignment$/i }).click();
    const deptCombo = page.getByRole('combobox').filter({ hasText: /Select department/i }).first();
    await expect(deptCombo).toBeVisible({ timeout: 15_000 });
    await deptCombo.click();
    await expect(openOptions.first()).toBeVisible({ timeout: 15_000 });
    await openOptions.first().click();
    const desigCombo = page.getByRole('combobox').filter({ hasText: /Select designation/i }).first();
    await expect(desigCombo).toBeVisible({ timeout: 15_000 });
    await desigCombo.click();
    await expect(openOptions.first()).toBeVisible({ timeout: 15_000 });
    await openOptions.first().click();

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

    // ---- Jurisdiction — Hierarchy, then one gated select per hierarchy level ----
    await page.getByRole('button', { name: /^Add jurisdiction$/i }).click();
    const jurisdictionRow = page
      .locator('div')
      .filter({ has: page.getByRole('button', { name: /^Remove jurisdiction 1$/i }) })
      .last();
    const levelCombos = jurisdictionRow.getByRole('combobox');
    const hierCombo = levelCombos.first();
    await expect(hierCombo, 'the jurisdiction row must offer a Hierarchy select').toBeVisible({
      timeout: 15_000,
    });
    await hierCombo.click();
    await expect(openOptions.first()).toBeVisible({ timeout: 15_000 });
    const hierarchyNames = (await openOptions.allTextContents()).map((t) => t.trim()).filter(Boolean);
    const realHierarchy = hierarchyNames.find((h) => !PW_JUNK.test(h));
    expect(
      realHierarchy,
      `the Hierarchy select must offer a real (non-PW_ test-junk) boundary hierarchy, got ${JSON.stringify(hierarchyNames.slice(0, 10))}`,
    ).toBeTruthy();
    await openOptions
      .filter({ hasText: new RegExp(`^${escapeRegex(realHierarchy!)}$`) })
      .first()
      .click();

    // Each level is disabled until its parent is chosen; walk down until the
    // hierarchy runs out of (enabled) levels. The deepest pick is what gets stored.
    let levelsPicked = 0;
    for (let level = 1; level < 12; level++) {
      const combo = levelCombos.nth(level);
      if ((await combo.count()) === 0) break;
      const enabled = await expect(combo).toBeEnabled({ timeout: 6_000 }).then(
        () => true,
        () => false,
      );
      if (!enabled) break;
      await combo.click();
      const opened = await expect(openOptions.first())
        .toBeVisible({ timeout: 8_000 })
        .then(() => true, () => false);
      if (!opened) {
        await page.keyboard.press('Escape').catch(() => {});
        break;
      }
      await openOptions.first().click();
      levelsPicked += 1;
    }
    expect(
      levelsPicked,
      `hierarchy "${realHierarchy}" resolved no selectable boundaries — the jurisdiction cascade is empty`,
    ).toBeGreaterThan(0);

    // ---- Submit ----
    const createBtn = page.getByRole('button', { name: /^Create$/i });
    await createBtn.scrollIntoViewIfNeeded();
    const hrmsCreatePromise = page
      .waitForResponse(
        (r) => /\/egov-hrms\/employees\/_create/.test(r.url()) && r.status() < 500,
        { timeout: 30_000 },
      )
      .catch(() => null);
    await createBtn.click();
    const createResp = await hrmsCreatePromise;
    expect(createResp, 'Create POST must hit /egov-hrms/employees/_create').not.toBeNull();
    expect(
      createResp!.ok(),
      `Create must return 2xx, got ${createResp!.status()}: ${await createResp!.text().catch(() => '')}`,
    ).toBeTruthy();

    // ============ #471 — form clears (URL + DOM) ============
    await page.waitForURL(/\/manage\/employees(?!.*\/create)/, { timeout: 20_000 });
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
      `${BASE_URL}/egov-hrms/employees/_search?tenantId=${targetTenant}&codes=${empCode}`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { RequestInfo: { authToken: token } },
      },
    );
    expect(hrmsResp.ok()).toBeTruthy();
    const employees = (await hrmsResp.json()).Employees as Array<Record<string, unknown>>;
    expect(
      employees.length,
      `#459 — the employee must be findable on the tenant the form picked (${targetTenant}); ` +
        `finding nothing here means the create landed on the session tenant (${ROOT_TENANT}) instead`,
    ).toBeGreaterThan(0);
    expect(
      employees[0].tenantId,
      `#459 — Employee.tenantId must match the form's Tenant field (${targetTenant}), not the session tenant (${ROOT_TENANT})`,
    ).toBe(targetTenant);
    expect(
      (employees[0].user as Record<string, unknown>).tenantId,
      `#459 — the backing user must land on ${targetTenant} too`,
    ).toBe(targetTenant);
  });
});
