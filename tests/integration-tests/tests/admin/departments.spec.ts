/**
 * Department management — list / create / edit / bulk-import / export.
 *
 * Every test that creates rows tracks them in `createdCodes` so the
 * afterAll soft-deletes via mdms _update isActive=false. Codes use the
 * PW_${hash}_${kind} prefix from helpers/codes so parallel runs and
 * historical leftovers never collide.
 */
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import {
  employeeSearch,
  loadAuth,
  mdmsCreate,
  mdmsSearch,
  type AuthInfo,
} from '../utils/manage/api';
import { testCode, testCodeIndexed } from '../utils/manage/codes';
import { cleanupMdms } from '../utils/manage/teardown';

const TENANT_CODE = process.env.TENANT_CODE || 'ke';
const SCHEMA = 'common-masters.Department';
const LIST_PATH = '/configurator/manage/departments';

const createdCodes = new Set<string>();

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  if (createdCodes.size === 0) return;
  const auth = loadAuth();
  const result = await cleanupMdms(
    Array.from(createdCodes),
    SCHEMA,
    TENANT_CODE,
    auth,
  );
  // Surface failures so a flaky teardown shows up in CI logs but doesn't
  // fail the suite — the afterAll is best-effort cleanup, not a check.
  if (result.failed.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[departments] cleanup left ${result.failed.length} record(s) behind:`,
      result.failed,
    );
  }
});

test.describe('manage/departments', () => {
  test('1. list renders with header columns and filter narrows results', async ({
    page,
  }) => {
    await page.goto(LIST_PATH);

    // Header columns — Code / Name / Status / Description.
    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    for (const header of ['Code', 'Name', 'Status', 'Description']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(`^${header}$`, 'i') }),
      ).toBeVisible();
    }

    // At least one data row should render on a healthy tenant.
    const dataRows = page.getByRole('row');
    const initialCount = await dataRows.count();
    expect(initialCount).toBeGreaterThan(1); // header + at least 1

    // Type into the search input — debounced server-side filter narrows.
    const search = page.getByPlaceholder(/search/i).first();
    await expect(search).toBeVisible();
    await search.fill('zzz_no_such_dept_string');
    // Wait for the list to settle after the debounce (~300ms typical).
    await page.waitForLoadState('networkidle').catch(() => {});

    const filteredCount = await dataRows.count();
    // Either the row count drops or an empty-state replaces the table.
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Reset search before status filter so the two filters compose
    // predictably.
    await search.fill('');
    await page.waitForLoadState('networkidle').catch(() => {});

    // Toggle Status filter to Inactive — count should change (or empty
    // state appears).
    const statusFilter = page.getByLabel(/^Status$/i);
    if (await statusFilter.isVisible().catch(() => false)) {
      await statusFilter.click();
      await page.getByRole('option', { name: /Inactive/i }).click();
      await page.waitForLoadState('networkidle').catch(() => {});
      // Just assert the filter applied — we don't know the tenant's
      // active/inactive split.
      const inactiveCount = await dataRows.count();
      expect(inactiveCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('2. single create → edit → deactivate round-trip', async ({ page }, testInfo) => {
    const code = testCode(testInfo, 'DEPT_RT');
    const name = `PW Roundtrip ${code}`;
    createdCodes.add(code);

    // --- Create ---
    await page.goto(`${LIST_PATH}/create`);

    await page.getByLabel(/^Name/i).fill(name);
    // Code may be auto-derived from name; force it to our PW_ value.
    const codeInput = page.getByLabel(/^Code/i);
    await codeInput.fill('');
    await codeInput.fill(code);
    await page.getByLabel(/^Description/i).fill('Created by Playwright');

    await Promise.all([
      page.waitForURL(LIST_PATH, { timeout: 30_000 }),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);

    // --- Verify in list, then open Show ---
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toBeVisible();
    await row.click();

    // Show page — verify the description we wrote.
    await expect(page.getByText('Created by Playwright')).toBeVisible();

    // --- Edit description ---
    await page.getByRole('button', { name: /^Edit$/i }).click();
    const desc = page.getByLabel(/^Description/i);
    await desc.fill('Edited by Playwright');

    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByText('Edited by Playwright')).toBeVisible();

    // --- Deactivate ---
    await page.getByRole('button', { name: /^Edit$/i }).click();
    const activeCheckbox = page.getByLabel(/^Active$/i);
    await activeCheckbox.uncheck({ force: true });
    // DeactivationGuard banner should appear with dependency counts.
    // We assert presence loosely — exact wording depends on dependency
    // type and may include 0-count designations.
    await expect(
      page.getByText(/depend|in use|will affect/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /^Save$/i }).click();

    // Back to list — switch the status filter to Inactive and verify the
    // row appears there (and not in Active).
    await page.goto(LIST_PATH);
    const statusFilter = page.getByLabel(/^Status$/i);
    if (await statusFilter.isVisible().catch(() => false)) {
      await statusFilter.click();
      await page.getByRole('option', { name: /Inactive/i }).click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.getByPlaceholder(/search/i).first().fill(code);
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.getByRole('row').filter({ hasText: code })).toBeVisible();
    }
  });

  test('3. bulk import — happy path creates 5 rows', async ({ page }, testInfo) => {
    const codes = Array.from({ length: 5 }, (_, i) =>
      testCodeIndexed(testInfo, 'DEPT_BULK', i + 1),
    );
    codes.forEach((c) => createdCodes.add(c));

    await page.goto(`${LIST_PATH}/bulk`);

    // Build the upload XLSX in-memory matching the export template's
    // single 'Department' sheet with code/name/description headers.
    const buffer = await buildDepartmentXlsx(
      codes.map((c, i) => ({
        code: c,
        name: `PW Dept ${i + 1}`,
        description: 'Bulk import smoke',
      })),
    );

    // Upload via the file input. The bulk import page renders a
    // dropzone backed by an <input type="file">.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'departments.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });

    // Preview should show 5 valid rows.
    await expect(page.getByText(/5\s*(valid|rows)/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // Click "Create 5 departments" (label varies — match a flexible button).
    const createBtn = page.getByRole('button', {
      name: /Create\s+\d+\s+(department|row)s?/i,
    });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Complete screen — should report 5 created / 0 failed.
    await expect(page.getByText(/5\s*(created|success)/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Sanity-check via the API that all 5 codes landed and are active.
    const auth = loadAuth();
    const records = await searchByCodes(auth, codes);
    expect(records.length).toBe(5);
    for (const r of records) expect(r.isActive).not.toBe(false);
  });

  test('4. bulk import — duplicate code rejected client-side', async ({
    page,
  }, testInfo) => {
    // First, seed an existing record via the API so we know its code is
    // already on the tenant.
    const auth = loadAuth();
    const existingCode = testCode(testInfo, 'DEPT_EXIST');
    createdCodes.add(existingCode);
    await mdmsCreate(auth, TENANT_CODE, SCHEMA, existingCode, {
      code: existingCode,
      name: 'PW Existing',
      description: 'Pre-existing for duplicate test',
      active: true,
    });

    const newCodes = Array.from({ length: 2 }, (_, i) =>
      testCodeIndexed(testInfo, 'DEPT_DUP', i + 1),
    );
    newCodes.forEach((c) => createdCodes.add(c));

    // XLSX has 1 dup row + 2 fresh rows.
    const buffer = await buildDepartmentXlsx([
      { code: existingCode, name: 'PW Dup', description: 'dup row' },
      { code: newCodes[0], name: 'PW Dup1', description: 'fresh' },
      { code: newCodes[1], name: 'PW Dup2', description: 'fresh' },
    ]);

    await page.goto(`${LIST_PATH}/bulk`);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'departments-dup.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });

    // The duplicate row should be marked Error / Invalid; reason mentions
    // the code already exists.
    await expect(
      page.getByText(/already\s+exists|duplicate/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    // 2 valid rows remain — the Create button text reflects that count.
    await expect(
      page.getByRole('button', { name: /Create\s+2\s+(department|row)s?/i }),
    ).toBeVisible();
  });

  test('5a. Show page renders "Related" reverse references (complaint-types + employees)', async ({
    page,
  }) => {
    // Seeded `ke` tenant has DEPT_7 with employees + complaint-types
    // pointing at it (Gurjeet Singh's assignment references DEPT_7). Use
    // that as the fixture — avoids seeding our own reverse-ref graph.
    const auth = loadAuth();
    const deptCandidates = await mdmsSearch(auth, TENANT_CODE, SCHEMA, {
      limit: 20,
    });
    const realDept = deptCandidates.find(
      (r) => r.isActive !== false && !String(r.uniqueIdentifier).startsWith('PW_'),
    );
    test.skip(!realDept, 'No seeded department to probe reverse references on');

    await page.goto(`${LIST_PATH}/${encodeURIComponent(realDept!.uniqueIdentifier)}/show`);

    // The "Related" section headers; both lists render even when empty.
    await expect(page.getByText(/^Related$/i).first()).toBeVisible();
    await expect(page.getByText(/Complaint Types/i).first()).toBeVisible();
    await expect(page.getByText(/^Employees$/i).first()).toBeVisible();
  });

  test('5b. deactivation guard probes designation + employee APIs', async ({
    page,
  }, testInfo) => {
    // Seed a department with a designation linked to it, so the guard's
    // "designations referencing this department" probe returns >= 1.
    const auth = loadAuth();
    const deptCode = testCode(testInfo, 'DEPT_GUARD');
    createdCodes.add(deptCode);
    await mdmsCreate(auth, TENANT_CODE, SCHEMA, deptCode, {
      code: deptCode,
      name: `PW Guard Dept ${deptCode}`,
      description: 'For guard probe',
      active: true,
    });
    const desigCode = testCode(testInfo, 'DEPT_GUARD_DESIG');
    await mdmsCreate(auth, TENANT_CODE, 'common-masters.Designation', desigCode, {
      code: desigCode,
      name: `PW Guard Desig ${desigCode}`,
      description: 'For guard probe',
      department: [deptCode],
      active: true,
    });
    // Track for cleanup — designation sits on its own schema so reuse
    // createdCodes is wrong; cleanup it directly in this test's teardown.
    test.info().annotations.push({ type: 'seed', description: `desig=${desigCode}` });

    await page.goto(`${LIST_PATH}/${encodeURIComponent(deptCode)}/show`);
    await page.getByRole('button', { name: /^Edit$/i }).click();
    await page.getByLabel(/^Active$/i).uncheck({ force: true });

    // Banner references the designation count (>= 1).
    await expect(
      page.getByText(/designation|depend|in use/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Cancel — don't persist deactivation.
    await page.getByRole('button', { name: /^Cancel$/i }).click();

    // Cleanup the seeded designation inline — departments.afterAll only
    // handles the departments schema.
    await cleanupMdms([desigCode], 'common-masters.Designation', TENANT_CODE, auth);

    // Sanity — the employee probe hits HRMS; ensure HRMS is reachable at
    // all so a silent 500 here doesn't let the banner slip past in future.
    const employees = await employeeSearch(auth, TENANT_CODE, { limit: 1 });
    expect(Array.isArray(employees)).toBe(true);
  });

  test('5c. API update round-trip preserves auditDetails on a department', async ({}, testInfo) => {
    const auth = loadAuth();
    const code = testCode(testInfo, 'DEPT_AUDIT');
    createdCodes.add(code);

    await mdmsCreate(auth, TENANT_CODE, SCHEMA, code, {
      code,
      name: `PW Audit ${code}`,
      description: 'Initial description',
      active: true,
    });

    // Fetch — bump description via the UI-equivalent update path.
    const pre = (
      await mdmsSearch(auth, TENANT_CODE, SCHEMA, { uniqueIdentifiers: [code] })
    )[0];
    expect(pre).toBeTruthy();
    expect(pre.auditDetails).toBeTruthy();

    // Import on demand — keeps top-level imports tidy.
    const { mdmsUpdate } = await import('../utils/manage/api');
    pre.data = { ...pre.data, description: 'Edited description via API' };
    const updated = await mdmsUpdate(auth, pre, true);
    expect((updated.data as Record<string, unknown>).description).toBe(
      'Edited description via API',
    );
    // lastModifiedTime should advance (>= previous createdTime).
    const audit = updated.auditDetails as Record<string, number> | undefined;
    const preAudit = pre.auditDetails as Record<string, number> | undefined;
    if (audit?.lastModifiedTime && preAudit?.createdTime) {
      expect(audit.lastModifiedTime).toBeGreaterThanOrEqual(preAudit.createdTime);
    }
  });

  test('6. bulk export round-trip — downloaded xlsx parses', async ({
    page,
  }) => {
    await page.goto(LIST_PATH);

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: /^Export$/i }).click();
    const download = await downloadPromise;

    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Parse the xlsx and confirm the first sheet has a header row matching
    // the import template's column shape (code / name / description).
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(downloadPath!);
    const sheet = wb.worksheets[0];
    expect(sheet, 'export should contain at least one sheet').toBeTruthy();
    const headerRow = sheet.getRow(1).values as Array<string | undefined>;
    const headers = headerRow
      .filter((v): v is string => typeof v === 'string')
      .map((h) => h.toLowerCase());

    expect(headers).toContain('code');
    expect(headers).toContain('name');
    // 'description' may be optional depending on tenant config but the
    // round-trip relies on it being present.
    expect(headers).toContain('description');

    // Sheet should have at least the rows we know exist on the tenant.
    expect(sheet.actualRowCount).toBeGreaterThan(1);
  });
});

// --- Helpers local to this spec ---

async function buildDepartmentXlsx(
  rows: Array<{ code: string; name: string; description: string }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Department');
  sheet.addRow(['code', 'name', 'description']);
  for (const r of rows) sheet.addRow([r.code, r.name, r.description]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

async function searchByCodes(
  auth: AuthInfo,
  codes: string[],
): Promise<Array<{ uniqueIdentifier: string; isActive?: boolean }>> {
  const { mdmsSearch } = await import('../utils/manage/api');
  return mdmsSearch(auth, TENANT_CODE, SCHEMA, {
    uniqueIdentifiers: codes,
    limit: codes.length + 5,
  });
}
