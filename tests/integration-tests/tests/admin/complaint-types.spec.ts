/**
 * Complaint-type management — list / create / bulk-import / dept filter /
 * tenant parity.
 *
 * Backed by MDMS schema `RAINMAKER-PGR.ComplaintHierarchy` — one adjacency list
 * of interior nodes AND leaf complaint types. Complaint types are the LEAF rows
 * (those carrying department/slaHours); a leaf's `code` is the serviceCode stored
 * on a complaint, verbatim, and the leaf's unique identifier in MDMS. At Nai Pepea
 * time of writing the tenant has 37 seeded types at BOTH `ke` and `ke.nairobi`
 * (MDMS v2 inherits root → city, so creates at `ke` surface at
 * `ke.nairobi` automatically — probed 2026-04-23). TASKS.md §2.5 calls
 * for registration at BOTH levels; these tests verify the row is visible
 * from a city-level search after a root-level create.
 */
import { test, expect } from '@playwright/test';
import {
  loadAuth,
  mdmsCreate,
  mdmsSearch,
  type MdmsRecord,
} from '../utils/manage/api';
import { testCode } from '../utils/manage/codes';
import { cleanupMdms } from '../utils/manage/teardown';
import { ROOT_TENANT, CITY_TENANT } from '../utils/env';

const TENANT_CODE = ROOT_TENANT;
const SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchy';
const DEPT_SCHEMA = 'common-masters.Department';
// Leaf complaint types created in tests link under this parent category node.
// (Grouping key replaces the legacy menuPath; a real leaf row carries parentCode.)
const LEAF_PARENT_CODE = 'Complaint';
const LEAF_LEVEL_CODE = 'SUB_TYPE';
const HIERARCHY_TYPE = 'PGR';
const LIST_PATH = '/configurator/manage/complaint-types';

const createdCodes = new Set<string>();

let liveDeptCode: string | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const auth = loadAuth();
  // Pick an existing active department to use as the `department` FK for
  // creates / bulk rows. The live tenant carries ~31 seeded departments.
  const depts = await mdmsSearch(auth, TENANT_CODE, DEPT_SCHEMA, { limit: 50 }).catch(
    () => [] as MdmsRecord[],
  );
  for (const d of depts) {
    if (d.isActive === false) continue;
    const code = (d.data as Record<string, unknown>).code as string | undefined;
    if (code) { liveDeptCode = code; break; }
  }
});

test.afterAll(async () => {
  if (createdCodes.size === 0) return;
  const auth = loadAuth();
  const r = await cleanupMdms(Array.from(createdCodes), SCHEMA, TENANT_CODE, auth);
  if (r.failed.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[complaint-types] cleanup left ${r.failed.length} record(s) behind:`,
      r.failed,
    );
  }
});

test.describe('manage/complaint-types', () => {
  test('1. list renders with Service Code / Name / Department / SLA / Status columns', {
    annotation: {
      type: 'description',
      description: `Smoke check that /manage/complaint-types renders with all five expected column headers (Service Code, Name, Department, SLA, Status) AND that MDMS itself returns at least one record. Catches the case where either the UI list breaks or the underlying RAINMAKER-PGR.ComplaintHierarchy schema has no leaf rows.

Steps:
1. Navigate to /configurator/manage/complaint-types.
2. Assert role=table is visible.
3. For each of ['Service Code','Name','Department','SLA','Status'], assert the matching role=columnheader is visible.
4. Assert getByRole('row') count > 1 (header + data).
5. mdmsSearch via API (limit 200); assert live.length > 0.

Healthy Nai Pepea tenant has 37 seeded types — the count check is loose (> 1) to tolerate fresh deployments.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    await page.goto(LIST_PATH);

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    for (const header of ['Service Code', 'Name', 'Department', 'SLA', 'Status']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(header, 'i') }),
      ).toBeVisible();
    }

    // Healthy tenant has 37 seeded types; at least >1 rows means the list
    // is rendering data, not just the header.
    const rows = page.getByRole('row');
    expect(await rows.count()).toBeGreaterThan(1);

    // API sanity — live MDMS count should also be non-empty.
    const auth = loadAuth();
    const live = await mdmsSearch(auth, TENANT_CODE, SCHEMA, { limit: 200 });
    expect(live.length).toBeGreaterThan(0);
  });

  test('2. create → edit → deactivate round-trip; visible at city tenant', {
    annotation: {
      type: 'description',
      description: `Drives the full UI round-trip: create a complaint type at root tenant, verify it inherits to the city tenant via MDMS v2, edit its SLA from 24 to 72 hours through the form, and confirm the change persists. Skips if no active department exists on the tenant (prerequisite for the dept FK).

Steps:
1. test.skip if !liveDeptCode (beforeAll picks first active dept).
2. Generate a unique code + name; track for cleanup.
3. Navigate to /complaint-types/create; fill Complaint Sub-Type (the field formerly labelled "Name"), Service Code, pick Department option, set SLA=24.
4. Click Create; wait for navigation back to LIST_PATH.
5. mdmsSearch at CITY_TENANT for [code]; assert at least 1 hit (proves root → city inheritance).
6. Search for the code in the list; click the row to open detail.
7. Click Edit; set SLA to 72; click Save.
8. Assert text 72 is visible.
9. mdmsSearch at TENANT_CODE for [code]; assert data.slaHours === 72.

Cleanup is API-only — soft-deletes via cleanupMdms in afterAll because there's no UI delete affordance for complaint types.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    if (!liveDeptCode) test.skip(true, 'No active department seeded on tenant');

    // PascalCase kind — DigitFormCodeInput strips non-alphanumerics when
    // deriving the code from the name.
    const code = testCode(testInfo, 'CT_RT');
    const name = `PW Roundtrip ${code}`;
    createdCodes.add(code);

    await page.goto(`${LIST_PATH}/create`);
    // The complaint-type name field was renamed "Name" → "Complaint Sub-Type".
    await page.getByLabel(/^Complaint Sub-Type/i).fill(name);

    const codeInput = page.getByLabel(/Service Code/i);
    await codeInput.fill('');
    await codeInput.fill(code);

    // Department select — typeahead or click + pick first option matching
    // our scratch dept code.
    const deptSelect = page.getByLabel(/^Department/i);
    await deptSelect.click();
    const deptOption = page.getByRole('option', { name: new RegExp(liveDeptCode!, 'i') }).first();
    if (await deptOption.isVisible().catch(() => false)) {
      await deptOption.click();
    } else {
      // Fall back to first option.
      await page.getByRole('option').first().click();
    }

    await page.getByLabel(/SLA/i).fill('24');

    await Promise.all([
      page.waitForURL(LIST_PATH, { timeout: 30_000 }),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);

    // Verify via MDMS API at the city tenant — MDMS v2 inherits root → city.
    const auth = loadAuth();
    const cityHit = await mdmsSearch(auth, CITY_TENANT, SCHEMA, {
      uniqueIdentifiers: [code],
      limit: 5,
    });
    expect(
      cityHit.length,
      `complaint-type created at ${TENANT_CODE} should be visible from ${CITY_TENANT}`,
    ).toBeGreaterThan(0);

    // --- Edit SLA ---
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toBeVisible();
    await row.click();

    await page.getByRole('button', { name: /^Edit$/i }).click();
    const sla = page.getByLabel(/SLA/i);
    await sla.fill('72');
    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByText(/72/)).toBeVisible();

    // --- Verify SLA persisted via MDMS ---
    const afterEdit = await mdmsSearch(auth, TENANT_CODE, SCHEMA, {
      uniqueIdentifiers: [code],
      limit: 5,
    });
    expect(afterEdit.length).toBeGreaterThan(0);
    expect((afterEdit[0].data as Record<string, unknown>).slaHours).toBe(72);
  });

  // NOTE: the former test 3 ("bulk import — happy path") was removed — there
  // is no /complaint-types/bulk route (App.tsx only wires bulk import for
  // employees, departments, designations, and localization). Complaint types
  // are created one at a time via the ComplaintTypeCreate form (test 2) or
  // seeded via MDMS directly (test 5).

  test('4. department reference filter narrows the list', {
    annotation: {
      type: 'description',
      description: `Validates the Department filter on the complaint-types list: picking a department option must narrow the rendered rows so each row references that department (either label or code). Skips if the filter isn't implemented on the current build.

Steps:
1. Navigate to /configurator/manage/complaint-types.
2. Locate getByLabel(/^Department/i); test.skip if not visible.
3. Click the filter; capture the first option's text label; click it.
4. Wait for networkidle.
5. Read row count; if <=1 return early (filter validly returned 0 rows).
6. For up to 5 sample rows, read text content and assert it (lowercased) includes the dept label (lowercased).

Loose label-match — works whether the row renders the dept code, dept name, or both.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(LIST_PATH);

    const filter = page.getByLabel(/^Department/i).first();
    if (!(await filter.isVisible().catch(() => false))) {
      test.skip(true, 'Department filter not present on this build');
    }

    await filter.click();
    const firstOpt = page.getByRole('option').first();
    const deptLabel = ((await firstOpt.textContent()) || '').trim();
    await firstOpt.click();
    await page.waitForLoadState('networkidle').catch(() => {});

    const rows = page.getByRole('row');
    const n = await rows.count();
    if (n <= 1) return; // filter validly returned 0 rows

    // Spot-check up to 5 rows — each should contain either the dept label
    // or the dept code in its text content.
    const sample = Math.min(5, n - 1);
    for (let i = 1; i <= sample; i++) {
      const t = ((await rows.nth(i).textContent()) || '').toLowerCase();
      expect(
        t.includes(deptLabel.toLowerCase()),
        `row ${i} should match dept filter "${deptLabel}"`,
      ).toBe(true);
    }
  });

  test('5. tenant parity — api create at ke is visible at ke.nairobi', {
    annotation: {
      type: 'description',
      description: `Pure-API check guarding TASKS.md §2.5: complaint types registered at root tenant must surface at city level via MDMS v2 inheritance. Skips the UI entirely so the test catches inheritance regressions even when the form is half-wired.

Steps:
1. test.skip if !liveDeptCode.
2. Generate a unique code; track for cleanup.
3. mdmsCreate at TENANT_CODE (root) with a full ComplaintHierarchy leaf-row payload (code, hierarchyType, levelCode, parentCode, path, name, active, keywords, slaHours=24, department=liveDeptCode).
4. In parallel: mdmsSearch at TENANT_CODE for [code] and mdmsSearch at CITY_TENANT for [code].
5. Assert atRoot.length === 1.
6. Assert atCity.length === 1 (proves inheritance).

If atRoot=1 but atCity=0, MDMS v2 inheritance is broken for this schema — a serious regression that breaks the whole "register once at root" model.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
  }, testInfo) => {
    if (!liveDeptCode) test.skip(true, 'No active department seeded on tenant');

    // API-only check — guards the TASKS.md §2.5 requirement that types
    // registered at root surface at city level. Skips the UI entirely so
    // we catch inheritance regressions even if the form is half-wired.
    const auth = loadAuth();
    const code = testCode(testInfo, 'CT_PARITY');
    createdCodes.add(code);

    // Leaf-row shape for RAINMAKER-PGR.ComplaintHierarchy: `code` is the
    // serviceCode (verbatim) and the MDMS unique identifier; parentCode/path
    // place it under a category node; department/slaHours mark it as a leaf.
    await mdmsCreate(auth, TENANT_CODE, SCHEMA, code, {
      hierarchyType: HIERARCHY_TYPE,
      levelCode: LEAF_LEVEL_CODE,
      code,
      parentCode: LEAF_PARENT_CODE,
      name: 'PW Parity Type',
      order: 1,
      active: true,
      path: `${LEAF_PARENT_CODE}.${code}`,
      keywords: 'parity',
      slaHours: 24,
      department: liveDeptCode!,
    });

    const [atRoot, atCity] = await Promise.all([
      mdmsSearch(auth, TENANT_CODE, SCHEMA, {
        uniqueIdentifiers: [code], limit: 5,
      }),
      mdmsSearch(auth, CITY_TENANT, SCHEMA, {
        uniqueIdentifiers: [code], limit: 5,
      }),
    ]);
    expect(atRoot.length, `should exist at ${TENANT_CODE}`).toBe(1);
    expect(
      atCity.length,
      `should also be visible at ${CITY_TENANT} (inheritance)`,
    ).toBe(1);
  });
});
