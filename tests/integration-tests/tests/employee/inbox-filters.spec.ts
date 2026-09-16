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
 *                     since the inbox has no serviceCode column). The subtype
 *                     is chosen from the types the LIVE inbox actually holds
 *                     complaints for, never from the dropdown's first few
 *                     entries: that dropdown lists every ComplaintHierarchy
 *                     leaf, and a stack carrying types other test runs created
 *                     offers dozens with no complaint ever filed against them.
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
 * Auth: getPersona('inbox-viewer') logs into the inbox UI.
 *
 * KNOWN RED on a deployment that applies the inbox's assignee default (bomet):
 * the status/REJECTED case cannot pass there, and not for want of seeding.
 * inboxConfigPGR.js defaults the filter to assignee = ASSIGNED_TO_ME, which
 * useInboxGeneral hands to pgr-services as `assignee=<self uuid>`; meanwhile
 * egov-workflow-v2 refuses an assignee on REJECT ("INVALID_ASSIGNEE: cannot
 * assign to the user") because the REJECTED state has no roles able to act on
 * it. So every REJECTED complaint has no assignee, the inbox only ever asks
 * for complaints WITH one, and the Rejected checkbox the UI offers can never
 * return a row. Nor can the spec click its way out: bomet renders no
 * "Assigned to all" radio at all. See docs/LOCAL-VS-BOMET-PARITY.md.
 * It passes on mz.maputo only because that build never adds the param.
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE_URL, TENANT } from '../utils/env';
import { getPersona, resolveSeedPlan, serviceCodesFor, type ResolvedPersona } from '../utils/personas';
import { seedComplaintAsCitizen } from '../utils/seed';
import {
  loginEmployeeBrowser, readInboxRows, apiReject, apiServiceCode, showAllInboxRows, type Principal,
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

/**
 * The label the "Complaint Subtype" dropdown renders for a serviceCode.
 *
 * useServiceDefs (products/pgr/src/hooks/pgr/useServiceDefs.js) builds each
 * option's visible text as `t("COMPLAINT_HIERARCHY.<CODE>")`, falling back to
 * the ComplaintHierarchy node's `name` and then to the bare code. So ask MDMS
 * for the same node and hand back every form the option could legitimately be
 * showing; the caller matches an option against the set rather than guessing a
 * single string. Empty array when the node can't be read — the caller then
 * falls back to probing options by request URL.
 */
async function labelCandidates(token: string, codes: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const c of codes) out.set(c, [c, `COMPLAINT_HIERARCHY.${c.toUpperCase()}`]);
  try {
    const j: any = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: token },
        MdmsCriteria: { tenantId: TENANT, schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy', uniqueIdentifiers: codes, limit: codes.length + 10 },
      }),
    }).then((r) => r.json());
    for (const row of j.mdms || []) {
      const code = row?.data?.code || row?.uniqueIdentifier;
      const name = row?.data?.name;
      if (code && name && out.has(code)) out.get(code)!.unshift(String(name));
    }
  } catch { /* MDMS unreachable — code/raw-key candidates still stand */ }
  return out;
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

    // Seed a service the VIEWER's department owns — the inbox scopes by
    // department as well as jurisdiction, so plan.serviceCode (picked for
    // ASSIGN-ability, not visibility) can be invisible to them. On bomet the
    // viewer is an ENV GRO while plan.serviceCode is RudeBehavior/WATER_ENV, so
    // every seeded row was filtered out and the inbox looked "empty of ours".
    const visible = serviceCodesFor(employee);
    if (!visible.length) {
      seedSkip = `inbox viewer ${employee.username} holds no department that owns a complaint type (departments: ${employee.departments.join('|') || 'none'})`;
      return;
    }
    serviceCodeA = visible[0];
    const localityA = plan.localityCode;

    // A second, distinct complaint type (for the complaint-type narrowing test)
    // — also department-visible, else the filter has nothing to narrow to.
    serviceCodeB = visible.find((c) => c !== serviceCodeA) || '';
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

// showAllRows lived here privately; it now sits in utils/employee-ui.ts as
// showAllInboxRows so inbox-search.spec.ts can use it too (it needs the same
// page-size bump and did not have it).

test.describe('employee inbox-v2 — filters narrow the result set', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('status filter → only rows in the chosen workflow state @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    test.skip(!!seedSkip, seedSkip);
    await openInbox(page);
    // Widen to "All Complaints" BEFORE touching filters — switching tabs
    // re-issues the search with the tab's own default query, silently dropping
    // an already-applied status filter (observed: REJECTED applied on the MY
    // tab, then the ALL switch refetched unfiltered/empty and the assertion
    // read 0 rows). The sibling filter tests already widen first.
    await showAllInboxRows(page);

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
    await showAllInboxRows(page);
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

    // Show the whole unfiltered set first, then learn which complaint types this
    // deployment ACTUALLY has complaints for. The dropdown lists every leaf in
    // ComplaintHierarchy — on a stack that has accumulated types from other test
    // runs that is dozens of options, nearly all with zero complaints filed
    // against them, and filtering by one of those can only ever return an empty
    // list. Picking blind (the first N options) therefore proves nothing; the
    // filter has to be pointed at a type the data can narrow TO.
    await showAllInboxRows(page);
    const before = await readInboxRows(page);
    expect(before.length).toBeGreaterThan(0);
    const countByCode = new Map<string, number>();
    for (const r of before) {
      const c = await apiServiceCode(admin!, r.srid);
      if (c) countByCode.set(c, (countByCode.get(c) || 0) + 1);
    }
    // Most-populated first: the likeliest to still be on-page after filtering.
    const targets = [...countByCode.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    expect(targets.length, 'the default inbox contains at least one resolvable complaint type').toBeGreaterThan(0);
    test.skip(
      countByCode.size < 2,
      `only one complaint type (${targets[0]}) has complaints in this inbox — a type filter cannot be shown to narrow anything`,
    );
    const labels = await labelCandidates(admin!.token, targets);

    // Open the "Complaint Subtype" dropdown and read its option labels.
    const ddInput = page.locator('.digit-dropdown-employee-select-wrap input[type="text"]').first();
    const optionItems = page.locator('.digit-dropdown-options-card .digit-dropdown-item');
    await ddInput.click();
    await page.waitForTimeout(800);
    const optionCount = await optionItems.count();
    expect(optionCount, 'subtype dropdown lists options').toBeGreaterThan(0);
    const optionTexts: string[] = (await optionItems.allInnerTexts()).map((s) => s.trim());

    /** Option indices to try, best-first: the ones whose label matches a type we
     *  know has rows, then (only if none matched) every remaining option, whose
     *  serviceCode we can still learn from the request URL after applying. */
    const preferred: number[] = [];
    for (const code of targets) {
      const wanted = labels.get(code) || [code];
      const i = optionTexts.findIndex((txt) => wanted.some((w) => txt === w || txt.toLowerCase() === w.toLowerCase()));
      if (i >= 0 && !preferred.includes(i)) preferred.push(i);
    }
    const order = preferred.length
      ? preferred
      : [...Array(optionCount).keys()];

    // Apply each candidate until one returns a non-empty, single-serviceCode row
    // set. With a label match this is a single pass; the unmatched fallback
    // learns each option's code from `serviceCode=` in the search URL and skips
    // any type the data has no rows for.
    let matched = false;
    let matchedCode = '';
    const tried: string[] = [];
    for (const i of order) {
      await ddInput.click();
      await page.waitForTimeout(500);
      await optionItems.nth(i).click();
      await page.waitForTimeout(400);
      const url = await applyFilter(page);
      expect(url).toContain('serviceCode=');
      const requested = url.match(/[?&]serviceCode=([^&]+)/)?.[1] || '';
      tried.push(requested || optionTexts[i]);
      if (!preferred.length && !targets.includes(requested)) continue; // no rows possible
      await showAllInboxRows(page);
      const rows = await readInboxRows(page);
      if (rows.length === 0) continue;
      const codes = new Set<string>();
      for (const r of rows) codes.add((await apiServiceCode(admin!, r.srid)) || '?');
      expect(codes.size, `all visible rows share one serviceCode (got ${[...codes].join(',')})`).toBe(1);
      matchedCode = [...codes][0];
      expect(matchedCode, 'the narrowed rows are of the type the filter asked for').toBe(requested);
      matched = true;
      break;
    }
    expect(
      matched,
      `at least one complaint type yielded a narrowed, single-type row set `
      + `(types with rows: ${targets.join(',')}; tried: ${tried.join(',')})`,
    ).toBeTruthy();

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
    // Remember the TEXT of the deepest option actually picked. The rows render
    // the localized boundary NAME ("Chesoen"), never the code
    // ("BOMET_BOMET_CENTRAL_CHESOEN") that the request carries, so the code is
    // not a legal thing to compare a row against. This spec used to do exactly
    // that and passed here only by accident: mz.maputo has no boundary
    // localization, so its rows render the raw code and the two happened to
    // match. On a localized deployment the same assertion could never hold.
    let leafLabel = '';
    for (let i = 0; i < 6; i++) {
      const combos = page.locator('button[role="combobox"]');
      const n = await combos.count();
      if (n === 0) break;
      const before = n;
      await combos.nth(n - 1).click();
      await page.waitForTimeout(700);
      const opt = page.getByRole('option').first();
      if (await opt.count() === 0) break;
      leafLabel = (await opt.innerText().catch(() => ''))?.trim() || leafLabel;
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
    // Accept the localized name we picked OR the raw code, so this reads the
    // same on a localized deployment and on one still rendering raw keys.
    const expected = [leafLabel, leaf].filter(Boolean);
    expect(
      rows.every((r) => expected.includes(r.locality)),
      `every visible row is in the chosen locality (expected ${expected.join(' or ')}, saw ${[...new Set(rows.map((r) => r.locality))].join(' | ')})`,
    ).toBeTruthy();

    await clearFilters(page);
    expect((await readInboxRows(page)).length).toBeGreaterThan(0);
  });
});
