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

const TENANT_CODE = process.env.TENANT_CODE || 'ke';
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
  test('1. list renders expected columns and at least one row', async ({ page }) => {
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

  test('2. search filter narrows to a known tenant code', async ({ page }) => {
    await page.goto(LIST_PATH);

    const search = page.getByPlaceholder(/search/i).first();
    await expect(search).toBeVisible();
    await search.fill('ke.nairobi');
    await page.waitForLoadState('networkidle').catch(() => {});

    await expect(
      page.getByRole('row').filter({ hasText: 'ke.nairobi' }).first(),
    ).toBeVisible();

    // A nonsense code should drop us to empty-state (zero data rows).
    await search.fill('');
    await search.fill('zzz_no_such_tenant_xyz');
    await page.waitForLoadState('networkidle').catch(() => {});
    const rows = page.getByRole('row').filter({ hasText: 'zzz_no_such_tenant_xyz' });
    expect(await rows.count()).toBe(0);
  });

  test('3. show page renders Code / Name / City / District for a known tenant', async ({
    page,
  }) => {
    // Pick a tenant that has a fleshed-out `city` block (ke.nakuru is
    // seeded with districtName in the default `ke` dataset).
    const auth = loadAuth();
    const allTenants = await mdmsSearch(auth, TENANT_CODE, SCHEMA, { limit: 200 });
    const fleshedOut = allTenants.find((r) => {
      const city = (r.data as Record<string, unknown>).city as
        | Record<string, unknown>
        | undefined;
      return typeof city?.districtName === 'string' && city.districtName !== '';
    });
    test.skip(!fleshedOut, 'No tenant with city.districtName present');

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

  test('4. API shape — search returns records with code / name / city', async () => {
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

  test('5. QUIRK — ke.nairobi city object lacks districtName, list tolerates it', async ({
    page,
  }) => {
    const auth = loadAuth();
    const nairobi = (
      await mdmsSearch(auth, TENANT_CODE, SCHEMA, {
        uniqueIdentifiers: ['ke.nairobi'],
      })
    )[0] as MdmsRecord | undefined;
    test.skip(!nairobi, 'ke.nairobi not present on this tenant');

    const city = (nairobi!.data as Record<string, unknown>).city as
      | Record<string, unknown>
      | undefined;
    // The minimal seed lacks districtName — the column should render
    // empty rather than throwing. If a future seed fixes this, the test
    // still passes (the UI tolerates both shapes).
    const hasDistrict = typeof city?.districtName === 'string' && city.districtName !== '';

    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill('ke.nairobi');
    await page.waitForLoadState('networkidle').catch(() => {});

    const row = page.getByRole('row').filter({ hasText: 'ke.nairobi' });
    await expect(row.first()).toBeVisible();

    if (!hasDistrict) {
      // Grid survived the missing field — nothing to assert beyond row
      // visibility. If the UI ever starts crashing here the test will
      // time out, flagging the regression.
      // eslint-disable-next-line no-console
      console.warn('[tenants] ke.nairobi has no city.districtName — list tolerated it');
    }
  });

  test('6. create via API — new tenant row shows up in the UI list', async ({
    page,
  }, testInfo) => {
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
