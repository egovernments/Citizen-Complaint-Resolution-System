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
// The complaint-type resource is registered in the configurator as
// `complaint-hierarchy` (App.tsx <Resource name="complaint-hierarchy">, nav
// DigitLayout links "Complaint Types" → /manage/complaint-hierarchy). The
// legacy `/manage/complaint-types` path matches no react-admin resource and
// renders a blank content pane, so drive the real route.
const LIST_PATH = '/configurator/manage/complaint-hierarchy';

/**
 * The uniqueIdentifier a ComplaintHierarchy row is actually STORED under.
 *
 * mdms-v2 does NOT honour the `uniqueIdentifier` the client sends for this
 * schema — it derives one server-side as `<hierarchyType>.<code>`. Verified
 * directly: creating with uniqueIdentifier "PWPROBE325537" and
 * hierarchyType "COMPLAINT" persists the row as "COMPLAINT.PWPROBE325537",
 * and every seeded row carries the same shape ("PGR.BurningOfGarbage").
 *
 * So a _search for the bare code matches nothing, even though the create
 * returned 202 and the persister logged "Persisted 1 row(s) to DB!". Searches
 * and cleanup must use this derived form.
 */
const storedId = (code: string) => `${HIERARCHY_TYPE}.${code}`;

const createdCodes = new Set<string>();

// Scratch records this suite (and its predecessors) created are all prefixed
// PW_ / *_PW* by helpers/manage/codes. A long-lived deployment accumulates
// thousands of them, so "pick a real record" has to exclude them explicitly.
// Also match after a '.', because mdms-v2 stores ComplaintHierarchy ids as
// `<hierarchyType>.<code>` — so suite junk arrives as "PGR.PwsectorAbc...",
// where the old `(^|_)` anchor never fired and every scratch row counted as
// REAL data. Test 4 then picked a PW leaf whose department (PWD_abc) does not
// exist, failed to resolve it, and silently test.skip()'d instead of running.
const SCRATCH_CODE = /(^|[._])PW[A-Z_]/i;

/** Escape a live-resolved label before embedding it in a locator RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let liveDeptCode: string | null = null;

// Default mode (not serial): workers=1 keeps file order, but a failure no
// longer cascade-skips the rest. Tests 4 and 5 are independent of test 2 —
// 4 reads pre-existing data, 5 seeds via the API — so serial mode was
// downgrading their real results to "did not run" whenever the create form
// broke, which is exactly when their signal matters most.
test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  const auth = loadAuth();
  // Pick an existing active department to use as the `department` FK for
  // creates / bulk rows.
  //
  // This used to page the schema unfiltered (`{ limit: 50 }`) and then look
  // for the first row with isActive !== false. On a deployment polluted with
  // soft-deleted PW_ scratch departments — measured 147 rows, only 3 active —
  // the first 50 rows are ALL inactive, so liveDeptCode stayed null and tests
  // 2 and 5 skipped forever with "No active department seeded on tenant",
  // even though the tenant has perfectly good departments. Push isActive to
  // the server so pagination happens over the ACTIVE set, and prefer a
  // non-scratch department so the FK points at real tenant data.
  const depts = await mdmsSearch(auth, TENANT_CODE, DEPT_SCHEMA, {
    limit: 200,
    isActive: true,
  }).catch(() => [] as MdmsRecord[]);

  const codeOf = (d: MdmsRecord) =>
    ((d.data as Record<string, unknown>)?.code as string | undefined) ||
    d.uniqueIdentifier;
  const active = depts.filter((d) => d.isActive !== false && codeOf(d));
  const real = active.find(
    (d) => !SCRATCH_CODE.test(codeOf(d)!) && !SCRATCH_CODE.test(String(d.uniqueIdentifier)),
  );
  // Fall back to any active department — a scratch one still exercises the FK.
  liveDeptCode = codeOf(real || active[0]) ?? null;
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
    createdCodes.add(storedId(code));

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
      uniqueIdentifiers: [storedId(code)],
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
      uniqueIdentifiers: [storedId(code)],
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
      description: `Validates the Department filter on the complaint-types list: picking a department must narrow the rendered rows to exactly the complaint types that reference it.

Steps:
1. Via MDMS, find an active leaf complaint type carrying a \`department\` (preferring a non-scratch one), then resolve that department's display name from common-masters.Department. Skip only if the deployment has no such pairing at all.
2. Navigate to /configurator/manage/complaint-hierarchy; count the unfiltered DATA rows (rows containing role=cell).
3. Open the Department filter (a Radix combobox showing "Department" until a value is picked) and select the resolved department by name.
4. Assert the known complaint type's row survives the filter.
5. Assert EVERY rendered row references that department (label or code) — vacuously-true empty results are excluded by step 4.
6. Assert the row count strictly dropped versus the unfiltered list.

All row reads are auto-retrying expect()/expect.poll() — the grid debounces filter changes, so a bare count() straight after selecting reads the PRE-filter list.

The filter itself did not exist before: ComplaintTypeList passed no \`filters\` to DigitList, so this test skipped unconditionally on "Department filter not present on this build". It is now declared alongside SearchFilterInput, mirroring DesignationList.`,
    },
    tag: ['@area:configurator-manage', '@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    // Resolve the department to filter by from live data — never a literal.
    const auth = loadAuth();
    const [types, depts] = await Promise.all([
      mdmsSearch(auth, TENANT_CODE, SCHEMA, { limit: 500, isActive: true }),
      mdmsSearch(auth, TENANT_CODE, DEPT_SCHEMA, { limit: 200, isActive: true }),
    ]);

    const deptOf = (r: MdmsRecord) => {
      const raw = (r.data as Record<string, unknown>)?.department;
      return Array.isArray(raw) ? (raw[0] as string | undefined) : (raw as string | undefined);
    };
    // ComplaintHierarchy junk left by previous runs is created ACTIVE, so
    // isActive alone doesn't separate it from real data here — the PW_ prefix
    // does. Prefer a real leaf; fall back to any leaf with a department.
    const leaves = types.filter((r) => deptOf(r));
    const leaf =
      leaves.find((r) => !SCRATCH_CODE.test(String(r.uniqueIdentifier))) ?? leaves[0];
    const deptCode = leaf ? deptOf(leaf) : undefined;
    const deptRecord = depts.find(
      (d) =>
        String(d.uniqueIdentifier) === deptCode ||
        String((d.data as Record<string, unknown>)?.code ?? '') === deptCode,
    );
    test.skip(
      !leaf || !deptRecord,
      'No active complaint type linked to an active department on this deployment',
    );

    // The list renders the department via EntityLink, which shows the
    // department NAME when it resolves and falls back to the raw code when it
    // does not — accept either.
    const deptName = String(
      (deptRecord!.data as Record<string, unknown>)?.name ?? deptRecord!.uniqueIdentifier,
    );
    // The list's "Service Code" column renders the record's `code` field, NOT its
    // MDMS uniqueIdentifier. Those differ for ComplaintHierarchy because mdms-v2
    // derives the identifier as `<hierarchyType>.<code>` (see storedId above):
    //   uniqueIdentifier "PGR.BurningOfGarbage"  vs  code "BurningOfGarbage"
    // Matching the row on the identifier therefore never finds it, and the test
    // failed as though the department filter had hidden a row it never rendered.
    const serviceCode = String(
      (leaf!.data as Record<string, unknown>)?.code ?? leaf!.uniqueIdentifier,
    );

    await page.goto(LIST_PATH);

    // DATA rows only — the header row holds columnheaders, not cells.
    const dataRows = page.getByRole('row').filter({ has: page.getByRole('cell') });
    await expect(dataRows.first()).toBeVisible();
    const unfilteredCount = await dataRows.count();
    expect(unfilteredCount).toBeGreaterThan(0);

    // ReferenceFilterInput renders a Radix trigger with no <label> and no
    // accessible name — its only label is the SelectValue placeholder, so match
    // on the text it displays (the placeholder before selection, the chosen
    // department's name after).
    const filter = page
      .getByRole('combobox')
      .filter({ hasText: new RegExp(`^(Department|${escapeRe(deptName)})$`) })
      .first();
    await expect(filter).toBeVisible();
    await filter.click();
    await page.getByRole('option', { name: new RegExp(`^${escapeRe(deptName)}$`) }).click();

    // The known complaint type must survive the filter — this also rules out a
    // vacuously-true "every row matches" over an empty result set.
    await expect(dataRows.filter({ hasText: serviceCode }).first()).toBeVisible();

    // ...and every row left must reference that department.
    const needle = deptName.toLowerCase();
    const codeNeedle = String(deptCode).toLowerCase();
    await expect
      .poll(
        async () => {
          const texts = await dataRows.allTextContents();
          return (
            texts.length > 0 &&
            texts.every((t) => {
              const lower = t.toLowerCase();
              return lower.includes(needle) || lower.includes(codeNeedle);
            })
          );
        },
        { message: `every row should reference department "${deptName}"` },
      )
      .toBe(true);

    // And the list genuinely shrank.
    await expect
      .poll(() => dataRows.count(), { message: 'department filter should narrow the list' })
      .toBeLessThan(unfilteredCount);
  });

  test('5. tenant parity — api create at root is visible at city tenant', {
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
    createdCodes.add(storedId(code));

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
        uniqueIdentifiers: [storedId(code)], limit: 5,
      }),
      mdmsSearch(auth, CITY_TENANT, SCHEMA, {
        uniqueIdentifiers: [storedId(code)], limit: 5,
      }),
    ]);
    expect(atRoot.length, `should exist at ${TENANT_CODE}`).toBe(1);
    expect(
      atCity.length,
      `should also be visible at ${CITY_TENANT} (inheritance)`,
    ).toBe(1);
  });
});
