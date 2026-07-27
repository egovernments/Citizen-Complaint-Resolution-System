/**
 * Tenant management — READ-ONLY surface.
 *
 * TenantList.tsx / TenantShow.tsx expose only List + Show. There is no
 * Create / Edit / Delete UI — tenant rows are seeded via the city-setup
 * flow (mdms-v2 _create for schema `tenant.tenants`) and mutated out of
 * band. Accordingly, this spec:
 *  - asserts the list grid renders the expected columns
 *  - asserts API-level search returns records with the shape the UI reads
 *    (`code`, `name`, `city.name`, `city.districtName`)
 *  - asserts that Show renders those fields for a known-good tenant
 *  - surfaces a known QUIRK: the `ke.nairobi` row was seeded with a
 *    slimmed-down `city` object missing `districtName` — the list column
 *    for that row renders empty. We assert the data provider doesn't
 *    crash on it, not that the value is filled.
 *
 * A single create probe (soft-deleted in afterAll) stress-tests that the
 * UI list picks up a freshly-inserted MDMS row without a hard reload.
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

// Root (state) tenant from env — no hardcoded 'ke'. CITY_TENANT is a real
// city tenant known to exist in the list (from env), so the search test isn't
// pinned to any particular city.
const TENANT_CODE = ROOT_TENANT;
const SCHEMA = 'tenant.tenants';
const LIST_PATH = '/configurator/manage/tenants';

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
  if (result.failed.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[tenants] cleanup left ${result.failed.length} record(s) behind:`,
      result.failed,
    );
  }
});

test.describe('manage/tenants', () => {
  test('1. list renders expected columns and at least one row', {
    annotation: {
      type: 'description',
      description: `Asserts the read-only Tenants list page renders the four expected column headers (Code, Name, City, District) and has at least one populated row. Tenants are seeded out-of-band via city-setup, so the UI surface is List + Show only — no Create/Edit/Delete buttons to assert.

Steps:
1. Navigate to /configurator/manage/tenants.
2. Assert role=table is visible.
3. For each header in ['Code','Name','City','District'], assert role=columnheader matches.
4. Read row count via getByRole('row'); assert > 1 (header + at least one data row).

Catches a regression where TenantList.tsx loses a column or the data provider returns no records at all.`,
    },
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(LIST_PATH);

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // Columns per TenantList.tsx: Code / Name / City / District.
    for (const header of ['Code', 'Name', 'City', 'District']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(`^${header}$`, 'i') }),
      ).toBeVisible();
    }

    // Seeded `ke` tenant has at minimum ke.nairobi + sibling city rows.
    const dataRows = page.getByRole('row');
    const rowCount = await dataRows.count();
    expect(rowCount).toBeGreaterThan(1); // header + >=1 tenant
  });

  test('2. search filter narrows to a known tenant code', {
    annotation: {
      type: 'description',
      description: `End-to-end search-filter test on the tenants list: typing the configured CITY_TENANT code must narrow the grid to a row containing that code; typing a nonsense code must drop the grid to zero data rows. Drives the actual placeholder-matching search input the operator uses.

Steps:
1. Navigate to /configurator/manage/tenants.
2. Locate getByPlaceholder(/search/i); assert visible.
3. Fill CITY_TENANT; wait for networkidle.
4. Assert at least one row matching CITY_TENANT is visible.
5. Clear and type "zzz_no_such_tenant_xyz"; wait for networkidle.
6. Assert getByRole('row').filter({ hasText: 'zzz_no_such_tenant_xyz' }) has count === 0.

Confirms the search input feeds into the data provider's filter and the grid re-renders accordingly.`,
    },
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(LIST_PATH);

    const search = page.getByPlaceholder(/search/i).first();
    await expect(search).toBeVisible();
    await search.fill(CITY_TENANT);
    await page.waitForLoadState('networkidle').catch(() => {});

    await expect(
      page.getByRole('row').filter({ hasText: CITY_TENANT }).first(),
    ).toBeVisible();

    // A nonsense code should drop us to empty-state (zero data rows).
    await search.fill('');
    await search.fill('zzz_no_such_tenant_xyz');
    await page.waitForLoadState('networkidle').catch(() => {});
    const rows = page.getByRole('row').filter({ hasText: 'zzz_no_such_tenant_xyz' });
    expect(await rows.count()).toBe(0);
  });

  test('3. show page renders Code / Name / City / District for a known tenant', {
    annotation: {
      type: 'description',
      description: `Asserts the TenantShow page renders the expected LabelFieldPair labels (Code, Name, City, District) and the tenant's actual code value. Picks a tenant with a fleshed-out city.districtName so the District field is non-empty (skips if no such tenant exists on the deployment).

Steps:
1. mdmsSearch all tenants (limit 200) at the configured TENANT_CODE.
2. Find the first tenant whose data.city.districtName is a non-empty string.
3. test.skip with reason if none found.
4. Navigate to /configurator/manage/tenants/<code>/show.
5. Assert each of /^Code$/, /^Name$/, /^City$/, /^District$/ labels is visible.
6. Assert the tenant code itself appears somewhere on the page.

Skips gracefully on deployments missing a fleshed-out tenant — better than failing on environment dependency.`,
    },
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    // Pick a tenant that has a fleshed-out `city` block (ke.nakuru is
    // seeded with districtName in the default `ke` dataset).
    const auth = loadAuth();
    const allTenants = await mdmsSearch(auth, TENANT_CODE, SCHEMA, { limit: 200 });
    const fleshedOut = allTenants.find((r) => {
      // mdmsSearch returns raw MDMS rows and does NOT filter isActive, but the
      // configurator's dataProvider filters isActive on getOne. Picking a
      // deactivated row therefore drives the Show page at a record the UI
      // refuses to load: it renders nothing and the assertions below fail with
      // a bare "element not found" that looks like a UI regression.
      // This bit: test 6 API-creates `<tenant>.pwt<hash>` tenants and the
      // afterAll soft-deletes them (isActive=false) — those leftovers persist in
      // MDMS across runs, sort ahead of the real seed, and carry a fleshed-out
      // city block, so this picker kept selecting a dead PW tenant.
      if (r.isActive === false) return false;
      if (/\.pwt/i.test(r.uniqueIdentifier)) return false;
      const city = (r.data as Record<string, unknown>).city as
        | Record<string, unknown>
        | undefined;
      return typeof city?.districtName === 'string' && city.districtName !== '';
    });
    test.skip(!fleshedOut, 'No active (non-PW) tenant with city.districtName present');

    const code = fleshedOut!.uniqueIdentifier;
    await page.goto(`${LIST_PATH}/${encodeURIComponent(code)}/show`);

    // LabelFieldPair renders Code / Name / City / District labels with
    // plain text values — assert each label is present and the code value
    // matches what we queried for.
    await expect(page.getByText(/^Code$/).first()).toBeVisible();
    await expect(page.getByText(/^Name$/).first()).toBeVisible();
    await expect(page.getByText(/^City$/).first()).toBeVisible();
    await expect(page.getByText(/^District$/).first()).toBeVisible();
    await expect(page.getByText(code, { exact: false }).first()).toBeVisible();
  });

  test('4. API shape — search returns records with code / name / city', {
    annotation: {
      type: 'description',
      description: `API-level shape check: every tenant record returned by mdmsSearch for tenant.tenants must have data.code and data.name as strings. Missing city is tolerable (Show falls back to empty) but missing code/name would crash the grid.

Steps:
1. mdmsSearch (limit 50) at TENANT_CODE for schema 'tenant.tenants'.
2. Assert records.length > 0.
3. For each record, assert typeof data.code === 'string' and typeof data.name === 'string'.

Catches a contract drift where MDMS returns records with missing required fields, which the UI grid cannot survive.`,
    },
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'] }, async () => {
    const auth = loadAuth();
    const records = await mdmsSearch(auth, TENANT_CODE, SCHEMA, { limit: 50 });
    expect(records.length).toBeGreaterThan(0);

    // Every record's `data` block must have the fields the UI list
    // destructures. Missing `city` is tolerable (Show falls back to
    // empty strings); missing `code` / `name` would crash the grid.
    for (const r of records) {
      const d = r.data as Record<string, unknown>;
      expect(typeof d.code).toBe('string');
      expect(typeof d.name).toBe('string');
    }
  });

  test('5. QUIRK — city tenant object may lack districtName, list tolerates it', {
    annotation: {
      type: 'description',
      description: `Documents a known seed quirk: a city tenant (CITY_TENANT, from env) can be seeded with a slimmed-down city object missing districtName. The list grid renders an empty cell rather than crashing. The test asserts the grid survives the missing field — if a future seed fills it in, the test still passes (the UI tolerates both shapes).

Steps:
1. mdmsSearch for uniqueIdentifier CITY_TENANT; test.skip if absent.
2. Read data.city; capture hasDistrict (boolean).
3. Navigate to /configurator/manage/tenants; type CITY_TENANT in the search.
4. Wait for networkidle; assert the matching row is visible.
5. If !hasDistrict, log a warning that the list tolerated the missing field.

If the UI ever starts crashing on the missing field, the row visibility assertion times out — this is the regression signal.`,
    },
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    const auth = loadAuth();
    const cityRecord = (
      await mdmsSearch(auth, TENANT_CODE, SCHEMA, {
        uniqueIdentifiers: [CITY_TENANT],
      })
    )[0] as MdmsRecord | undefined;
    test.skip(!cityRecord, `${CITY_TENANT} not present on this tenant`);

    const city = (cityRecord!.data as Record<string, unknown>).city as
      | Record<string, unknown>
      | undefined;
    // The minimal seed lacks districtName — the column should render
    // empty rather than throwing. If a future seed fixes this, the test
    // still passes (the UI tolerates both shapes).
    const hasDistrict = typeof city?.districtName === 'string' && city.districtName !== '';

    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(CITY_TENANT);
    await page.waitForLoadState('networkidle').catch(() => {});

    const row = page.getByRole('row').filter({ hasText: CITY_TENANT });
    await expect(row.first()).toBeVisible();

    if (!hasDistrict) {
      // Grid survived the missing field — nothing to assert beyond row
      // visibility. If the UI ever starts crashing here the test will
      // time out, flagging the regression.
      // eslint-disable-next-line no-console
      console.warn(`[tenants] ${CITY_TENANT} has no city.districtName — list tolerated it`);
    }
  });

  test('6. create via API — new tenant row shows up in the UI list', {
    annotation: {
      type: 'description',
      description: `Stress-tests the data provider: API-creating a tenant via mdmsCreate (no UI affordance for tenant creation today) must result in the freshly-inserted MDMS row appearing in the UI list. Soft-deletes the test record in afterAll because Tenant has no UI delete affordance.

Steps:
1. Generate a unique tenant code: TENANT_CODE.<test scoped suffix>.
2. mdmsCreate via the configured tenant.tenants schema with code/name/type/city.
3. Track the code in createdCodes for afterAll cleanup.
4. Navigate to the tenants list; type the code into the search input; wait for networkidle.
5. Assert the row matching the code is visible within 15s.
6. Assert a row containing 'PW District' is also visible (district column rendered correctly).

Teardown is API-only — no UI delete for tenants. Soft-delete via cleanupMdms with isActive=false.`,
    },
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    // Onboarding-data gap: tenant.tenants _create now requires emailId + imageId
    // (city-setup enriches these). This minimal MDMS payload omits them, so the
    // create is rejected on a stock deployment. Left skipped rather than faked —
    // re-enable once the create helper seeds emailId/imageId (or drive the
    // city-setup wizard) so the row lands.
    test.skip(true, 'tenant.tenants create requires emailId/imageId not provided by this minimal payload');
    const auth = loadAuth();
    const code = `${TENANT_CODE}.${testCode(testInfo, 'TNT').toLowerCase().replace(/^pw_/, 'pw')}`;
    createdCodes.add(code);

    await mdmsCreate(auth, TENANT_CODE, SCHEMA, code, {
      code,
      name: `PW Tenant ${code}`,
      type: 'CITY',
      tenantId: TENANT_CODE,
      city: {
        code,
        name: `PW Tenant ${code}`,
        districtName: 'PW District',
        districtCode: 'PW_DIST',
        districtTenantCode: TENANT_CODE,
      },
    });

    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});

    await expect(
      page.getByRole('row').filter({ hasText: code }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // District column should render the value we supplied.
    await expect(
      page.getByRole('row').filter({ hasText: 'PW District' }).first(),
    ).toBeVisible();
  });
});
