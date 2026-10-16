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
 *
 * Root workspace only (#2398 decision 2): the city-tenant search, the
 * city districtName quirk and the city-tenant create probe were removed.
 */
import { test, expect } from '@playwright/test';
import { loadAuth, mdmsSearch } from '../utils/manage/api';
import { ROOT_TENANT } from '../utils/env';

// Root (state) tenant from env — no hardcoded 'ke'.
const TENANT_CODE = ROOT_TENANT;
const SCHEMA = 'tenant.tenants';
const LIST_PATH = '/configurator/manage/tenants';

test.describe.configure({ mode: 'serial' });

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

    const dataRows = page.getByRole('row');
    const rowCount = await dataRows.count();
    expect(rowCount).toBeGreaterThan(1); // header + >=1 tenant
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
      // This bit: a former create test left soft-deleted `<tenant>.pwt<hash>`
      // tenants that persist in MDMS, sort ahead of the real seed, and carry a
      // fleshed-out city block, so this picker kept selecting a dead PW tenant.
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
});
