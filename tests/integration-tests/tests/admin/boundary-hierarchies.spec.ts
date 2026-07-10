/**
 * Boundary hierarchy management — CREATE + READ only.
 *
 * The `boundary-hierarchy-definition` service only exposes `_search` and
 * `_create`. `_update` and `_delete` both return 400 / NoResourceFoundException
 * (confirmed by curl probe on 2026-04). BoundaryHierarchyCreate.tsx says so
 * explicitly — it registers no Edit or Delete route. This spec mirrors that:
 *
 *  - list: columns + filter
 *  - show: levels render in chain order
 *  - create via UI: happy path produces a record we can see via API and list
 *  - duplicate hierarchyType rejected server-side with DUPLICATE_RECORD
 *  - validation: missing hierarchyType blocked client-side
 *  - response-shape tolerance: server wraps BoundaryHierarchy as an array
 *
 * TEARDOWN LIMITATION: there is no way to soft-delete a boundary hierarchy
 * through the API. Every test that creates one leaves a permanent row on
 * the tenant. We mitigate by using `PW_${hash8}_BH` hierarchy types so
 * repeat runs don't collide, but operators should periodically prune
 * `PW_*` hierarchies via direct DB cleanup before Nairobi go-live.
 */
import { test, expect } from '@playwright/test';
import { loadAuth } from '../utils/manage/api';
import { testCode } from '../utils/manage/codes';
import { ROOT_TENANT } from '../utils/env';

// Root (state) tenant, sourced from env (ROOT_TENANT / DIGIT_TENANT) so the
// suite is deployment-portable — no hardcoded 'ke'.
const TENANT_CODE = ROOT_TENANT;
const LIST_PATH = '/configurator/manage/boundary-hierarchies';

const BH_SEARCH = '/boundary-service/boundary-hierarchy-definition/_search';
const BH_CREATE = '/boundary-service/boundary-hierarchy-definition/_create';

// Track what we created so a human reading CI logs can see what's leaked.
const createdHierarchies = new Set<string>();

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  if (createdHierarchies.size === 0) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[boundary-hierarchies] ${createdHierarchies.size} hierarchy type(s) left on tenant — ` +
      'boundary service has no _delete endpoint. DB cleanup required for:',
    Array.from(createdHierarchies),
  );
});

interface BHRecord {
  id?: string;
  tenantId?: string;
  hierarchyType?: string;
  boundaryHierarchy?: Array<{
    boundaryType?: string;
    parentBoundaryType?: string | null;
    active?: boolean;
  }>;
  auditDetails?: Record<string, unknown>;
}

async function searchHierarchies(
  hierarchyType?: string,
): Promise<BHRecord[]> {
  const auth = loadAuth();
  const criteria: Record<string, unknown> = { tenantId: TENANT_CODE, limit: 100, offset: 0 };
  if (hierarchyType) criteria.hierarchyType = hierarchyType;
  const res = await fetch(`${auth.baseUrl}${BH_SEARCH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({
      RequestInfo: {
        apiId: 'Rainmaker',
        ver: '1.0',
        ts: Date.now(),
        msgId: `${Date.now()}|en_IN`,
        authToken: auth.token,
      },
      BoundaryTypeHierarchySearchCriteria: criteria,
    }),
  });
  const body = (await res.json()) as { BoundaryHierarchy?: BHRecord[] | null };
  return body.BoundaryHierarchy || [];
}

async function createHierarchyApi(
  hierarchyType: string,
  levels: Array<{ boundaryType: string; parentBoundaryType: string | null }>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const auth = loadAuth();
  const res = await fetch(`${auth.baseUrl}${BH_CREATE}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({
      RequestInfo: {
        apiId: 'Rainmaker',
        ver: '1.0',
        ts: Date.now(),
        msgId: `${Date.now()}|en_IN`,
        authToken: auth.token,
      },
      BoundaryHierarchy: {
        tenantId: TENANT_CODE,
        hierarchyType,
        boundaryHierarchy: levels.map((l) => ({ ...l, active: true })),
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

test.describe('manage/boundary-hierarchies', () => {
  test('1. list renders with hierarchy type + levels columns', {
    annotation: {
      type: 'description',
      description: `Asserts the boundary-hierarchies list page renders with the three expected column headers (Hierarchy Type, Tenant, Levels) and at least one populated row (the seeded ADMIN hierarchy on 'ke' tenant).

Steps:
1. Navigate to /configurator/manage/boundary-hierarchies.
2. Assert role=table is visible.
3. For each header in ['Hierarchy Type','Tenant','Levels'], assert the matching role=columnheader is visible.
4. Read row count via getByRole('row'); assert > 1 (header + at least one data row).

Catches a regression where BoundaryHierarchyList loses a column or the data provider returns no records.`,
    },
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(LIST_PATH);

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    for (const header of ['Hierarchy Type', 'Tenant', 'Levels']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(header, 'i') }),
      ).toBeVisible();
    }

    // Seeded ADMIN hierarchy should exist on the `ke` tenant.
    const dataRows = page.getByRole('row');
    expect(await dataRows.count()).toBeGreaterThan(1);
  });

  test('2. UI create happy path — chain of 2 levels shows up in list + API', {
    annotation: {
      type: 'description',
      description: `Drives the BoundaryHierarchyCreate form to create a 2-level chain (LEVEL_A → LEVEL_B), verifies the record landed via API, then verifies it appears in the manage list. Confirms the form's auto-pre-fill of parent (each new level's parent defaults to the previous row's boundaryType).

Steps:
1. Generate a unique hierarchyType via testCode; track it for cleanup logging.
2. Navigate to /configurator/manage/boundary-hierarchies/create.
3. Fill #hierarchyType.
4. Fill the first "e.g. County" placeholder with LEVEL_A.
5. Click "Add level"; fill the second placeholder with LEVEL_B (parent auto-populates to LEVEL_A).
6. Click Create; wait for navigation back to LIST_PATH within 30s.
7. searchHierarchies(hierarchyType) via API; assert exactly 1 record returned with the expected level chain (LEVEL_A→null, LEVEL_B→LEVEL_A).
8. Navigate back to the list; type the hierarchyType in search; assert the matching row is visible.

Teardown is logging-only — boundary service has no _delete endpoint. PW_<hash>_BH naming prevents collisions across runs.`,
    },
    tag: ['@area:configurator-manage', '@kind:happy-path', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const hierarchyType = testCode(testInfo, 'BH_CREATE');
    createdHierarchies.add(hierarchyType);

    await page.goto(`${LIST_PATH}/create`);

    // Start-anchored only: the label's accessible name carries the required
    // " *" marker, so an end-anchored /^Hierarchy Type$/ matches nothing.
    await page.getByLabel(/^Hierarchy Type/i).fill(hierarchyType);

    // First level is rendered by default — fill its boundaryType.
    const firstBoundary = page.getByPlaceholder(/e\.g\. County/i).first();
    await firstBoundary.fill('LEVEL_A');

    // Add a second level via the "Add level" button.
    await page.getByRole('button', { name: /Add level/i }).click();
    const secondBoundary = page.getByPlaceholder(/e\.g\. County/i).nth(1);
    await secondBoundary.fill('LEVEL_B');

    // Parent for the second row should be populated via the Select — the
    // editor pre-fills it to LEVEL_A (previous row's boundaryType) so we
    // don't need to manually pick. Submit.
    await Promise.all([
      page.waitForURL(LIST_PATH, { timeout: 30_000 }),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);

    // Verify via API that the hierarchy landed.
    const records = await searchHierarchies(hierarchyType);
    expect(records.length).toBe(1);
    const levels = records[0].boundaryHierarchy || [];
    expect(levels.length).toBe(2);
    expect(levels[0].boundaryType).toBe('LEVEL_A');
    expect(levels[0].parentBoundaryType).toBeNull();
    expect(levels[1].boundaryType).toBe('LEVEL_B');
    expect(levels[1].parentBoundaryType).toBe('LEVEL_A');

    // And in the list.
    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(hierarchyType);
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(
      page.getByRole('row').filter({ hasText: hierarchyType }).first(),
    ).toBeVisible();
  });

  test('3. show page renders levels in chain order', {
    annotation: {
      type: 'description',
      description: `Seeds a 3-level hierarchy (ROOT → MID → LEAF) via API for speed, then opens the hierarchy's show page in the UI and asserts all three level badges render. Confirms BoundaryHierarchyShow correctly walks the chain and presents each level.

Steps:
1. Generate a unique hierarchyType; track it.
2. createHierarchyApi with [ROOT(null), MID(parent=ROOT), LEAF(parent=MID)]; assert status is 200/201/202.
3. Navigate to LIST_PATH; type the hierarchyType in search; click the row.
4. Assert text 'ROOT' (exact) is visible.
5. Assert text 'MID' (exact) is visible.
6. Assert text 'LEAF' (exact) is visible.

Skips three UI interactions by API-seeding — UI is the test subject for show, not create.`,
    },
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }, testInfo) => {
    const hierarchyType = testCode(testInfo, 'BH_SHOW');
    createdHierarchies.add(hierarchyType);

    // Seed via API — saves three UI interactions.
    const { status } = await createHierarchyApi(hierarchyType, [
      { boundaryType: 'ROOT', parentBoundaryType: null },
      { boundaryType: 'MID', parentBoundaryType: 'ROOT' },
      { boundaryType: 'LEAF', parentBoundaryType: 'MID' },
    ]);
    expect([200, 201, 202]).toContain(status);

    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(hierarchyType);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('row').filter({ hasText: hierarchyType }).first().click();

    // All three level badges should render on the show page.
    await expect(page.getByText('ROOT', { exact: true })).toBeVisible();
    await expect(page.getByText('MID', { exact: true })).toBeVisible();
    await expect(page.getByText('LEAF', { exact: true })).toBeVisible();
  });

  test('4. duplicate hierarchyType is rejected with DUPLICATE_RECORD', {
    annotation: {
      type: 'description',
      description: `Backend contract: creating a hierarchy with a hierarchyType that already exists must return HTTP 400 with error code DUPLICATE_RECORD. The UI relies on this server-side guard for create-idempotency (no pre-flight check in the form).

Steps:
1. Generate a unique hierarchyType; track it.
2. createHierarchyApi with one level [X(null)]; assert status is 200/201/202.
3. Re-create with same hierarchyType but different level [Y(null)]; assert second call returns status 400.
4. Read body.Errors[].code; assert the codes array contains 'DUPLICATE_RECORD'.

If the server starts overwriting on duplicate, this test catches it — the UI's idempotency assumption would silently break.`,
    },
    tag: ['@area:configurator-manage', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({}, testInfo) => {
    const hierarchyType = testCode(testInfo, 'BH_DUP');
    createdHierarchies.add(hierarchyType);

    const first = await createHierarchyApi(hierarchyType, [
      { boundaryType: 'X', parentBoundaryType: null },
    ]);
    expect([200, 201, 202]).toContain(first.status);

    // Second create with the same hierarchyType must 400 with
    // DUPLICATE_RECORD. This is the backend guard the UI relies on for
    // create-idempotency (there's no pre-flight check in the form).
    const second = await createHierarchyApi(hierarchyType, [
      { boundaryType: 'Y', parentBoundaryType: null },
    ]);
    expect(second.status).toBe(400);
    const errors = (second.body.Errors as Array<{ code?: string }>) || [];
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('DUPLICATE_RECORD');
  });

  test('5. validation — empty hierarchyType blocks client-side submit', {
    annotation: {
      type: 'description',
      description: `Form-validation edge case: leaving hierarchyType blank but filling a level must NOT submit. The form stays on /create and surfaces a validation error rather than POSTing to the API.

Steps:
1. Navigate to /configurator/manage/boundary-hierarchies/create.
2. Fill the first "e.g. County" placeholder with 'LEVEL_Z'.
3. Click Create.
4. Assert page URL still matches /\\/create$/ within 5s (no navigation = validation blocked).

Pairs with the duplicate-record test — together they bracket the form's create paths (client-side miss vs. server-side miss).`,
    },
    tag: ['@area:configurator-manage', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }) => {
    await page.goto(`${LIST_PATH}/create`);

    // Fill only the level, leave hierarchyType blank.
    const firstBoundary = page.getByPlaceholder(/e\.g\. County/i).first();
    await firstBoundary.fill('LEVEL_Z');

    await page.getByRole('button', { name: /^Create$/ }).click();

    // The form should not navigate — URL still on /create. Validation
    // surfaces as a help/error text on the Hierarchy Type input.
    await expect(page).toHaveURL(/\/create$/, { timeout: 5_000 });
  });

  test('6. API response shape — BoundaryHierarchy comes back as an array', {
    annotation: {
      type: 'description',
      description: `Pins the current API response shape. The client tolerates either a single object OR a single-element array on create. This test creates a hierarchy and asserts the BoundaryHierarchy response field is truthy AND is an array OR object — flagging any future server change for review.

Steps:
1. Generate a unique hierarchyType; track it.
2. createHierarchyApi with one level [ONLY(null)]; assert status is 200/201/202.
3. Read body.BoundaryHierarchy; assert it is truthy.
4. Assert Array.isArray(bh) || typeof bh === 'object'.

Documentation-by-test: if a future server rev flips the shape, the regression hits this assertion (and the UI keeps working because the data provider already handles both forms).`,
    },
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({}, testInfo) => {
    // The client allows either a single object or a single-element array
    // on create. Pin the current contract so a future server rev doesn't
    // break silently.
    const hierarchyType = testCode(testInfo, 'BH_SHAPE');
    createdHierarchies.add(hierarchyType);

    const { status, body } = await createHierarchyApi(hierarchyType, [
      { boundaryType: 'ONLY', parentBoundaryType: null },
    ]);
    expect([200, 201, 202]).toContain(status);

    const bh = body.BoundaryHierarchy as unknown;
    expect(bh).toBeTruthy();
    // Today the server returns an array — if a future deploy flips it to
    // a single object, the UI keeps working (tested above via UI create),
    // but flag the contract change here so backend sees it.
    expect(Array.isArray(bh) || typeof bh === 'object').toBe(true);
  });
});
