/**
 * Employee Edit E2E — Configurator
 *
 * Validates fix for:
 *   #476 — auditDetails preserved in assignments/jurisdictions on edit
 *          (prevents NPE when HRMS calls assignment.getAuditDetails().setLastModifiedBy())
 */
import { test, expect } from '@playwright/test';
import { loginConfigurator, CONFIGURATOR_BASE } from '../../utils/configurator-auth';
import { apiAuth, buildRequestInfo, employeeSearch, type AuthInfo } from '../../utils/manage/api';
import { testCode } from '../../utils/manage/codes';
import { ROOT_TENANT, TENANT } from '../../utils/env';
import { getMobileValidationRule, generateValidMobile } from '../../utils/mdms-mobile';

type Employee = Record<string, any>;

async function hrms(auth: AuthInfo, path: string, body: Record<string, unknown>): Promise<Employee[]> {
  const res = await fetch(`${auth.baseUrl}/egov-hrms/employees/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.Errors?.length) {
    throw new Error(`HRMS ${path} ${res.status}: ${(json.Errors || []).map((e: any) => `${e.code}:${e.message}`).join(', ')}`);
  }
  return json.Employees || [];
}

const byCode = (auth: AuthInfo, code: string) =>
  hrms(auth, `_search?tenantId=${ROOT_TENANT}&codes=${encodeURIComponent(code)}&limit=1&offset=0`, {
    RequestInfo: buildRequestInfo(auth, '_search'),
  }).then((list) => list[0]);

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
1. API-seed a PW_ employee with one assignment and one jurisdiction, copying the department/designation/boundary from a live employee (never edit a real person).
2. Open /manage/employees, search its code, click its code cell (the row centre is the Department link), then Edit.
3. Assert both the Assignments and Jurisdictions sections render.
4. Change the name and Save; the HRMS _update must answer 202 (accepted; HRMS persists asynchronously) without a NullPointerException.
5. HRMS search: the name changed, and the assignment and jurisdiction ids are the ones seeded (kept, not dropped or re-created).
6. Soft-delete the seeded employee.

Marked test.slow() because HRMS update fans out across multiple service calls.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:476', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }, testInfo) => {
    test.slow(); // Employee edit involves multiple API calls

    // Edit an employee this test creates, never a live one: the list's first
    // row is a real person, and its centre is the Department column, which
    // has been an EntityLink to /manage/departments/<code> since the
    // configurator was vendored (EmployeeList.tsx, 244d0303a) — a row click
    // there opens the department, not the employee.
    const auth = await apiAuth();
    const template = (await employeeSearch(auth, ROOT_TENANT, { limit: 25 })).find((e: Employee) =>
      e.assignments?.some((a: Employee) => a.isCurrentAssignment && a.department && a.designation)
      && e.jurisdictions?.some((j: Employee) => j.boundary && j.hierarchy && j.boundaryType)) as Employee | undefined;
    test.skip(!template, 'no live employee with an assignment and a jurisdiction to copy the HRMS foreign keys from');
    const asg = template!.assignments.find((a: Employee) => a.isCurrentAssignment && a.department && a.designation);
    const jur = template!.jurisdictions.find((j: Employee) => j.boundary && j.hierarchy && j.boundaryType);

    const code = testCode(testInfo, 'EMP_476');
    const appointed = Date.now() - 30 * 24 * 3600_000;
    await hrms(auth, `_create?tenantId=${ROOT_TENANT}`, {
      RequestInfo: buildRequestInfo(auth, '_create'),
      Employees: [{
        tenantId: ROOT_TENANT,
        code,
        employeeStatus: 'EMPLOYED',
        employeeType: template!.employeeType || 'PERMANENT',
        dateOfAppointment: appointed,
        user: {
          name: `PW Edit476 ${code.split('_')[1]}`,
          mobileNumber: generateValidMobile(await getMobileValidationRule(TENANT)),
          type: 'EMPLOYEE',
          active: true,
          gender: 'FEMALE',
          dob: 631152000000,
          tenantId: ROOT_TENANT,
          roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: ROOT_TENANT }],
        },
        jurisdictions: [{
          boundary: jur.boundary, boundaryType: jur.boundaryType,
          hierarchy: jur.hierarchy, hierarchyType: jur.hierarchyType || jur.hierarchy,
          tenantId: ROOT_TENANT, isActive: true,
        }],
        assignments: [{ department: asg.department, designation: asg.designation, fromDate: appointed, isCurrentAssignment: true }],
      }],
    });

    try {
      const before = await byCode(auth, code);
      expect(before?.assignments?.length, 'seeded assignment').toBe(1);
      expect(before?.jurisdictions?.length, 'seeded jurisdiction').toBe(1);

      // Open it from the list by its own code cell.
      await page.goto(`${CONFIGURATOR_BASE}/manage/employees`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.locator('#main-content').getByPlaceholder(/search/i).first().fill(code);
      const codeCell = page.getByRole('row').filter({ hasText: code }).getByText(code, { exact: true });
      await expect(codeCell).toBeVisible({ timeout: 20_000 });
      await codeCell.click();
      await expect(page).toHaveURL(/\/employees\/[^/]+\/show/);
      await page.getByRole('button', { name: /^Edit$/i }).click();
      await expect(page).toHaveURL(/\/employees\/[^/]+\/edit$/);

      // Both sections render with the existing rows, not blanked.
      await expect(page.getByText('Assignments').first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Jurisdictions').first()).toBeVisible({ timeout: 5_000 });

      // A real change, so the save cannot be a no-op.
      const newName = `PW Edited476 ${code.split('_')[1]}`;
      await page.getByLabel(/^Name/i).fill(newName);
      const updated = page.waitForResponse((r) => r.url().includes('/egov-hrms/employees/_update') && r.request().method() === 'POST', { timeout: 30_000 });
      await page.getByRole('button', { name: /^Save$/i }).click();
      const response = await updated;
      const body = await response.text();
      // HRMS answers _update with 202 Accepted: the row is persisted asynchronously.
      expect(response.status(), `HRMS _update: ${body.slice(0, 300)}`).toBe(202);
      expect(body).not.toContain('NullPointerException');

      // HRMS kept the existing assignment and jurisdiction (same ids) and applied the edit.
      await expect.poll(async () => (await byCode(auth, code))?.user?.name, { timeout: 20_000 }).toBe(newName);
      const after = await byCode(auth, code);
      expect(after.assignments.map((a: Employee) => a.id)).toEqual(before.assignments.map((a: Employee) => a.id));
      expect(after.jurisdictions.filter((j: Employee) => j.isActive !== false).map((j: Employee) => j.id))
        .toEqual(before.jurisdictions.map((j: Employee) => j.id));
    } finally {
      // Soft-delete the seeded employee (HRMS has no hard delete).
      const emp = await byCode(auth, code).catch(() => undefined);
      if (emp && emp.isActive !== false) {
        await hrms(auth, `_update?tenantId=${ROOT_TENANT}`, {
          RequestInfo: buildRequestInfo(auth, '_update'),
          Employees: [{
            ...emp, employeeStatus: 'INACTIVE', isActive: false, reActivateEmployee: false,
            deactivationDetails: [...(emp.deactivationDetails || []), {
              reasonForDeactivation: 'OTHERS', effectiveFrom: Date.now(), orderNo: 'PW-TEARDOWN', tenantId: ROOT_TENANT,
            }],
          }],
        }).catch((e) => console.warn(`[employee-edit] cleanup left ${code} behind: ${(e as Error).message}`));
      }
    }
  });
});
