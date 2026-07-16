/**
 * Employee PGR inbox-v2 — FILTERS ACTUALLY NARROW THE LIST (TEST-COVERAGE-GAPS #1).
 *
 * The prior inbox coverage was a smoke test (mounts, dropdown populated). This
 * spec drives the three server-side inbox filters and asserts the visible row
 * set genuinely shrinks to only-matching rows, then that clearing restores it:
 *
 *   • status        — check a workflow-state box → every visible row is in that
 *                     state (the inbox defaults to OPEN states only, so a
 *                     terminal filter like REJECTED proves the narrowing).
 *   • complaintType — pick a Complaint Subtype → every visible row shares that
 *                     one serviceCode (verified out-of-band via PGR _search,
 *                     since the inbox has no serviceCode column).
 *   • locality      — drill the boundary cascade to a leaf ward → every visible
 *                     row is in that locality.
 *
 * Deployment-portable: personas come from getPersona() (deployment-discovered,
 * not hardcoded env usernames), complaints are always seeded as a CITIZEN via
 * seed.ts (pgr-services' APPLY action is [CITIZEN, CSR] on every deployment —
 * seeding with an employee token 400s "INVALID ROLE" the moment that employee
 * isn't ALSO a citizen, which is only true by bootstrap accident on local),
 * and each test self-skips with a clear reason when the deployment can't
 * support the case (e.g. a single-complaint-type or single-locality tenant).
 *
 * Auth: getPersona('inbox-viewer') logs into the inbox UI; the default
 * "Assigned to All" radio means it sees every complaint, not just its own.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE_URL, TENANT } from '../utils/env';
import { getPersona, resolveSeedPlan, type ResolvedPersona } from '../utils/personas';
import { seedComplaintAsCitizen } from '../utils/seed';
import {
  loginEmployeeBrowser, readInboxRows, apiReject, apiServiceCode, type Principal,
} from '../utils/employee-ui';

/** Adapt a personas.ts ResolvedPersona to employee-ui.ts's Principal shape —
 *  same token/userInfo/roles, just `tenant` renamed `authTenant`. */
function toPrincipal(p: ResolvedPersona): Principal {
  return { token: p.token, userInfo: p.userInfo, roles: p.roles, authTenant: p.tenant };
}

const INBOX_URL = `${BASE_URL}/digit-ui/employee/pgr/inbox-v2`;
const SEARCH_RE = /pgr-services\/v2\/request\/_search/;

// Seed artefacts + skip reasons resolved in beforeAll.
let admin: Principal | null = null;
let gro: Principal | null = null;
let seedSkip = '';
let rejectedSrid = '';
let serviceCodeA = '';
let serviceCodeB = '';
let secondTypeAvailable = true;

/** Fetch the leaf serviceCodes from RAINMAKER-PGR.ComplaintHierarchy (the app's
 *  source of truth now that ServiceDefs is empty on CRS tenants). */
async function fetchLeafServiceCodes(token: string): Promise<string[]> {
  try {
    const j: any = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { authToken: token }, MdmsCriteria: { tenantId: TENANT, schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy', limit: 200 } }),
    }).then((r) => r.json());
    const rows = (j.mdms || []).map((m: any) => m.data).filter(Boolean);
    const parents = new Set(rows.map((x: any) => x.parentCode).filter(Boolean));
    return rows.filter((x: any) => !parents.has(x.code)).map((x: any) => x.code);
  } catch { return []; }
}

async function seedOpen(serviceCode: string, localityCode: string): Promise<string> {
  const { srid } = await seedComplaintAsCitizen({
    serviceCode, localityCode, description: `inbox-filter seed ${serviceCode} ${Date.now()}`,
  });
  return srid;
}

test.beforeAll(async () => {
  // resolveSeedPlan() picks the one (serviceCode, actor) pairing this
  // deployment can actually ASSIGN — see personas.ts's persona-triple
  // comment. We don't need the assignee here (nothing in this file drives
  // ASSIGN), just serviceCodeA + the GRO actor for REJECT and a locality
  // proven to exist in the live boundary tree.
  const plan = await resolveSeedPlan();
  if ('error' in plan) { seedSkip = plan.error; return; }
  try {
    const employee = await getPersona('inbox-viewer');
    admin = toPrincipal(employee);
    gro = toPrincipal(plan.actor);

    serviceCodeA = plan.serviceCode;
    const localityA = plan.localityCode;

    // A second, distinct complaint type (for the complaint-type narrowing test).
    const leaves = await fetchLeafServiceCodes(employee.token);
    serviceCodeB = leaves.find((c) => c !== serviceCodeA) || '';
    secondTypeAvailable = !!serviceCodeB;

    // Guarantee ≥1 OPEN complaint of type A and (if available) type B.
    await seedOpen(serviceCodeA, localityA);
    if (serviceCodeB) await seedOpen(serviceCodeB, localityA);

    // A known REJECTED complaint (terminal) for the status filter.
    rejectedSrid = await seedOpen(serviceCodeA, localityA);
    const st = await apiReject(gro, rejectedSrid);
    if (st !== 'REJECTED') seedSkip = `seeded complaint did not reach REJECTED (got ${st})`;
  } catch (err: any) {
    seedSkip = `seed failed: ${err?.message?.slice(0, 200)}`;
  }
});

async function openInbox(page: Page): Promise<void> {
  const employee = await getPersona('inbox-viewer');
  const ok = await loginEmployeeBrowser(page, employee.username, employee.password);
  test.skip(!ok, `employee ${employee.username} login failed on this deployment`);
  await Promise.all([
    page.waitForResponse((r) => SEARCH_RE.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null),
    page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
  ]);
  await page.locator('[role="row"]').first().waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(1_500);
}

/** Click Apply (raw i18n key on mz.maputo) and wait for the resulting search. */
async function applyFilter(page: Page): Promise<string> {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => SEARCH_RE.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }),
    page.getByRole('button', { name: /ES_COMMON_APPLY|^APPLY$|^Apply$/ }).first().click(),
  ]);
  await page.waitForTimeout(2_000);
  return decodeURIComponent(resp.url());
}

async function clearFilters(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => SEARCH_RE.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null),
    page.getByRole('button', { name: /ES_CLEAR_ALL|CLEAR ALL|Clear All/i }).first().click(),
  ]);
  await page.waitForTimeout(2_000);
}

/**
 * Bump the results table to its largest rows-per-page so the FULL filtered set
 * renders on one page. The inbox sorts server-side by `sla ASC` and pages at 10
 * with no total-count (Next Page stays disabled), so a freshly-seeded complaint
 * is not necessarily on the first SLA-sorted page once other complaints of the
 * same status accumulate. Selecting the max page size re-issues the search with
 * a larger `limit`, surfacing every matching row (see readInboxRows). No-op when
 * the tenant has fewer rows than the smallest page size. */
async function showAllRows(page: Page): Promise<void> {
  const sel = page.locator('select').last();
  if ((await sel.count()) === 0) return;
  const values = await sel.locator('option').evaluateAll(
    (os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
  );
  if (values.length === 0) return;
  const biggest = values[values.length - 1];
  await Promise.all([
    page.waitForResponse((r) => SEARCH_RE.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null),
    sel.selectOption(biggest),
  ]);
  await page.waitForTimeout(1_500);
}

test.describe('employee inbox-v2 — filters narrow the result set', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('status filter → only rows in the chosen workflow state @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    test.skip(!!seedSkip, seedSkip);
    await openInbox(page);

    // Default view = OPEN states only; none should be REJECTED.
    const defaultRows = await readInboxRows(page);
    expect(defaultRows.length, 'default inbox has rows').toBeGreaterThan(0);
    const rejectedLabel = (await page.locator('input[type="checkbox"][value="REJECTED"]')
      .evaluate((el: HTMLInputElement) => (el.closest('.digit-checkbox-container') as HTMLElement)?.innerText?.trim() || ''))
      .split('\n').pop()!.trim();
    expect(defaultRows.every((r) => r.status !== rejectedLabel), 'default view excludes REJECTED').toBeTruthy();

    // Apply REJECTED (value-based selector — localization-independent).
    // The digit-ui CheckBox (digit-ui-components/atoms/CheckBox.js) renders the
    // real <input> visually hidden (opacity:0) and the clickable square as a
    // sibling `<label class="digit-custom-checkbox" htmlFor=...>`. Clicking the
    // raw input does nothing; the label is what toggles it via native htmlFor.
    const rejInput = page.locator('input[type="checkbox"][value="REJECTED"]');
    if (!(await rejInput.isChecked())) {
      const container = rejInput.locator('xpath=ancestor::*[contains(@class,"digit-checkbox-container")][1]');
      await container.locator('label.digit-custom-checkbox').first().click();
    }
    await expect(rejInput, 'REJECTED filter checkbox toggled on').toBeChecked();
    const url = await applyFilter(page);
    expect(url).toContain('applicationStatus=REJECTED');
    expect(url).not.toContain('applicationStatus=PENDINGFORASSIGNMENT');

    // Render the whole REJECTED set (not just the SLA-sorted first page) so the
    // seeded complaint is reachable regardless of how many others accumulated.
    await showAllRows(page);
    const rejRows = await readInboxRows(page);
    expect(rejRows.length, 'REJECTED filter returns ≥1 row (we seeded one)').toBeGreaterThan(0);
    expect(rejRows.every((r) => r.status === rejectedLabel), 'every visible row is REJECTED').toBeTruthy();
    expect(rejRows.some((r) => r.srid === rejectedSrid), 'the seeded rejected complaint is visible').toBeTruthy();

    // Clearing restores the OPEN default view.
    await clearFilters(page);
    const cleared = await readInboxRows(page);
    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared.every((r) => r.status !== rejectedLabel), 'after clear, back to non-REJECTED default').toBeTruthy();
  });

  test('complaint-type filter → only rows of the chosen serviceCode @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    test.skip(!!seedSkip, seedSkip);
    test.skip(!secondTypeAvailable, 'deployment has only one complaint type — nothing to narrow between');
    await openInbox(page);

    const before = await readInboxRows(page);
    expect(before.length).toBeGreaterThan(0);

    // Open the "Complaint Subtype" dropdown and count its options.
    const ddInput = page.locator('.digit-dropdown-employee-select-wrap input[type="text"]').first();
    const optionItems = page.locator('.digit-dropdown-options-card .digit-dropdown-item');
    await ddInput.click();
    await page.waitForTimeout(800);
    const optionCount = await optionItems.count();
    expect(optionCount, 'subtype dropdown lists options').toBeGreaterThan(0);

    // Try options until one returns a non-empty, single-serviceCode row set.
    let matched = false;
    let matchedCode = '';
    for (let i = 0; i < Math.min(optionCount, 8); i++) {
      await ddInput.click();
      await page.waitForTimeout(500);
      await optionItems.nth(i).click();
      await page.waitForTimeout(400);
      const url = await applyFilter(page);
      expect(url).toContain('serviceCode=');
      const rows = await readInboxRows(page);
      if (rows.length === 0) continue;
      const codes = new Set<string>();
      for (const r of rows) codes.add((await apiServiceCode(admin!, r.srid)) || '?');
      expect(codes.size, `all visible rows share one serviceCode (got ${[...codes].join(',')})`).toBe(1);
      matchedCode = [...codes][0];
      matched = true;
      break;
    }
    expect(matched, 'at least one complaint type yielded a narrowed, single-type row set').toBeTruthy();

    // Clearing restores the multi-type default view.
    await clearFilters(page);
    expect((await readInboxRows(page)).length, 'rows return after clearing the type filter').toBeGreaterThan(0);
    expect(matchedCode.length).toBeGreaterThan(0);
  });

  test('locality filter → only rows in the chosen leaf boundary @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    test.skip(!!seedSkip, seedSkip);
    await openInbox(page);

    // Drill the boundary cascade: pick the first option at each level until no
    // further child combobox appears (leaf reached). A single-level tenant
    // still narrows to that boundary.
    let levels = 0;
    for (let i = 0; i < 6; i++) {
      const combos = page.locator('button[role="combobox"]');
      const n = await combos.count();
      if (n === 0) break;
      const before = n;
      await combos.nth(n - 1).click();
      await page.waitForTimeout(700);
      const opt = page.getByRole('option').first();
      if (await opt.count() === 0) break;
      await opt.click();
      await page.waitForTimeout(900);
      levels++;
      // stop when selecting produced no new (deeper) combobox
      if (await page.locator('button[role="combobox"]').count() <= before) break;
    }
    test.skip(levels === 0, 'boundary picker exposed no selectable options on this deployment');

    let url = await applyFilter(page);
    const m = url.match(/[?&]locality=([^&]+)/);
    test.skip(!m, 'boundary filter did not add a locality param (unsupported hierarchy)');
    const leaf = m![1];

    let rows = await readInboxRows(page);
    if (rows.length === 0) {
      // Nothing at that leaf yet — seed one and re-apply the (still-set) filter.
      try {
        await seedOpen(serviceCodeA, leaf);
        url = await applyFilter(page);
        rows = await readInboxRows(page);
      } catch (err: any) {
        test.skip(true, `no complaint at leaf ${leaf} and could not seed one there: ${err?.message?.slice(0, 120)}`);
      }
    }
    expect(rows.length, `locality=${leaf} returns ≥1 row`).toBeGreaterThan(0);
    expect(rows.every((r) => r.locality === leaf), `every visible row is in locality ${leaf}`).toBeTruthy();

    await clearFilters(page);
    expect((await readInboxRows(page)).length).toBeGreaterThan(0);
  });
});
