/**
 * Designation management — focused on the multi-department array shape.
 *
 * The pre-PR-5 regression collapsed `data.department` to a single string
 * when only one department was selected. These tests verify the schema
 * always sees a string[], including legacy single-string records being
 * coerced on save.
 */
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import {
  employeeSearch,
  loadAuth,
  mdmsCreate,
  mdmsSearch,
  mdmsUpdate,
  type AuthInfo,
  type MdmsRecord,
} from '../utils/manage/api';
import { testCode, testCodeIndexed } from '../utils/manage/codes';
import { cleanupMdms } from '../utils/manage/teardown';

const TENANT_CODE = process.env.TENANT_CODE || 'ke';
const DESIG_SCHEMA = 'common-masters.Designation';
const DEPT_SCHEMA = 'common-masters.Department';
const LIST_PATH = '/configurator/manage/designations';

const createdDesigCodes = new Set<string>();
const createdDeptCodes = new Set<string>();

// Two scratch departments shared by tests in this file.
let DEPT_A = '';
let DEPT_B = '';
let DEPT_C = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const auth = loadAuth();
  // Seed three departments via the API so tests don't depend on the
  // tenant having any specific codes (e.g. DEPT_14) live.
  DEPT_A = `PW_DESIG_DEPTA_${shortStamp()}`;
  DEPT_B = `PW_DESIG_DEPTB_${shortStamp(1)}`;
  DEPT_C = `PW_DESIG_DEPTC_${shortStamp(2)}`;

  for (const code of [DEPT_A, DEPT_B, DEPT_C]) {
    createdDeptCodes.add(code);
    await mdmsCreate(auth, TENANT_CODE, DEPT_SCHEMA, code, {
      code,
      name: `PW Dept for designation tests (${code})`,
      description: 'Seeded by designations.spec.ts',
      active: true,
    });
  }
});

test.afterAll(async () => {
  const auth = loadAuth();
  if (createdDesigCodes.size) {
    const r = await cleanupMdms(
      Array.from(createdDesigCodes),
      DESIG_SCHEMA,
      TENANT_CODE,
      auth,
    );
    if (r.failed.length) {
      // eslint-disable-next-line no-console
      console.warn('[designations] designation cleanup failures:', r.failed);
    }
  }
  if (createdDeptCodes.size) {
    const r = await cleanupMdms(
      Array.from(createdDeptCodes),
      DEPT_SCHEMA,
      TENANT_CODE,
      auth,
    );
    if (r.failed.length) {
      // eslint-disable-next-line no-console
      console.warn('[designations] department cleanup failures:', r.failed);
    }
  }
});

test.describe('manage/designations', () => {
  test('1. create with multi-department persists as a string[]', {
    annotation: {
      type: 'description',
      description: `Catches the pre-PR-5 regression: when only one department was selected on a Designation, data.department was collapsed to a bare string instead of a single-element array. This test creates a designation via UI with TWO departments and asserts MDMS stores it as exactly ["DEPT_A","DEPT_B"].

Steps:
1. Generate a unique code; track for cleanup.
2. Navigate to /designations/create; fill Name + Code + Description.
3. pickDepartmentChips([DEPT_A, DEPT_B]) — opens combobox, types each code, clicks each option.
4. Click Create; wait for navigation back to LIST_PATH.
5. mdmsSearch for [code]; assert exactly 1 record.
6. Read data.department; assert Array.isArray, length === 2, contains DEPT_A and DEPT_B.

Three departments seeded in beforeAll (DEPT_A/B/C) keep this test independent of tenant content.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const code = testCode(testInfo, 'DESIG_MULTI');
    createdDesigCodes.add(code);

    await page.goto(`${LIST_PATH}/create`);

    await page.getByLabel(/^Name/i).fill(`PW Multi ${code}`);
    const codeInput = page.getByLabel(/^Code/i);
    await codeInput.fill('');
    await codeInput.fill(code);
    await page.getByLabel(/^Description/i).fill('Multi-department designation');

    // Add two department chips via the combobox.
    await pickDepartmentChips(page, [DEPT_A, DEPT_B]);

    await Promise.all([
      page.waitForURL(LIST_PATH, { timeout: 30_000 }),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);

    // Verify shape via the API — the bug was a single string slipping
    // through; assert the stored value is exactly ["DEPT_A", "DEPT_B"].
    const auth = loadAuth();
    const records = await mdmsSearch(auth, TENANT_CODE, DESIG_SCHEMA, {
      uniqueIdentifiers: [code],
    });
    expect(records.length).toBe(1);
    const dept = (records[0].data as Record<string, unknown>).department;
    expect(Array.isArray(dept)).toBe(true);
    expect(dept).toEqual(expect.arrayContaining([DEPT_A, DEPT_B]));
    expect((dept as string[]).length).toBe(2);
  });

  test('2. edit round-trip preserves array shape (add then remove)', {
    annotation: {
      type: 'description',
      description: `Two-step edit round-trip on the department-array shape. Seeds with [A,B], adds C via UI, asserts [A,B,C], removes C via UI, asserts back to [A,B]. Confirms the array shape survives both add and remove flows through the dataProvider.

Steps:
1. Generate a unique code; track for cleanup.
2. Seed via mdmsCreate with department: [DEPT_A, DEPT_B].
3. Navigate to LIST_PATH; search; click row.
4. Click Edit; pickDepartmentChips([DEPT_C]); click Save.
5. mdmsSearch; assert dept is array, length === 3, contains all of A/B/C.
6. Click Edit again; removeDepartmentChip(DEPT_C); click Save.
7. mdmsSearch; assert dept is array, length === 2, contains A and B.

Pairs with create test #1 — together they cover all three mutation paths (create, add-on-edit, remove-on-edit).`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const code = testCode(testInfo, 'DESIG_EDIT');
    createdDesigCodes.add(code);

    // Seed via API with two departments — saves a UI step.
    const auth = loadAuth();
    await mdmsCreate(auth, TENANT_CODE, DESIG_SCHEMA, code, {
      code,
      name: `PW Edit ${code}`,
      description: 'For edit round-trip',
      department: [DEPT_A, DEPT_B],
      active: true,
    });

    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('row').filter({ hasText: code }).click();

    // Open edit, add a third chip.
    await page.getByRole('button', { name: /^Edit$/i }).click();
    await pickDepartmentChips(page, [DEPT_C]);
    await page.getByRole('button', { name: /^Save$/i }).click();

    // Re-read; should now be 3 entries.
    let records = await mdmsSearch(auth, TENANT_CODE, DESIG_SCHEMA, {
      uniqueIdentifiers: [code],
    });
    let dept = (records[0].data as Record<string, unknown>).department as string[];
    expect(Array.isArray(dept)).toBe(true);
    expect(dept.length).toBe(3);
    expect(dept).toEqual(expect.arrayContaining([DEPT_A, DEPT_B, DEPT_C]));

    // Now remove one chip via the UI and resave.
    await page.getByRole('button', { name: /^Edit$/i }).click();
    await removeDepartmentChip(page, DEPT_C);
    await page.getByRole('button', { name: /^Save$/i }).click();

    records = await mdmsSearch(auth, TENANT_CODE, DESIG_SCHEMA, {
      uniqueIdentifiers: [code],
    });
    dept = (records[0].data as Record<string, unknown>).department as string[];
    expect(Array.isArray(dept)).toBe(true);
    expect(dept.length).toBe(2);
    expect(dept).toEqual(expect.arrayContaining([DEPT_A, DEPT_B]));
  });

  test('3. legacy single-string department is coerced to array on save', {
    annotation: {
      type: 'description',
      description: `Handles legacy data: a record with department as a bare string (pre-PR-5 shape) must coerce to a single-element array when the form loads, AND saving without changes must persist the array shape. Critical for migrating in-place data without manual cleanup.

Steps:
1. Generate a unique code; track for cleanup.
2. Seed via mdmsCreate with department: DEPT_A (bare string, NOT array).
3. Navigate to LIST_PATH; search; click row; click Edit.
4. Assert exactly one chip rendering DEPT_A is visible (legacy string coerced into a one-chip array on form load).
5. Click Save (no changes).
6. mdmsSearch; assert dept is now Array.isArray and equals [DEPT_A].

The bare-string seed is required for this test — if the schema later rejects bare strings server-side, this test can't run without bypass and should be migrated.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const code = testCode(testInfo, 'DESIG_LEGACY');
    createdDesigCodes.add(code);

    const auth = loadAuth();
    // Pre-PR-5 shape: department is a bare string, not an array.
    await mdmsCreate(auth, TENANT_CODE, DESIG_SCHEMA, code, {
      code,
      name: `PW Legacy ${code}`,
      description: 'Legacy single-string department',
      department: DEPT_A,
      active: true,
    } as Record<string, unknown>);

    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('row').filter({ hasText: code }).click();

    await page.getByRole('button', { name: /^Edit$/i }).click();

    // Exactly one chip should render — the legacy string coerced into
    // a one-element array on load.
    const chip = page.getByText(DEPT_A, { exact: true });
    await expect(chip).toBeVisible();

    // Save without changes.
    await page.getByRole('button', { name: /^Save$/i }).click();

    // Re-read — now stored as ["DEPT_A"], not "DEPT_A".
    const records = await mdmsSearch(auth, TENANT_CODE, DESIG_SCHEMA, {
      uniqueIdentifiers: [code],
    });
    const dept = (records[0].data as Record<string, unknown>).department;
    expect(Array.isArray(dept)).toBe(true);
    expect(dept).toEqual([DEPT_A]);
  });

  test('4. department filter narrows list to designations referencing that code', {
    annotation: {
      type: 'description',
      description: `Validates the Department filter on the Designations list: picking DEPT_A must show only designations whose department array contains DEPT_A. Seeds two designations (one matching, one not) so the assertion is precise rather than environment-dependent.

Steps:
1. Generate two unique codes (codeA matching DEPT_A, codeOther matching DEPT_C); track for cleanup.
2. mdmsCreate both designations with the appropriate department arrays.
3. Navigate to LIST_PATH.
4. Locate Department filter; test.skip if absent.
5. Click filter, click DEPT_A option (fall back to typeahead if click fails).
6. Wait networkidle; type 'PW_' in the search to scope to seeded rows.
7. Assert codeA row is visible.
8. Assert codeOther row count === 0.

Filter-by-array logic — confirms the dataProvider sends the right query for chip values.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    // Seed two designations so we know there's exactly one matching DEPT_A
    // (besides the leftovers from earlier tests).
    const codeA = testCode(testInfo, 'DESIG_FILTA');
    const codeOther = testCode(testInfo, 'DESIG_FILTOTHER');
    createdDesigCodes.add(codeA);
    createdDesigCodes.add(codeOther);

    const auth = loadAuth();
    await mdmsCreate(auth, TENANT_CODE, DESIG_SCHEMA, codeA, {
      code: codeA, name: `PW FiltA ${codeA}`, description: 'matches DEPT_A',
      department: [DEPT_A], active: true,
    });
    await mdmsCreate(auth, TENANT_CODE, DESIG_SCHEMA, codeOther, {
      code: codeOther, name: `PW FiltOther ${codeOther}`, description: 'matches DEPT_C',
      department: [DEPT_C], active: true,
    });

    await page.goto(LIST_PATH);

    // Filter by DEPT_A. The departments filter is a select; if it's
    // missing on this build, the test logs and short-circuits — the
    // filter UI is part of the regression net but a missing widget is a
    // separate failure surface.
    const filter = page.getByLabel(/^Department/i).first();
    if (!(await filter.isVisible().catch(() => false))) {
      test.skip(true, 'Department filter not present on this build');
    }
    await filter.click();
    await page.getByRole('option', { name: DEPT_A }).click().catch(async () => {
      // Some builds use a typeahead — fall back to keyboard input.
      await page.keyboard.type(DEPT_A);
      await page.getByRole('option', { name: DEPT_A }).click();
    });
    await page.waitForLoadState('networkidle').catch(() => {});

    // codeA should appear; codeOther should not.
    await page.getByPlaceholder(/search/i).first().fill('PW_');
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page.getByRole('row').filter({ hasText: codeA })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: codeOther })).toHaveCount(0);
  });

  test('5. deactivation guard counts dependent records', {
    annotation: {
      type: 'description',
      description: `Confirms the DesignationEdit deactivation guard surfaces a banner mentioning dependent records (employees currently holding the designation). Doesn't pin a specific count — fresh tenants legitimately have 0 dependents — only that the banner shows up.

Steps:
1. Generate a unique code; track for cleanup.
2. Seed via mdmsCreate.
3. Navigate to LIST_PATH; search; click row; click Edit.
4. Uncheck Active.
5. Assert text /employee|depend|currently holding/i is visible within 10s.
6. Click Cancel — don't actually persist deactivation.
7. mdmsSearch; assert isActive !== false (record stayed active).

Cancel path is the contract: clicking Cancel must NOT silently persist the deactivation that was visible on the form.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    // Seed a designation referenced by no employees — the guard banner
    // appears regardless, but the count may legitimately be 0 on a
    // fresh tenant. We assert the BANNER is shown, not a specific count.
    const code = testCode(testInfo, 'DESIG_GUARD');
    createdDesigCodes.add(code);
    const auth = loadAuth();
    await mdmsCreate(auth, TENANT_CODE, DESIG_SCHEMA, code, {
      code, name: `PW Guard ${code}`, description: 'For deactivation guard',
      department: [DEPT_A], active: true,
    });

    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('row').filter({ hasText: code }).click();
    await page.getByRole('button', { name: /^Edit$/i }).click();

    await page.getByLabel(/^Active$/i).uncheck({ force: true });
    // Banner appears with dependency count (employees / others).
    await expect(
      page.getByText(/employee|depend|currently holding/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Cancel without saving — record stays active.
    await page.getByRole('button', { name: /^Cancel$/i }).click();

    const records = await mdmsSearch(auth, TENANT_CODE, DESIG_SCHEMA, {
      uniqueIdentifiers: [code],
    });
    expect(records[0].isActive).not.toBe(false);
  });

  test('5a. department chip input dropdown loads options from mdms', {
    annotation: {
      type: 'description',
      description: `Confirms the department chip combobox actually fetches options from MDMS (common-masters.Department). Opening the combobox and typing a known department code (DEPT_A) must produce at least one matching option in the dropdown.

Steps:
1. Navigate to /designations/create.
2. Locate getByLabel(/^Departments?/i); click to open the combobox.
3. Fill DEPT_A.
4. Assert getByRole('option', name: regex DEPT_A) is visible within 10s.

If options never appear, the data provider for the typeahead is broken — even a perfect form layout would be unusable.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    await page.goto(`${LIST_PATH}/create`);

    // Opening the combobox should fetch department options via
    // mdms-v2 _search(common-masters.Department). The seeded DEPT_A
    // should appear once the dropdown is open.
    const input = page.getByLabel(/^Departments?/i);
    await input.click();
    await input.fill(DEPT_A);
    // At least one option should match our seeded DEPT_A.
    await expect(
      page.getByRole('option', { name: new RegExp(DEPT_A) }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('5b. show page renders department chips for a multi-dept designation', {
    annotation: {
      type: 'description',
      description: `Asserts the Designation Show page renders both department codes when the underlying record has a multi-department array. Catches a regression where the show layout collapses to displaying only the first department.

Steps:
1. Generate a unique code; track for cleanup.
2. mdmsCreate with department: [DEPT_A, DEPT_B].
3. Navigate to /designations/<code>/show.
4. Assert text containing DEPT_A is visible.
5. Assert text containing DEPT_B is visible.

Loose exact:false match tolerates surrounding chip styling. Pairs with the multi-create test (#1) — together they cover both write and read paths for the array.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const code = testCode(testInfo, 'DESIG_SHOW');
    createdDesigCodes.add(code);

    const auth = loadAuth();
    await mdmsCreate(auth, TENANT_CODE, DESIG_SCHEMA, code, {
      code,
      name: `PW Show ${code}`,
      description: 'For show-page chip rendering',
      department: [DEPT_A, DEPT_B],
      active: true,
    });

    await page.goto(`${LIST_PATH}/${encodeURIComponent(code)}/show`);
    // Both department codes should be rendered on the Show page.
    await expect(page.getByText(DEPT_A, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(DEPT_B, { exact: false }).first()).toBeVisible();
  });

  test('5c. API soft-delete (isActive=false) removes row from active list', {
    annotation: {
      type: 'description',
      description: `Confirms the dataProvider.mdmsGetList filters out isActive=false records so that an API soft-delete causes the row to disappear from the default list view in the UI. Tests the full pipeline: API soft-delete → list re-fetch → UI excludes the row.

Steps:
1. Generate a unique code; track for cleanup.
2. mdmsCreate (active: true).
3. mdmsSearch for the record; assert truthy.
4. mdmsUpdate(auth, pre, false) (soft-delete via isActive=false).
5. Assert returned record has isActive === false.
6. Navigate to LIST_PATH; type the code in search; wait networkidle.
7. Assert the row count for that code is 0 in the UI.

If the soft-delete persists but the UI still shows the row, the dataProvider's isActive filter is broken.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const code = testCode(testInfo, 'DESIG_SOFTDEL');
    createdDesigCodes.add(code);
    const auth = loadAuth();

    await mdmsCreate(auth, TENANT_CODE, DESIG_SCHEMA, code, {
      code,
      name: `PW SoftDel ${code}`,
      description: 'soft-delete probe',
      department: [DEPT_A],
      active: true,
    });

    // Soft-delete via the MDMS _update endpoint.
    const pre = (
      await mdmsSearch(auth, TENANT_CODE, DESIG_SCHEMA, { uniqueIdentifiers: [code] })
    )[0];
    expect(pre).toBeTruthy();
    const updated = await mdmsUpdate(auth, pre, false);
    expect(updated.isActive).toBe(false);

    // The dataProvider.mdmsGetList filters out isActive=false rows, so
    // the default list view should no longer show this code.
    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    const rows = page.getByRole('row').filter({ hasText: code });
    expect(await rows.count()).toBe(0);
  });

  test('5d. HRMS probe returns assignments.designation for guard counter', {
    annotation: {
      type: 'description',
      description: `Schema-stability check for the HRMS field that the DesignationEdit guard reads. The guard calls /employees with filter[assignments.designation]=...; this test asserts HRMS returns assignments[].designation as string|null|undefined (anything else would be a regression breaking the guard's counter).

Steps:
1. employeeSearch(TENANT_CODE, { limit: 5 }); assert response is an array.
2. If the array has at least one employee, capture its assignments.
3. Assert assignments is an array.
4. If assignments is non-empty, read the first assignment's designation.
5. Assert d === null OR d === undefined OR typeof d === 'string'.

Loose check — allows the field to be missing on legacy assignments, but rejects anything other than the expected scalar shape.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async () => {
    // The DeactivationGuard for a designation (implemented in
    // DesignationEdit) calls employees?filter[assignments.designation]=...
    // Verify HRMS returns the `assignments.designation` field that the
    // probe reads. We don't care about the specific count — we care that
    // the endpoint + shape are stable.
    const auth = loadAuth();
    const employees = await employeeSearch(auth, TENANT_CODE, { limit: 5 });
    expect(Array.isArray(employees)).toBe(true);
    // If at least one employee exists on the tenant, its assignments[]
    // should carry a `designation` field (even if null).
    if (employees.length) {
      const e = employees[0] as Record<string, unknown>;
      const assignments = e.assignments as Array<Record<string, unknown>> | undefined;
      expect(Array.isArray(assignments)).toBe(true);
      // `designation` key may be missing on assignments that predate the
      // schema, but the field must be representable — accept string |
      // null | undefined. A non-string / non-null object would be a
      // regression.
      if (assignments && assignments.length) {
        const d = assignments[0].designation;
        expect(d === null || d === undefined || typeof d === 'string').toBe(true);
      }
    }
  });

  test('6. bulk import accepts comma-list department values as array', {
    annotation: {
      type: 'description',
      description: `Bulk-import contract: the xlsx accepts a single 'department' column whose value is a comma-separated list (e.g. "DEPT_A, DEPT_B"). After import, MDMS stores it as an actual array, not as the literal string. Confirms the bulk parser splits on commas and trims.

Steps:
1. Generate a unique code; track for cleanup.
2. Build xlsx via buildDesignationXlsx with one row carrying department: "DEPT_A, DEPT_B".
3. Navigate to /designations/bulk; setInputFiles.
4. Wait for /1\\s*(valid|row)/i within 30s.
5. Click button matching /Create\\s+\\d+\\s+(designation|row)s?/i.
6. Wait for /1\\s*(created|success)/i within 60s.
7. mdmsSearch; assert exactly 1 record.
8. Read data.department; assert Array.isArray and contains DEPT_A and DEPT_B.

Critical for tenant onboarding workflows that use comma-list xlsx as their canonical seed format.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const code = testCode(testInfo, 'DESIG_BULK');
    createdDesigCodes.add(code);

    // Build XLSX with a department column carrying two codes.
    const buffer = await buildDesignationXlsx([
      {
        code,
        name: `PW Bulk ${code}`,
        description: 'Bulk import multi-dept',
        department: `${DEPT_A}, ${DEPT_B}`,
      },
    ]);

    await page.goto(`${LIST_PATH}/bulk`);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'designations.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });

    await expect(page.getByText(/1\s*(valid|row)/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', {
      name: /Create\s+\d+\s+(designation|row)s?/i,
    }).click();
    await expect(page.getByText(/1\s*(created|success)/i).first()).toBeVisible({
      timeout: 60_000,
    });

    const auth = loadAuth();
    const records = await mdmsSearch(auth, TENANT_CODE, DESIG_SCHEMA, {
      uniqueIdentifiers: [code],
    });
    expect(records.length).toBe(1);
    const dept = (records[0].data as Record<string, unknown>).department as string[];
    expect(Array.isArray(dept)).toBe(true);
    expect(dept).toEqual(expect.arrayContaining([DEPT_A, DEPT_B]));
  });
});

// --- Local helpers ---

function shortStamp(salt = 0): string {
  return Math.floor(Date.now() / 1000 + salt)
    .toString(36)
    .toUpperCase();
}

/**
 * Pick one or more department chips from the combobox. Types the code,
 * waits for the option, clicks it. Repeats per code.
 */
async function pickDepartmentChips(
  page: import('@playwright/test').Page,
  codes: string[],
): Promise<void> {
  const combobox = page.getByRole('combobox').filter({
    has: page.locator(':scope'),
  }).first();
  // Above is overcautious; fall back to the labeled control.
  const input = (await combobox.count())
    ? combobox
    : page.getByLabel(/^Departments?/i);

  for (const code of codes) {
    await input.click();
    await input.fill(code);
    // The listbox option matches code text exactly.
    await page.getByRole('option', { name: new RegExp(code) }).first().click();
    // Clear the input ready for the next pick.
    await input.fill('');
  }
}

async function removeDepartmentChip(
  page: import('@playwright/test').Page,
  code: string,
): Promise<void> {
  // Each chip renders the code text followed by a remove button. Match
  // a remove button (× or "Remove") sibling within the chip.
  const chip = page.locator('[role="listitem"], li, span').filter({ hasText: code }).first();
  // The chip's remove control is usually a button or icon nested inside.
  const removeBtn = chip.getByRole('button').first();
  if (await removeBtn.count()) {
    await removeBtn.click();
  } else {
    // Fall back to clicking an × character close to the chip.
    await page.locator('button').filter({ hasText: /^×$/ }).first().click();
  }
}

async function buildDesignationXlsx(
  rows: Array<{
    code: string; name: string; description: string; department: string;
  }>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Designation');
  sheet.addRow(['code', 'name', 'description', 'department']);
  for (const r of rows) sheet.addRow([r.code, r.name, r.description, r.department]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// Silence unused import warnings for AuthInfo / MdmsRecord which surface
// when the file is read in isolation but matter for type stability.
export type _Reexport = AuthInfo | MdmsRecord;
