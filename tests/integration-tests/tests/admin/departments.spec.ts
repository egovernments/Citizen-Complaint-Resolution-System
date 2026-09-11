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
  type MdmsRecord,
} from '../utils/manage/api';
import { testCode, testCodeIndexed } from '../utils/manage/codes';
import { cleanupMdms } from '../utils/manage/teardown';
import { ROOT_TENANT } from '../utils/env';

// Root (state) tenant, sourced from env (ROOT_TENANT / DIGIT_TENANT) so the
// suite is deployment-portable — no hardcoded 'ke'.
const TENANT_CODE = ROOT_TENANT;
const SCHEMA = 'common-masters.Department';
const LIST_PATH = '/configurator/manage/departments';

const createdCodes = new Set<string>();

// Scratch records this suite (and every previous run) created are prefixed
// PW_ / *_PW* by utils/manage/codes. A long-lived deployment accumulates
// thousands of them, so "pick a real record" has to exclude them explicitly —
// the same pattern the rest of the suite uses.
const SCRATCH_CODE = /(^|_)PW[A-Z_]/i;

/** First active, non-scratch record — i.e. real tenant data, not our litter. */
function findRealRecord(records: MdmsRecord[]): MdmsRecord | undefined {
  return records.find(
    (r) =>
      r.isActive !== false &&
      !SCRATCH_CODE.test(String(r.uniqueIdentifier)) &&
      !SCRATCH_CODE.test(String((r.data as Record<string, unknown>)?.code ?? '')),
  );
}

// Default mode (not serial): workers=1 keeps file order, but a failure no longer
// cascade-skips the rest — each test self-seeds its own department code.
test.describe.configure({ mode: 'default' });

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
  test('1. list renders with header columns and filters narrow to the expected rows', {
    annotation: {
      type: 'description',
      description: `Asserts /manage/departments renders with the four expected columns (Code, Name, Status, Description) and that BOTH list filters actually narrow the rendered rows — not merely "don't increase the count".

Steps:
1. Resolve a real active department via mdmsSearch(isActive:true), preferring a non-scratch (non-PW_) code. Skip only if the deployment has no active department at all.
2. Navigate to /configurator/manage/departments.
3. Assert role=table is visible and each of ['Code','Name','Status','Description'] renders as a columnheader.
4. Count DATA rows (rows containing role=cell — excludes the header row); assert > 0.
5. Search a term that cannot match: assert data rows go to EXACTLY 0 and the empty-state ("No records") renders.
6. Search the real department's code: assert its row is present AND every rendered row matches the term; when the unfiltered list had more than one row, assert the count strictly dropped.
7. Clear the search and assert the original row count is restored.
8. Status filter → Active: assert the list is non-empty and EVERY row is marked Active.
9. Status filter → Inactive: assert ZERO rows marked Active survive.

Every count read is an auto-retrying expect()/expect.poll() — the grid debounces filter changes (DigitList setFilters(..., undefined, true)), so a bare count() immediately after typing reads the PRE-filter list.

Prior version was vacuous: expect(filteredCount).toBeLessThanOrEqual(initialCount) can never fail (a narrowing filter cannot increase a count) and, thanks to the debounce race, filteredCount === initialCount anyway; expect(inactiveCount).toBeGreaterThanOrEqual(0) is a pure tautology. The Status branch was additionally dead code — getByLabel(/^Status$/i) never matches, because SelectFilterInput renders a Radix trigger with no associated <label>, so the whole if-block was skipped on every run.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    // Resolve the search term from live data rather than hardcoding a
    // deployment literal. isActive:true is load-bearing: this tenant carries
    // 147 department records of which only 3 are active, so an unfiltered page
    // is entirely soft-deleted scratch rows.
    const auth = loadAuth();
    const activeDepts = await mdmsSearch(auth, TENANT_CODE, SCHEMA, {
      limit: 200,
      isActive: true,
    });
    const probe = findRealRecord(activeDepts) ?? activeDepts[0];
    test.skip(!probe, 'No active department on this deployment to filter for');
    const probeCode = String(probe!.uniqueIdentifier);

    await page.goto(LIST_PATH);

    // Header columns — Code / Name / Status / Description.
    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    for (const header of ['Code', 'Name', 'Status', 'Description']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(`^${header}$`, 'i') }),
      ).toBeVisible();
    }

    // DATA rows only. getByRole('row') also matches the header row (whose
    // children are columnheaders, not cells), which is what forced the old
    // `> 1` / `<= initial` fudge factors. Filtering on `has: cell` gives a
    // locator whose count is the real record count, so exact assertions work.
    const dataRows = page.getByRole('row').filter({ has: page.getByRole('cell') });
    await expect(dataRows.first()).toBeVisible();
    const initialCount = await dataRows.count();
    expect(initialCount, 'list should render at least one department').toBeGreaterThan(0);

    const search = page.getByPlaceholder(/search/i).first();
    await expect(search).toBeVisible();

    // --- Search that matches nothing must empty the table ---
    await search.fill('zzz_no_such_dept_string');
    // toHaveCount auto-retries, so this rides out the grid's debounce instead
    // of racing it.
    await expect(dataRows).toHaveCount(0);
    await expect(page.getByText(/no records/i).first()).toBeVisible();

    // --- Search for a real code must leave ONLY rows that match it ---
    await search.fill(probeCode);
    await expect(dataRows.filter({ hasText: probeCode }).first()).toBeVisible();
    await expect
      .poll(
        async () => {
          const texts = await dataRows.allTextContents();
          return (
            texts.length > 0 &&
            texts.every((t) => t.toLowerCase().includes(probeCode.toLowerCase()))
          );
        },
        { message: `every row left after searching "${probeCode}" should match it` },
      )
      .toBe(true);
    if (initialCount > 1) {
      // Strict narrowing — a code search cannot leave the full list behind.
      await expect
        .poll(() => dataRows.count(), { message: 'search should strictly narrow the list' })
        .toBeLessThan(initialCount);
    }

    // Reset search before the status filter so the two compose predictably.
    await search.fill('');
    await expect(dataRows).toHaveCount(initialCount);

    // --- Status filter ---
    // SelectFilterInput renders a Radix trigger whose only label is the
    // SelectValue placeholder, so there is no <label> to target and no
    // accessible name — getByLabel(/^Status$/i) matched nothing, which is why
    // the old assertions never ran. Match the trigger by the text it shows in
    // each of its states instead.
    const statusFilter = page
      .getByRole('combobox')
      .filter({ hasText: /^(Status|Active|Inactive)$/ })
      .first();
    await expect(statusFilter).toBeVisible();
    const rowsMarkedActive = dataRows.filter({
      has: page.getByRole('cell', { name: /^Active$/ }),
    });

    // Status = Active → non-empty, and every row is marked Active.
    await statusFilter.click();
    await page.getByRole('option', { name: /^Active$/i }).click();
    await expect(rowsMarkedActive.first()).toBeVisible();
    await expect
      .poll(
        async () => (await dataRows.count()) - (await rowsMarkedActive.count()),
        { message: 'Status=Active should leave no non-Active rows' },
      )
      .toBe(0);
    const activeCount = await dataRows.count();
    expect(activeCount).toBeGreaterThan(0);

    // Status = Inactive → not one of those Active rows survives. This is the
    // assertion the old `inactiveCount >= 0` tautology should have been.
    await statusFilter.click();
    await page.getByRole('option', { name: /^Inactive$/i }).click();
    await expect(rowsMarkedActive).toHaveCount(0);
  });

  test('2. single create → edit → deactivate round-trip', {
    annotation: {
      type: 'description',
      description: `Drives a full UI lifecycle on a Department record: create → show → edit name → deactivate (with DeactivationGuard banner check) → confirm row appears under the Inactive status filter. Catches regressions in any of the four CRUD-ish surfaces in one walk. The Department schema only allows {code, name, active} (additionalProperties:false), so the form has no Description field — the edit round-trip mutates the name instead.

Steps:
1. Generate a unique code + name; track for cleanup.
2. Create: navigate to /create; fill Name + Code (force PW_ value); click Create; wait for navigation back to LIST_PATH.
3. Verify in list: search for code, click matching row.
4. Show: assert the created name is visible.
5. Edit: click Edit; change Name to "<name> edited"; Save; assert new name is visible.
6. Deactivate: click Edit again; uncheck Active; assert a deactivation banner matching /depend|in use|will affect/i is visible within 10s; click Save.
7. Back at the list, if Status filter exists, switch to Inactive; search for code; assert the row is visible.

Guard banner check is loose because exact wording depends on dependency type and may include 0-count designations.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }, testInfo) => {
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
    // No Description field — the Department schema only allows {code, name,
    // active} (additionalProperties:false), so the form dropped it.

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

    // Show page — verify the name we created. The list row that led us here
    // stays mounted, so the name can resolve to >1 node; assert on the first.
    await expect(page.getByText(name).first()).toBeVisible();

    // --- Edit the name (the only editable free-text field) ---
    const editedName = `${name} edited`;
    await page.getByRole('button', { name: /^Edit$/i }).click();
    const nameInput = page.getByLabel(/^Name/i);
    await nameInput.fill(editedName);

    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByText(editedName).first()).toBeVisible();

    // After Save the edit form returns to the LIST (DigitEdit redirect default),
    // so reopen the record's Show page before the deactivate edit — otherwise the
    // top-level "Edit" button doesn't exist on the list and the click hangs.
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('row').filter({ hasText: code }).first().click();

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

  test('3. bulk import — happy path creates 5 rows', {
    annotation: {
      type: 'description',
      description: `Drives the Department bulk-import flow: build a 5-row xlsx, upload via the dropzone, verify "5 valid" preview, click Create, verify "5 created", then sanity-check via API that all 5 codes exist and are active.

Steps:
1. Generate 5 unique codes via testCodeIndexed; track all for cleanup.
2. Navigate to /departments/bulk.
3. Build xlsx via buildDepartmentXlsx (single 'Department' sheet, columns code/name/description).
4. Upload via input[type="file"]; setInputFiles with the buffer + xlsx mime type.
5. Wait for /5\\s*(valid|rows)/i within 30s.
6. Click button matching /Create\\s+\\d+\\s+(department|row)s?/i.
7. Wait for /5\\s*(created|success)/i within 60s.
8. searchByCodes(codes) via API; assert all 5 returned with isActive !== false.

Loose regex on "department|row" tolerates UI label changes between Create-N-departments and Create-N-rows variants.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:happy-path', '@layer:ui', '@persona:admin'] }, async ({ page }, testInfo) => {
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
    // RC8: completion copy is "Created 5 departments" (number AFTER the
    // word), not "5 created" — accept either order.
    await expect(
      page.getByText(/(?:created\s+5|5\s+(?:created|success))/i).first(),
    ).toBeVisible({
      timeout: 60_000,
    });

    // Sanity-check via the API that all 5 codes landed and are active.
    const auth = loadAuth();
    const records = await searchByCodes(auth, codes);
    expect(records.length).toBe(5);
    for (const r of records) expect(r.isActive).not.toBe(false);
  });

  test('4. bulk import — duplicate code rejected client-side', {
    annotation: {
      type: 'description',
      description: `Bulk-import edge case: when an xlsx contains a row whose code already exists on the tenant, the duplicate row is flagged as Error/Invalid and the Create button reflects the reduced valid count (e.g. "Create 2 departments" instead of 3). Confirms client-side dedup happens BEFORE the create batch is sent.

Steps:
1. Seed an existing department via mdmsCreate; track for cleanup.
2. Generate 2 fresh codes; track for cleanup.
3. Build xlsx with 1 dup row + 2 fresh rows.
4. Navigate to /departments/bulk; upload.
5. Assert /already\\s+exists|duplicate/i text is visible within 30s.
6. Assert button matching /Create\\s+2\\s+(department|row)s?/i is visible (the dup is excluded from the count).

Catches a regression where the dup detection fails and all 3 rows would be sent — half of which would fail server-side.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    // First, seed an existing record via the API so we know its code is
    // already on the tenant.
    const auth = loadAuth();
    const existingCode = testCode(testInfo, 'DEPT_EXIST');
    createdCodes.add(existingCode);
    // Department schema is additionalProperties:false — no `description` key
    // (the sibling configurator-mdms-fixes spec asserts that rejection).
    await mdmsCreate(auth, TENANT_CODE, SCHEMA, existingCode, {
      code: existingCode,
      name: 'PW Existing',
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

  test('5a. Show page renders "Related" reverse references (complaint-types + employees)', {
    annotation: {
      type: 'description',
      description: `Asserts the Department Show page renders the "Related" section with both "Complaint Types" and "Employees" sub-lists. Both should render even when empty. Picks the first non-PW_ active department to probe — avoids depending on any specific seed code.

Steps:
1. mdmsSearch for active departments (limit 20).
2. Pick the first record where isActive !== false AND uniqueIdentifier doesn't start with 'PW_'.
3. test.skip if no such record.
4. Navigate to /departments/<code>/show.
5. Assert text /^Related$/i is visible.
6. Assert text /Complaint Types/i is visible.
7. Assert text /^Employees$/i is visible.

Doesn't assert what's INSIDE the related lists — that depends on tenant content. Only that the section structure renders.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    // Probe whichever real (non-scratch) department the deployment seeded —
    // avoids depending on any specific code.
    //
    // This used to page the schema unfiltered (`{ limit: 20 }`). On a
    // deployment polluted with soft-deleted PW_ scratch departments (measured
    // 147 rows, only 3 active) the first 20 rows are ALL inactive, so the
    // find() returned undefined and the test skipped permanently — the data
    // was present, just unreachable behind a page of junk. Push isActive to
    // the server so pagination runs over the ACTIVE set.
    const auth = loadAuth();
    const deptCandidates = await mdmsSearch(auth, TENANT_CODE, SCHEMA, {
      limit: 200,
      isActive: true,
    });
    const realDept = findRealRecord(deptCandidates);
    test.skip(!realDept, 'No seeded department to probe reverse references on');

    await page.goto(`${LIST_PATH}/${encodeURIComponent(realDept!.uniqueIdentifier)}/show`);

    // The "Related" section and both of its sub-lists.
    //
    // ReverseReferenceList renders EITHER "<Label>" + a count badge (when the
    // reverse lookup found rows) OR the sentence "No <label> found" (when it
    // didn't) — it never renders the bare label in the empty case. The old
    // assertion anchored on /^Employees$/i, which therefore could not match a
    // department with no employees assigned to it; it was unreachable rather
    // than wrong about the feature. Accept either rendering, which is what
    // "the section structure renders even when empty" actually means.
    await expect(page.getByText(/^Related$/i).first()).toBeVisible();
    await expect(
      page.getByText(/^(Complaint Types|No complaint types found)$/i).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/^(Employees|No employees found)$/i).first(),
    ).toBeVisible();
  });

  test('5b. deactivation guard probes designation + employee APIs', {
    annotation: {
      type: 'description',
      description: `Confirms the DeactivationGuard's two probes fire when an admin tries to deactivate a department: (1) it counts designations referencing the department (visible in the banner), and (2) it can reach HRMS to count employees. Seeds a designation linked to a fresh dept so the count is at least 1.

Steps:
1. Generate dept code + designation code; track dept for cleanup.
2. mdmsCreate a fresh Department; mdmsCreate a Designation linked to it.
3. Annotate the test with the seed designation code.
4. Navigate to /departments/<deptCode>/show; click Edit; uncheck Active.
5. Assert a banner matching /designation|depend|in use/i is visible within 10s.
6. Click Cancel — don't actually persist deactivation.
7. cleanupMdms the seeded designation inline (it's on a separate schema not handled by afterAll).
8. Sanity: employeeSearch with limit 1 — assert response is an array (HRMS reachable).

Tests both halves of the guard's data dependencies in one walk.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    // Seed a department with a designation linked to it, so the guard's
    // "designations referencing this department" probe returns >= 1.
    const auth = loadAuth();
    const deptCode = testCode(testInfo, 'DEPT_GUARD');
    createdCodes.add(deptCode);
    // No `description` — Department schema is additionalProperties:false.
    await mdmsCreate(auth, TENANT_CODE, SCHEMA, deptCode, {
      code: deptCode,
      name: `PW Guard Dept ${deptCode}`,
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

  test('5c. API update round-trip preserves auditDetails on a department', {
    annotation: {
      type: 'description',
      description: `Pure-API check that mdmsUpdate preserves the auditDetails block: lastModifiedTime should advance to >= the original createdTime. Ensures the data provider doesn't strip auditDetails (which would break list ordering by recency, related-row recency badges, etc).

Steps:
1. Generate a unique code; track for cleanup.
2. mdmsCreate a Department with name 'PW Audit <code>' (schema only allows {code, name, active}).
3. mdmsSearch for [code]; capture pre record.
4. Assert pre.auditDetails is truthy.
5. Dynamically import mdmsUpdate; mutate pre.data.name to 'PW Audit Edited via API'.
6. mdmsUpdate(auth, pre, true); capture updated.
7. Assert updated.data.name === 'PW Audit Edited via API'.
8. If both lastModifiedTime and createdTime are present, assert lastModifiedTime >= createdTime.

Pure-API — exercises the dataProvider logic the UI uses for save without going through the form. Uses the name field (not the dropped description) as the mutated field.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({}, testInfo) => {
    const auth = loadAuth();
    const code = testCode(testInfo, 'DEPT_AUDIT');
    createdCodes.add(code);

    // No `description` — Department schema is additionalProperties:false.
    await mdmsCreate(auth, TENANT_CODE, SCHEMA, code, {
      code,
      name: `PW Audit ${code}`,
      active: true,
    });

    // Fetch — bump the name via the UI-equivalent update path.
    const pre = (
      await mdmsSearch(auth, TENANT_CODE, SCHEMA, { uniqueIdentifiers: [code] })
    )[0];
    expect(pre).toBeTruthy();
    expect(pre.auditDetails).toBeTruthy();

    // Import on demand — keeps top-level imports tidy.
    const { mdmsUpdate } = await import('../utils/manage/api');
    pre.data = { ...pre.data, name: 'PW Audit Edited via API' };
    const updated = await mdmsUpdate(auth, pre, true);
    expect((updated.data as Record<string, unknown>).name).toBe(
      'PW Audit Edited via API',
    );
    // lastModifiedTime should advance (>= previous createdTime).
    const audit = updated.auditDetails as Record<string, number> | undefined;
    const preAudit = pre.auditDetails as Record<string, number> | undefined;
    if (audit?.lastModifiedTime && preAudit?.createdTime) {
      expect(audit.lastModifiedTime).toBeGreaterThanOrEqual(preAudit.createdTime);
    }
  });

  test('6. bulk export round-trip — downloaded xlsx parses', {
    annotation: {
      type: 'description',
      description: `Confirms the Export button on the Departments list produces a valid xlsx whose first sheet has the import template's header columns (code, name, description). Closes the import/export round-trip — same xlsx shape on both sides.

Steps:
1. Navigate to /configurator/manage/departments.
2. Set up a download promise; click Export button.
3. Await download; get download.path(); assert truthy.
4. Open the xlsx with ExcelJS; assert sheets[0] exists.
5. Read first row; lowercase the strings; assert headers includes 'code', 'name', 'description'.
6. Assert sheet.actualRowCount > 1 (at least header + one data row).

If a future build changes the export format (e.g. drops 'description'), the import flow would silently break — this test catches that.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
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
