/**
 * Employee PGR inbox-v2 — column-header SORT actually changes the row order
 * (issue #922: clicking a sortable column header did nothing).
 *
 * The bug was five stacked issues, each of which would have made this spec
 * fail on its own:
 *   - every column had disableSortBy: true (nothing was even clickable)
 *   - no onSort handler was wired to a real request
 *   - PGRService.search() re-sorted every result by createdTime in Java,
 *     discarding the SQL-level ORDER BY pgr-services had already built
 *   - CustomSVG.SortUp/SortDown crashed the page on click (onClick={})
 *   - the sort icon direction never toggled — every remount (triggered by
 *     the sort click's own refetch) reset it back to the same arrow
 *
 * This spec drives the real deployment (no mocking) and checks all of it:
 *   - clicking "Locality" fires sortBy=locality&sortOrder=ASC on the
 *     _search request
 *   - the row order is independently re-verified via the PGR API (fetching
 *     each visible row's raw address.locality.code, NOT the localized
 *     display text the inbox renders — investigation found the two don't
 *     share an alphabet-friendly order)
 *   - clicking the same header again toggles to sortOrder=DESC, and the
 *     row order flips accordingly
 *   - the header's sort-icon CSS class alternates asc/desc across repeat
 *     clicks instead of staying fixed
 *   - no page error is thrown by any of this (regression for the
 *     onClick={} crash)
 *   - "Current Owner", which has no pgr-services sort-by equivalent, shows
 *     no sort icon and isn't clickable
 *
 * Deployment-portable: seeds two fresh complaints in two different
 * ward-level boundaries (so there's always ≥2 distinct localities to sort
 * between, even on an otherwise-empty tenant) and self-skips with a clear
 * reason when the deployment can't support the scenario (e.g. ADMIN login
 * fails, or the tenant has fewer than 2 ward-level boundaries).
 */
import { test, expect, type Page } from '@playwright/test';
import { pgrCreate, resolveServiceCode } from '../utils/launch-fixes/api';
import {
  BASE_URL, TENANT, SERVICE_CODE, ADMIN_USER, ADMIN_PASS,
  EMPLOYEE_USER, EMPLOYEE_PASS, generateCitizenPhone,
} from '../utils/env';
import {
  getPrincipal, loginEmployeeBrowser, readInboxRows, fetchService, type Principal,
} from '../utils/employee-ui';
import { getProfile } from '../utils/profile';
import { fetchBoundaryTree, type BoundaryNode } from '../utils/probes';

const INBOX_URL = `${BASE_URL}/digit-ui/employee/pgr/inbox-v2`;
const SEARCH_RE = /pgr-services\/v2\/request\/_search/;

let admin: Principal | null = null;
let seedSkip = '';

/** Distinct LEAF boundary codes (the level PGR files complaints against) for the
 *  tenant — NOT the single "preferred" code resolveLocalityCode returns, since
 *  this spec needs at least two genuinely different codes to seed complaints into
 *  and prove the sort actually reorders.
 *
 *  Reads the deployment's OWN PGR boundary hierarchy from the profile
 *  (MAPUTO_ADMIN on maputo, REVENUE/ADMIN elsewhere) instead of the old
 *  hardcoded `REVENUE` — which is simply the wrong tree on most deployments, so
 *  the flat `/boundary/_search` it hit returned codes that either don't exist as
 *  PGR localities or never surface in the employee's inbox, collapsing the inbox
 *  to a single distinct locality and failing the sort assertion. Walks the
 *  boundary-relationships tree and keeps only the leaves. */
async function fetchWardCodes(token: string): Promise<string[]> {
  const hierarchyType = getProfile().boundary.hierarchyType;
  if (!hierarchyType) return [];
  const root = await fetchBoundaryTree(TENANT, hierarchyType, { authToken: token });
  if (!root) return [];
  const leaves: string[] = [];
  const walk = (n: BoundaryNode): void => {
    if (!n.children || n.children.length === 0) {
      if (n.code && !n.code.startsWith('ZZ_') && n.code !== 'WARD_ORD') leaves.push(n.code);
      return;
    }
    n.children.forEach(walk);
  };
  walk(root);
  // Sorted ascending so the caller seeds into the lexicographically SMALLEST
  // leaves. That matters: an established tenant's inbox is dominated by one
  // heavily-used locality (161 of 200 complaints at alto_mae_a_q1 here), which
  // sorts to the top of an ASC page and would fill the whole first page with a
  // single locality — failing the "≥2 distinct localities visible" guard even
  // though the sort worked. Seeding into codes that sort BEFORE that block
  // guarantees the seeded localities appear on the first ASC page.
  return [...new Set(leaves)].sort();
}

test.beforeAll(async () => {
  admin = await getPrincipal(ADMIN_USER, ADMIN_PASS);
  if (!admin) { seedSkip = `ADMIN (${ADMIN_USER}) login failed — cannot seed complaints`; return; }
  try {
    const serviceCode = await resolveServiceCode(BASE_URL, admin.token, TENANT, SERVICE_CODE);
    const wards = await fetchWardCodes(admin.token);
    if (wards.length < 2) {
      seedSkip = 'deployment has fewer than 2 ward-level boundaries — nothing to sort between';
      return;
    }
    const [localityA, localityB] = wards;
    for (const loc of [localityA, localityB, localityA]) {
      await pgrCreate({
        baseUrl: BASE_URL,
        auth: { token: admin.token, userInfo: admin.userInfo },
        tenantId: TENANT,
        serviceCode,
        localityCode: loc,
        description: `inbox-sort-922 seed ${loc} ${Date.now()}`,
        citizenName: 'Inbox Sort Seed',
        citizenPhone: generateCitizenPhone(),
      });
    }
  } catch (err: any) {
    seedSkip = `seed failed: ${err?.message?.slice(0, 200)}`;
  }
});

async function openInbox(page: Page): Promise<void> {
  const ok = await loginEmployeeBrowser(page, EMPLOYEE_USER, EMPLOYEE_PASS);
  test.skip(!ok, `employee ${EMPLOYEE_USER} login failed on this deployment`);
  await Promise.all([
    page.waitForResponse((r) => SEARCH_RE.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null),
    page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
  ]);
  await page.locator('[role="row"]').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

/** Bump rows-per-page to the max option so a full sorted page renders — the
 *  inbox pages at 10 by default (mirrors inbox-filters.spec.ts). */
async function showAllRows(page: Page): Promise<void> {
  const sel = page.locator('select').last();
  if ((await sel.count()) === 0) return;
  const values = await sel.locator('option').evaluateAll(
    (os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  if (values.length === 0) return;
  await Promise.all([
    page.waitForResponse((r) => SEARCH_RE.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null),
    sel.selectOption(values[values.length - 1]),
  ]);
  await page.waitForTimeout(1_500);
}

/** Click a column header by its visible label and wait for the resulting
 *  server-side sort request, returning its decoded URL. */
async function clickSortHeader(page: Page, label: RegExp): Promise<string> {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => SEARCH_RE.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }),
    page.locator('[role="columnheader"]', { hasText: label }).first().click(),
  ]);
  await page.waitForTimeout(1_500);
  return decodeURIComponent(resp.url());
}

/** Independently re-verify row order via the PGR API — NOT the localized
 *  display text the inbox renders for locality (issue #922 investigation
 *  found the display name and the raw sort key don't share an
 *  alphabet-friendly order). */
async function localityCodesInOrder(page: Page, principal: Principal): Promise<string[]> {
  const rows = await readInboxRows(page);
  const codes: string[] = [];
  for (const row of rows) {
    const service: any = await fetchService(principal, row.srid);
    codes.push(service?.address?.locality?.code || '');
  }
  return codes;
}

const isNonDecreasing = (xs: string[]) => xs.every((x, i) => i === 0 || xs[i - 1] <= x);
const isNonIncreasing = (xs: string[]) => xs.every((x, i) => i === 0 || xs[i - 1] >= x);

test.describe('employee inbox-v2 — column header sort (issue #922)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('clicking Locality sorts ascending server-side, by the raw code, with no page error @p0', {
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    test.skip(!!seedSkip, seedSkip);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await openInbox(page);
    await showAllRows(page);

    const url = await clickSortHeader(page, /Locality/i);
    expect(url).toContain('sortBy=locality');
    expect(url).toContain('sortOrder=ASC');

    const codes = await localityCodesInOrder(page, admin!);
    expect(codes.length, 'inbox has rows to check').toBeGreaterThan(0);
    expect(new Set(codes).size, 'at least two distinct localities are visible (otherwise this proves nothing)').toBeGreaterThan(1);
    expect(isNonDecreasing(codes), `locality codes are ASC-sorted: ${codes.join(', ')}`).toBeTruthy();

    expect(errors, 'no page errors after sorting').toEqual([]);
  });

  test('clicking Locality again toggles to descending, in both the request and the row order @p0', {
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    test.skip(!!seedSkip, seedSkip);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await openInbox(page);
    await showAllRows(page);
    await clickSortHeader(page, /Locality/i); // 1st click -> ASC
    const url = await clickSortHeader(page, /Locality/i); // 2nd click -> DESC
    expect(url).toContain('sortBy=locality');
    expect(url).toContain('sortOrder=DESC');

    const codes = await localityCodesInOrder(page, admin!);
    expect(isNonIncreasing(codes), `locality codes are DESC-sorted after the second click: ${codes.join(', ')}`).toBeTruthy();
    expect(errors, 'no page errors after two sort clicks').toEqual([]);
  });

  test('the sort icon toggles direction across repeated clicks, instead of staying on one arrow @p0', {
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    test.skip(!!seedSkip, seedSkip);
    await openInbox(page);

    const header = page.locator('[role="columnheader"]', { hasText: /Locality/i }).first();
    const iconClass = () => header.locator('.__rdt_custom_sort_icon__').getAttribute('class');

    await header.click();
    await page.waitForTimeout(1_500);
    const afterClick1 = await iconClass();

    await header.click();
    await page.waitForTimeout(1_500);
    const afterClick2 = await iconClass();

    await header.click();
    await page.waitForTimeout(1_500);
    const afterClick3 = await iconClass();

    expect(afterClick1).toContain('asc');
    expect(afterClick2).toContain('desc');
    expect(afterClick3).toContain('asc');
    expect(afterClick1).not.toBe(afterClick2);
  });

  test('"Current Owner" has no sort affordance — pgr-services has no sort-by equivalent for it @p0', {
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:employee'] }, async ({ page }) => {
    await openInbox(page);
    const header = page.locator('[role="columnheader"]', { hasText: /Current Owner/i }).first();
    await expect(header).toBeVisible();
    expect(await header.locator('.__rdt_custom_sort_icon__').count(), 'Owner column renders no sort icon').toBe(0);
  });
});
