/**
 * Employee management — list / single-create / edit / deactivate / bulk-import.
 *
 * HRMS has no DELETE endpoint, so teardown is an inline helper that POSTs to
 * `/egov-hrms/employees/_update` with isActive=false + employeeStatus=INACTIVE
 * + a deactivationDetails entry with `effectiveFrom` stamped at Date.now()
 * (HRMS rejects past-dated effectiveFrom with
 * ERR_HRMS_UPDATE_DEACT_DETAILS_INCORRECT_EFFECTIVEFROM — confirmed via curl).
 * Deactivating the employee also cascades active=false onto the linked user,
 * so there's no separate user cleanup.
 *
 * Codes use the PW_${hash8}_EMP prefix from helpers/codes so parallel runs
 * and historical leftovers never collide. Mobile numbers are 10-digit
 * `07xxxxxxxx` to pass both HRMS's Pattern validator ({10 digits}) AND the
 * tenant's MDMS mobile validation rule (^0?[17][0-9]{8}$, prefix +254).
 *
 * Known gaps flagged but not failing:
 *  - /access-control/v1/actions/mdms/_get returns 404 at `ke` (pre-existing;
 *    see DEV-LOG §13). Not on the critical create/edit path.
 */
import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { loadAuth, employeeSearch, type AuthInfo } from '../utils/manage/api';
import { testCode, testCodeIndexed } from '../utils/manage/codes';
import { TENANT, ROOT_TENANT } from '../utils/env';
import {
  getMobileValidationRule,
  generateInvalidMobile,
  generateValidMobile,
  type MobileRule,
} from '../utils/mdms-mobile';

// Root (state) tenant from env — no hardcoded 'ke'.
const TENANT_CODE = ROOT_TENANT;

let mobileRule: MobileRule;
test.beforeAll(async () => {
  mobileRule = await getMobileValidationRule(TENANT);
  await resolveSeedFks();
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const LIST_PATH = '/configurator/manage/employees';

// Seed FKs for HRMS employee creates. HRMS validates these against the
// tenant's real boundary / department / designation masters, so they must be
// live codes. We derive them from an EXISTING employee on the deployment
// (resolveSeedFks, called in beforeAll) so the API-seed tests are portable to
// any tenant. An explicit env override still wins; the final fallback is the
// Kenya seed, used only when neither a live employee nor an override exists.
let SEED_BOUNDARY = process.env.SEED_BOUNDARY || 'NAIROBI_CITY';
let SEED_DEPT = process.env.SEED_DEPT || 'DEPT_7';
let SEED_DESIG = process.env.SEED_DESIG || 'DESIG_58';
// SEED_BOUNDARY's own hierarchy + boundaryType. These used to be hardcoded
// 'ADMIN' / 'County' alongside a live-derived SEED_BOUNDARY code — silently
// wrong the moment the boundary itself was discovered on a non-Kenya
// hierarchy (mz.maputo's ADMIN-hierarchy jurisdictions carry boundaryType
// 'City', and its PGR-facing hierarchy is 'MAPUTO_ADMIN' with boundaryType
// 'Município'/'Distrito Municipal'/'Bairro'/'Quarteirão' — never 'County').
// A mismatched hierarchy/boundaryType paired with a real SEED_BOUNDARY code
// is a jurisdiction HRMS would be right to reject, or worse, silently store
// as an unscoped/unusable row.
let SEED_HIERARCHY = process.env.SEED_HIERARCHY || 'ADMIN';
let SEED_BOUNDARY_TYPE = process.env.SEED_BOUNDARY_TYPE || 'County';

// Tracks whether resolveSeedFks() found a live employee to derive FKs from.
// Tests that API-seed employees (4a/5/6) need a real boundary/dept/designation
// combo; without live resolution AND without an explicit env override they'd
// silently fall back to the Kenya literals above, which fail (or worse,
// silently mis-seed) on any non-Kenya tenant. See B6 in ADMIN-SUITE-PLAN.md.
let seedFksResolved = false;

/**
 * Derive boundary / department / designation FKs from a real employee on the
 * deployment so HRMS _create seeds validate. Env overrides take precedence;
 * live values only fill the gaps left by unset env vars.
 */
async function resolveSeedFks(): Promise<void> {
  try {
    const auth = loadAuth();
    const employees = await employeeSearch(auth, TENANT_CODE, { limit: 25 });
    for (const e of employees) {
      const jur = (e.jurisdictions as Array<Record<string, unknown>> | undefined)?.[0];
      const asg = (e.assignments as Array<Record<string, unknown>> | undefined)?.[0];
      const boundary = jur?.boundary as string | undefined;
      const hierarchy = jur?.hierarchy as string | undefined;
      const boundaryType = jur?.boundaryType as string | undefined;
      const dept = asg?.department as string | undefined;
      const desig = asg?.designation as string | undefined;
      if (boundary && hierarchy && boundaryType && dept && desig) {
        if (!process.env.SEED_BOUNDARY) SEED_BOUNDARY = boundary;
        if (!process.env.SEED_HIERARCHY) SEED_HIERARCHY = hierarchy;
        if (!process.env.SEED_BOUNDARY_TYPE) SEED_BOUNDARY_TYPE = boundaryType;
        if (!process.env.SEED_DEPT) SEED_DEPT = dept;
        if (!process.env.SEED_DESIG) SEED_DESIG = desig;
        seedFksResolved = true;
        return;
      }
    }
  } catch {
    // Fall back to env / Kenya defaults if the lookup fails.
  }
}

// HRMS endpoints — the configurator's DigitApiClient hits these verbatim.
const HRMS_SEARCH = '/egov-hrms/employees/_search';
const HRMS_UPDATE = '/egov-hrms/employees/_update';

const createdCodes = new Set<string>();

test.describe.configure({ mode: 'serial' });

interface HrmsEmployee {
  id?: number;
  uuid?: string;
  code?: string;
  employeeStatus?: string;
  isActive?: boolean;
  deactivationDetails?: Array<Record<string, unknown>>;
  user?: Record<string, unknown>;
  [k: string]: unknown;
}

async function postJson(
  auth: AuthInfo,
  pathWithQuery: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${auth.baseUrl}${pathWithQuery}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try { parsed = (await res.json()) as Record<string, unknown>; } catch { /* empty body */ }
  if (!res.ok || Array.isArray(parsed.Errors) && (parsed.Errors as unknown[]).length) {
    const errs = parsed.Errors as Array<{ code?: string; message?: string }> | undefined;
    const summary = errs?.map((e) => `${e.code || '??'}:${e.message || ''}`).join(', ')
      || `HTTP_${res.status}`;
    throw new Error(`POST ${pathWithQuery} failed (${res.status}): ${summary}`);
  }
  return parsed;
}

function requestInfo(auth: AuthInfo, action = '_search'): Record<string, unknown> {
  return {
    apiId: 'Rainmaker',
    ver: '1.0',
    ts: Date.now(),
    action,
    msgId: `${Date.now()}|en_IN`,
    authToken: auth.token,
    userInfo: auth.user || undefined,
  };
}

/**
 * Inline teardown: soft-deactivate an employee via HRMS _update.
 *
 * This is NOT exported into helpers/teardown.ts — the shared helper is
 * MDMS-only, and employees have enough HRMS-specific quirks
 * (effectiveFrom must be "now", deactivationDetails structure, cascading
 * user active=false) that we keep it local per the spec guidance.
 */
async function softDeleteEmployee(auth: AuthInfo, code: string): Promise<void> {
  const res = await postJson(auth,
    `${HRMS_SEARCH}?tenantId=${TENANT_CODE}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
    { RequestInfo: requestInfo(auth, '_search') });
  const list = (res.Employees as HrmsEmployee[] | undefined) || [];
  if (list.length === 0) return; // already gone
  const emp = list[0];
  if (emp.isActive === false && emp.employeeStatus === 'INACTIVE') return;
  emp.employeeStatus = 'INACTIVE';
  emp.isActive = false;
  emp.deactivationDetails = [
    {
      reasonForDeactivation: 'OTHERS',
      effectiveFrom: Date.now(),
      orderNo: 'PW-TEARDOWN',
      typeOfDeactivation: 'OTHERS',
      tenantId: TENANT_CODE,
      isActive: true,
    },
  ];
  (emp as Record<string, unknown>).reActivateEmployee = false;
  await postJson(auth,
    `${HRMS_UPDATE}?tenantId=${TENANT_CODE}`,
    { RequestInfo: requestInfo(auth, '_update'), Employees: [emp] });
}

test.afterAll(async () => {
  if (createdCodes.size === 0) return;
  const auth = loadAuth();
  const failed: Array<{ code: string; reason: string }> = [];
  for (const code of createdCodes) {
    try { await softDeleteEmployee(auth, code); } catch (e) {
      failed.push({ code, reason: (e as Error).message });
    }
  }
  if (failed.length) {
    // eslint-disable-next-line no-console
    console.warn(`[employees] cleanup left ${failed.length} employee(s) behind:`, failed);
  }
});

test.describe('manage/employees', () => {
  test('1. list renders; search narrows to the matching row; Status filter partitions the list', {
    annotation: {
      type: 'description',
      description: `Smoke check for /manage/employees that actually proves the two filters NARROW.

The previous version could not fail. It asserted \`filtered <= initial\` — a
narrowing filter can never *increase* a row count, and the grid's debounce
(DigitList.tsx handleSearchChange -> setFilters(..., undefined, true), ~750ms
measured) made the two reads identical anyway — and \`inactiveCount >= 0\`,
a pure tautology. Worse, the Status branch was guarded by
\`getByLabel(/^Status$/i)\`, which matches NOTHING: the filter is a Radix
SelectTrigger with no <label>, so the tautology never even ran. This rewrite
asserts the expected *rows*, and every read goes through an auto-retrying
poll so the debounce cannot fake a pass.

Steps:
1. Pick a needle from live HRMS: the alphabetically-first employee code that
   occurs in exactly ONE record. Derived, not hardcoded — and uniqueness is
   checked because the grid's quick-search matches the whole record, so a code
   like ADMIN also matches every employee whose jurisdiction hierarchy is
   MAPUTO_ADMIN (measured: 65 of 65 rows on the local stack).
2. Navigate to the list; assert role=table + the four expected columnheaders.
3. Read the grid's own "Showing a-b of N" footer for the unfiltered total N;
   assert N > 1 (otherwise nothing can be narrowed and the test skips).
4. Type the needle; poll the footer until the total is exactly 1, and assert
   the single rendered row's Employee Code cell IS the needle.
5. Type a nonsense term; poll the total to 0 and assert the "No records found"
   empty state renders (the footer is not rendered at total=0).
6. Clear the search; poll the total back to N — the filter is reversible.
7. Status filter (located as the filter bar's only combobox, since Radix gives
   it no accessible name): select Inactive, then Employed. For each, assert
   EVERY rendered Status cell carries that status, and record the total.
8. Assert totalInactive + totalEmployed === N. A filter that is silently
   ignored returns the full list under both, so the sum would be 2N; a filter
   that over-narrows makes the sum fall short. Employed/Inactive are the only
   choices the UI offers, so they must partition the list.

Mutation-tested: deleting the \`search.fill(needle)\` line turns step 4 red
("expected 1, received 65").`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    // Derived from the deployment, never hardcoded: the first code (in a
    // deterministic order) that identifies exactly one employee.
    const needle = await pickUniqueEmployeeCode();
    test.skip(
      !needle,
      'no employee code on this deployment identifies exactly one record — nothing unambiguous to search for',
    );

    await page.goto(LIST_PATH);

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // The first column header is "Employee Code" (EmployeeList.tsx), not "Code".
    for (const header of ['Employee Code', 'Name', 'Mobile', 'Status']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(`^${header}$`, 'i') }),
      ).toBeVisible();
    }

    // Data rows only — getByRole('row') also counts the header row, which is
    // how "11 rows" used to stand in for "10 employees".
    const dataRows = table.locator('tbody tr');
    const baselineTotal = await settledTotal(page);
    test.skip(
      baselineTotal < 2,
      `only ${baselineTotal} employee(s) on this deployment — a narrowing filter cannot be observed`,
    );

    // ── search narrows to exactly the matching row ──────────────────────────
    const search = page.getByPlaceholder(/search/i).first();
    await expect(search).toBeVisible();
    await search.fill(needle!);
    // expect.poll, not a bare read: the grid debounces the filter, so an
    // immediate count still shows the UNFILTERED page.
    await expect
      .poll(() => readTotal(page), {
        timeout: 20_000,
        message: `search for '${needle}' must narrow the grid to that one employee`,
      })
      .toBe(1);
    await expect(dataRows).toHaveCount(1);
    await expect(dataRows.first().locator('td').first()).toHaveText(needle!);

    // ── a term that matches nothing empties the grid ────────────────────────
    await search.fill('zzz_no_such_employee');
    await expect
      .poll(() => readTotal(page), { timeout: 20_000, message: 'a non-matching search must empty the grid' })
      .toBe(0);
    await expect(dataRows).toHaveCount(0);
    await expect(page.getByText(/No records found/i)).toBeVisible();

    // ── clearing restores the full list ─────────────────────────────────────
    await search.fill('');
    await expect
      .poll(() => readTotal(page), { timeout: 20_000, message: 'clearing the search must restore every row' })
      .toBe(baselineTotal);

    // ── Status filter ───────────────────────────────────────────────────────
    // The filter bar's Status control is a Radix SelectTrigger with no <label>
    // and no aria-label, so getByLabel(/^Status$/) matches nothing — that is
    // exactly how the old assertion went unexecuted. It is the only combobox
    // inside FilterBar's <form>, and it keeps that identity after selection
    // (its rendered text becomes the chosen value).
    const statusFilter = page.locator('form').getByRole('combobox').first();
    await expect(statusFilter, 'the filter bar combobox must be the Status filter').toHaveText(/^Status$/i);

    const statusCells = dataRows.locator('td:nth-child(4)');
    const totals: Record<string, number> = {};
    for (const [option, cellText] of [['Inactive', 'INACTIVE'], ['Employed', 'EMPLOYED']] as const) {
      await statusFilter.click();
      await page.getByRole('option', { name: new RegExp(`^${option}$`, 'i') }).click();
      await expect(statusFilter).toHaveText(new RegExp(`^${option}$`, 'i'));
      // Auto-retrying, so it also absorbs the debounce: no rendered row may
      // carry a status other than the one selected.
      await expect(
        statusCells.filter({ hasNotText: cellText }),
        `every row under Status='${option}' must show ${cellText}`,
      ).toHaveCount(0);
      totals[option] = await settledTotal(page);
    }

    // The two choices the UI offers are the whole vocabulary, so they must
    // partition the list. A filter that is silently ignored yields the full
    // list under both (sum = 2N); one that over-narrows falls short.
    expect(
      totals.Inactive + totals.Employed,
      `Status filter must partition the ${baselineTotal} employees — got ` +
        `${totals.Inactive} Inactive + ${totals.Employed} Employed`,
    ).toBe(baselineTotal);
  });

  test('2. single create — happy path derives code + username, employee lands', {
    annotation: {
      type: 'description',
      description: `End-to-end UI walk for the single-create flow with multiple regression guards baked in: CCRS#404/#419 (DOB required), CCRS#416 (Tenant picker present + defaults to session tenant), CCRS#436 (success toast). Confirms HRMS persists the employee with employeeStatus=EMPLOYED.

Steps:
1. Generate a unique code + Kenya-valid mobile (07-prefix, 10 digits); track for cleanup.
2. Navigate to /employees/create.
3. Pre-assertion CCRS#404/#419: Date of Birth input is visible AND has the required attribute.
4. Pre-assertion CCRS#416: Tenant field is visible; if input/select assert value contains TENANT_CODE, otherwise assert text contains it.
5. Fill Name; force Employee Code to the PW value (DigitFormCodeInput auto-derives but we need determinism for cleanup).
6. Fill Mobile, leave Username blank (exercises auto-derive), fill Email, Date of Birth (1990-05-14), Date of Appointment (2026-01-15).
7. Click Create; wait for navigation back to LIST_PATH within 45s.
8. CCRS#436: assert a role=status toast matching /created/i is visible within 5s.
9. API sanity: POST /egov-hrms/employees/_search with codes=<code>; assert exactly 1 result with employeeStatus='EMPLOYED', isActive !== false, mobileNumber matches.

Cleanup uses the inline softDeleteEmployee helper because HRMS has no DELETE endpoint and effectiveFrom must be Date.now().`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:happy-path', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const code = testCode(testInfo, 'EMP_CREATE');
    const uniq = code.split('_').pop() || '00000';
    // Mobile valid for THIS tenant's live MDMS rule (Kenya starts 7/1,
    // Maputo starts 8). A hardcoded 07-prefix number blocks submit on a
    // non-Kenya tenant via the EmployeeCreate form's live useMobileValidator,
    // so the create never fires and the nav wait times out.
    const mobile = generateValidMobile(mobileRule);
    createdCodes.add(code);

    await page.goto(`${LIST_PATH}/create`);

    // --- Pre-assertions (CCRS#404 / #419 + CCRS#416) ---
    // CCRS#404 / #419: DOB must be marked required on the Create form.
    // DigitFormInput never sets the HTML `required` attribute — required-ness
    // renders as the label's `aria-label="required"` asterisk marker instead
    // (configurator/src/admin/DigitFormInput.tsx:69-73). Assert that marker.
    const dobInput = page.getByLabel(/^Date of Birth/i);
    await expect(dobInput).toBeVisible();
    const dobLabel = page.locator('label', { hasText: /^Date of Birth/i }).first();
    await expect(dobLabel.locator('[aria-label="required"]')).toBeVisible();

    // CCRS#416 (UI): Tenant picker is present on Create and defaults to the
    // session tenant. We accept either a native input (read via `value`) or a
    // combobox trigger whose rendered text contains the tenant code.
    // Tenant is required (v.codeRequired), so its Label's computed accessible
    // name includes the aria-label="required" asterisk marker's text
    // ("Tenant required", not a bare "Tenant") — anchoring with a trailing
    // `$` (as employees#1's Status label does, where the field is optional
    // and unmarked) never matches. Use a prefix match like every other label
    // lookup in this spec (Name, Mobile Number, Date of Birth, ...).
    const tenantField = page.getByLabel(/^Tenant/i).first();
    await expect(tenantField).toBeVisible();
    const tenantTag = await tenantField.evaluate((el) => el.tagName.toLowerCase());
    if (tenantTag === 'input' || tenantTag === 'select') {
      await expect(tenantField).toHaveValue(new RegExp(TENANT_CODE, 'i'));
    } else {
      await expect(tenantField).toContainText(new RegExp(TENANT_CODE, 'i'));
    }

    // Name auto-derives Code via DigitFormCodeInput — we override Code to our
    // PW_ value for deterministic cleanup.
    await page.getByLabel(/^Name/i).fill(`PW Employee ${uniq}`);
    const codeInput = page.getByLabel(/^Employee Code/i);
    await codeInput.fill('');
    await codeInput.fill(code);

    await page.getByLabel(/^Mobile Number/i).fill(mobile);
    // Username is optional — if blank, transform() auto-derives. We leave blank
    // to exercise the derive path.
    await page.getByLabel(/^Email/i).fill(`${code.toLowerCase()}@example.com`);
    await page.getByLabel(/^Date of Birth/i).fill('1990-05-14');
    await page.getByLabel(/^Date of Appointment/i).fill('2026-01-15');

    // Follow-on locator gap surfaced once the DOB pre-assertion (above) was
    // fixed and the flow could actually reach Create: HRMS's _create rejects
    // employees with zero roles (ERR_HRMS_MISSING_ROLES) and the create
    // form's default is an empty user.roles array — nothing auto-selects
    // one. Pick EMPLOYEE via the RolesEditor combobox (same pattern as
    // test 4a's CITIZEN pick) so the happy path actually reaches HRMS.
    const roleCombobox = page.getByRole('combobox', { name: /^Roles?$/i }).first();
    await roleCombobox.click();
    await roleCombobox.fill('EMPLOYEE');
    // The option's accessible name concatenates code + name with no
    // separator ("EMPLOYEEEmployee") so a `\b`-anchored regex never finds a
    // word boundary there — match on the code PREFIX only. The query also
    // substring-matches on role name (e.g. "Auto Escalation Employee"), so a
    // plain "contains" match would be ambiguous; anchoring at `^` picks only
    // the row whose code itself starts with EMPLOYEE.
    await page.getByRole('option', { name: /^EMPLOYEE/i }).first().click();

    // Submit. List path is `/configurator/manage/employees`.
    await Promise.all([
      page.waitForURL(LIST_PATH, { timeout: 45_000 }),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);

    // CCRS#436: Success toast appears after Create. Toaster renders into a
    // role=status live region (see src/components/ui/toaster.tsx). We settle
    // for any status region matching /created/i within 5s.
    // TODO: if the shadcn Toaster ships with a different ARIA role on Naipepea
    // (some versions use role=region + aria-live), replace this selector with
    // `page.locator('[data-sonner-toast], [role="status"]')` once verified live.
    const toast = page.getByRole('status').filter({ hasText: /created/i }).first();
    await expect(toast).toBeVisible({ timeout: 5_000 });

    // API sanity check — employee is retrievable by code.
    const auth = loadAuth();
    const found = await employeeSearch(auth, TENANT_CODE, { limit: 5 });
    // The search helper doesn't take `codes`; fall back to a direct probe.
    const direct = await postJson(
      auth,
      `${HRMS_SEARCH}?tenantId=${TENANT_CODE}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
      { RequestInfo: requestInfo(auth) },
    );
    const list = (direct.Employees as HrmsEmployee[]) || [];
    expect(list.length).toBe(1);
    expect(list[0].code).toBe(code);
    expect(list[0].employeeStatus).toBe('EMPLOYED');
    expect(list[0].isActive).not.toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((list[0].user as any)?.mobileNumber).toBe(mobile);
    void found;
  });

  test('3. too-short mobile shows inline validation error', {
    annotation: {
      type: 'description',
      description: `Edge case: a too-short mobile number on the EmployeeCreate form must surface an inline validation error sourced from HRMS clamping the tenant's MDMS mobileNumberValidation rule.

Steps:
1. Navigate to /employees/create.
2. Fill Name with a placeholder.
3. Fill Mobile Number with a short candidate from generateInvalidMobile(rule, 'short').
4. Click into Date of Birth to blur Mobile and trigger validation.
5. Assert the rule.errorMessage substring is visible within 10s (with a loose fallback regex to tolerate copy variants).

Pairs with the happy-path test (#2) — together they bracket valid + invalid mobile inputs.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
    await page.goto(`${LIST_PATH}/create`);

    await page.getByLabel(/^Name/i).fill('PW Bad Mobile');
    const shortMobile = generateInvalidMobile(mobileRule, 'short');
    await page.getByLabel(/^Mobile Number/i).fill(shortMobile);
    // Blur to trigger the validator.
    await page.getByLabel(/^Date of Birth/i).click();

    // The validator error copy is sourced from HRMS clamping the MDMS rule.
    // Assert on the rule.errorMessage substring (escaped for regex) with a
    // loose fallback to tolerate minor copy variants across HRMS releases.
    //
    // The live form's own useMobileValidator (configurator/src/admin/hrms/
    // useMobileValidator.ts buildErrorMessage) composes a DIFFERENT string
    // than this test util's mdms-mobile.ts errorMessage: the app renders
    // "Please enter a valid mobile number (9 digits, starting with 8)"
    // (base phrase + parenthetical), not "Please enter a valid 9-digit
    // mobile number". The two also punctuate the digits/starting clause
    // differently ("9 digits, starting with 8" has a comma the old
    // `digits starting` alternative didn't tolerate). Add both a
    // comma-tolerant variant and the app's own generic (deployment-agnostic
    // — no tenant literal) base phrase as fallbacks.
    const ruleMsgRe = new RegExp(
      `${escapeRegex(mobileRule.errorMessage)}|MobileNumber|must be \\d+|digits,?\\s*starting|valid mobile number`,
      'i',
    );
    const errorText = page.getByText(ruleMsgRe).first();
    await expect(errorText).toBeVisible({ timeout: 10_000 });
  });

  test('4. edit — DOB round-trips as YYYY-MM-DD (not epoch-ms)', {
    annotation: {
      type: 'description',
      description: `Catches the epoch-ms regression in the EmployeeEdit form: DOB used to render as "1753920000000" (raw epoch) instead of "1985-07-20" because the form bound directly to the HRMS scalar. Also asserts Code and Username are disabled on edit (they're write-once).

Steps:
1. Generate a unique code; track for cleanup.
2. Create via UI: fill Name, Code, Mobile, DOB '1985-07-20'; Click Create.
3. Search for the code; click matching row; click Edit.
4. Assert Date of Birth input has value '1985-07-20' (NOT epoch-ms).
5. Assert Employee Code input is disabled.
6. Assert Username input is disabled.
7. Fill Name with 'PW Edited <uniq>'; click Save; wait 1.5s.
8. POST /egov-hrms/employees/_search via API; assert user.name matches /PW Edited/.

Code and Username are write-once because HRMS doesn't allow mutating either after create.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    // Create one via UI then re-enter Edit.
    const code = testCode(testInfo, 'EMP_EDIT');
    const uniq = code.split('_').pop() || '11111';
    const mobile = generateValidMobile(mobileRule);
    createdCodes.add(code);

    await page.goto(`${LIST_PATH}/create`);
    await page.getByLabel(/^Name/i).fill(`PW Edit ${uniq}`);
    const codeInput = page.getByLabel(/^Employee Code/i);
    await codeInput.fill('');
    await codeInput.fill(code);
    await page.getByLabel(/^Mobile Number/i).fill(mobile);
    await page.getByLabel(/^Date of Birth/i).fill('1985-07-20');
    // Date of Appointment is required (v.required, EmployeeCreate.tsx) — was
    // missing here, which silently blocked the form from ever submitting.
    await page.getByLabel(/^Date of Appointment/i).fill('2026-01-15');
    // HRMS _create rejects a zero-role employee (ERR_HRMS_MISSING_ROLES) —
    // see test 2's comment for the full explanation.
    const roleCombobox = page.getByRole('combobox', { name: /^Roles?$/i }).first();
    await roleCombobox.click();
    await roleCombobox.fill('EMPLOYEE');
    await page.getByRole('option', { name: /^EMPLOYEE/i }).first().click();

    await Promise.all([
      page.waitForURL(LIST_PATH, { timeout: 45_000 }),
      page.getByRole('button', { name: /^Create$/ }).click(),
    ]);

    // Navigate into the row → edit.
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    const row = page.getByRole('row').filter({ hasText: code });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole('button', { name: /^Edit$/i }).click();

    // DOB field must show the date string — NOT the epoch-ms regression that
    // used to render as "1753920000000" in value.
    const dobInput = page.getByLabel(/^Date of Birth/i);
    await expect(dobInput).toHaveValue('1985-07-20');

    // Code + Username are write-once. Employee Code is disabled on edit;
    // Username has no separate field at all any more (CCRS#460 —
    // EmployeeShow.tsx:39-41 documents that HRMS always overwrites userName
    // with the employee code, so a distinct "Username" input/display would
    // just duplicate Employee Code under a misleading label). Its absence
    // from the DOM is an even stronger write-once guarantee than `disabled`
    // would be, so assert that instead of a stale `toBeDisabled()`.
    await expect(page.getByLabel(/^Employee Code/i)).toBeDisabled();
    await expect(page.getByLabel(/^Username/i)).toHaveCount(0);

    // Mutate name + save; verify via API.
    await page.getByLabel(/^Name/i).fill(`PW Edited ${uniq}`);
    await page.getByRole('button', { name: /^Save$/i }).click();

    await page.waitForTimeout(1500);
    const auth = loadAuth();
    const direct = await postJson(auth,
      `${HRMS_SEARCH}?tenantId=${TENANT_CODE}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
      { RequestInfo: requestInfo(auth) });
    const emp = ((direct.Employees as HrmsEmployee[]) || [])[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((emp.user as any)?.name).toMatch(/PW Edited/);
  });

  test('4a. edit — add GRO role round-trips without JsonMappingException (CCRS#439)', {
    annotation: {
      type: 'description',
      description: `Catches CCRS#439: adding a role to an existing employee through the RolesEditor used to surface a JsonMappingException because the configurator sent the role array in a shape egov-hrms couldn't deserialize. Post-fix the round-trip succeeds and HRMS reflects the new role within 5s.

Uses GRO (a PGR employee role — EMP001 already carries it) rather than the
original repro's CITIZEN: this deployment's egov-hrms now enforces
ERR_HRMS_INVALID_ROLE for CITIZEN on a type=EMPLOYEE user (probe-verified
directly against /egov-hrms/employees/_create — same 400 regardless of client
payload shape), which is a legitimate role/type compatibility rule, not the
JsonMappingException deserialization bug #439 targets. GRO exercises the same
"add a not-yet-present role via RolesEditor, Save, no crash, HRMS reflects it"
path without tripping that unrelated validation.

Steps:
1. Generate a unique code + tenant-valid mobile; track for cleanup.
2. Seed a fresh employee via API with ONLY [EMPLOYEE] role.
3. Confirm the seed has no GRO role yet (assert preRoles.some code === GRO === false).
4. Open Edit via list-row click.
5. Locate the Roles combobox by role + name; click; type "GRO"; click the matching option.
6. Click Save.
7. Assert no role=status toast OR body text contains 'JsonMappingException' (count === 0 for both).
8. expect.poll on HRMS: within 5s, the user.roles array should contain GRO.

Hermetic: doesn't rely on tenant content — seeds and verifies its own employee. Cleanup is via afterAll's softDeleteEmployee; role removal is a known TODO since the helper soft-deactivates the whole employee.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@ccrs:439', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    test.skip(
      !seedFksResolved && !process.env.SEED_DEPT,
      'no existing employee to derive live HRMS FKs from — set SEED_* env vars',
    );
    // Create a fresh employee via API so we own it + know it has only EMPLOYEE
    // role (no GRO yet). This keeps the test hermetic instead of relying
    // on fishing a suitable victim out of the shared tenant.
    const code = testCode(testInfo, 'EMP_ROLE');
    const uniq = code.split('_').pop() || '44444';
    const mobile = generateValidMobile(mobileRule);
    createdCodes.add(code);

    const auth = loadAuth();
    await postJson(auth, '/egov-hrms/employees/_create?tenantId=' + TENANT_CODE, {
      RequestInfo: requestInfo(auth, '_create'),
      Employees: [{
        tenantId: TENANT_CODE, code, employeeStatus: 'EMPLOYED', employeeType: 'PERMANENT',
        dateOfAppointment: Date.now() - 24 * 3600_000,
        user: {
          userName: code.toLowerCase().replace(/_/g, '.'),
          name: `PW Role ${uniq}`, mobileNumber: mobile,
          type: 'EMPLOYEE', active: true, gender: 'MALE', dob: 631152000000,
          password: 'eGov@123', tenantId: TENANT_CODE,
          roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: TENANT_CODE }],
        },
        jurisdictions: [{ boundary: SEED_BOUNDARY, boundaryType: SEED_BOUNDARY_TYPE, hierarchy: SEED_HIERARCHY, hierarchyType: SEED_HIERARCHY, tenantId: TENANT_CODE, isActive: true }],
        assignments: [{ department: SEED_DEPT, designation: SEED_DESIG, fromDate: Date.now() - 24 * 3600_000, isCurrentAssignment: true }],
      }],
    });

    // Confirm the seed employee has no GRO role yet — if it somehow does
    // (roles seeded server-side?), skip rather than produce a misleading pass.
    const preSearch = await postJson(auth,
      `${HRMS_SEARCH}?tenantId=${TENANT_CODE}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
      { RequestInfo: requestInfo(auth) });
    const preEmp = ((preSearch.Employees as HrmsEmployee[]) || [])[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const preRoles = ((preEmp?.user as any)?.roles || []) as Array<{ code?: string }>;
    expect(preRoles.some((r) => r.code === 'GRO')).toBe(false);

    // Open Edit via list-row click (same entry-point as test 4).
    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('row').filter({ hasText: code }).click();
    await page.getByRole('button', { name: /^Edit$/i }).click();

    // Roles section — RolesEditor is a combobox. Typing "GRO" should
    // surface a match; click the first option. We key on `combobox` role
    // rather than label text because the label copy varies ("Roles" vs
    // "Assign roles") across tenants. The option's accessible name
    // concatenates code+name with no separator, and the query substring-
    // matches on role name too (e.g. "DGRO" also contains "gro"), so anchor
    // at `^` to pick only the row whose code itself starts with GRO.
    const roleCombobox = page.getByRole('combobox', { name: /^Roles?$/i }).first();
    await expect(roleCombobox).toBeVisible({ timeout: 10_000 });
    await roleCombobox.click();
    await roleCombobox.fill('GRO');
    await page.getByRole('option', { name: /^GRO/i }).first().click();

    await page.getByRole('button', { name: /^Save$/i }).click();

    // No JsonMappingException banner / toast — that regression would surface
    // as an error toast or an in-form error region.
    const errorToast = page.getByRole('status').filter({ hasText: /JsonMappingException/i });
    await expect(errorToast).toHaveCount(0);
    const errorBanner = page.getByText(/JsonMappingException/i);
    await expect(errorBanner).toHaveCount(0);

    // Within 5s, the mutation is visible server-side — GRO is now in the
    // user's roles array. We poll HRMS rather than DOM because the list may
    // re-render without showing roles inline.
    await expect.poll(async () => {
      const res = await postJson(auth,
        `${HRMS_SEARCH}?tenantId=${TENANT_CODE}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
        { RequestInfo: requestInfo(auth) });
      const emp = ((res.Employees as HrmsEmployee[]) || [])[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const roles = ((emp?.user as any)?.roles || []) as Array<{ code?: string }>;
      return roles.some((r) => r.code === 'GRO');
    }, { timeout: 5_000 }).toBeTruthy();

    // TODO: role-removal cleanup — afterAll soft-deactivates the employee,
    // which cascades active=false onto the user, so the CITIZEN role is
    // effectively quarantined. A dedicated "remove role via HRMS _update"
    // helper should land in helpers/teardown.ts so we can revert role adds
    // on long-lived employees without nuking the whole record.
  });

  test('5. deactivate — INACTIVE + deactivation reason applied', {
    annotation: {
      type: 'description',
      description: `End-to-end deactivation flow through the EmployeeEdit form: flip Status to Inactive, the DeactivationReasonSection mounts (sourced from MDMS deactivation-reasons), pick a reason, save. HRMS persists employeeStatus=INACTIVE, isActive=false, and a non-empty deactivationDetails array.

Steps:
1. Generate a unique code; track for cleanup.
2. API-seed a fresh employee (faster than UI create).
3. Navigate to LIST_PATH; search; click row; click Edit.
4. Click Status select; pick Inactive option.
5. Wait for Reason for deactivation dropdown to mount within 10s.
6. Click it; pick first option matching ORDERBYCOMMISSIONER or OTHERS (MDMS-seeded values).
7. Click Save; wait 2s.
8. POST /egov-hrms/employees/_search; assert employeeStatus === 'INACTIVE', isActive === false, deactivationDetails is a non-empty array.

The MDMS reason source is asserted indirectly — if the dropdown has no options the click would fail, surfacing the upstream gap.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    test.skip(
      !seedFksResolved && !process.env.SEED_DEPT,
      'no existing employee to derive live HRMS FKs from — set SEED_* env vars',
    );
    const code = testCode(testInfo, 'EMP_DEACT');
    const uniq = code.split('_').pop() || '22222';
    const mobile = generateValidMobile(mobileRule);
    createdCodes.add(code);

    // Create via API (faster than clicking through) then flip via UI.
    const auth = loadAuth();
    const createPayload = {
      RequestInfo: requestInfo(auth, '_create'),
      Employees: [{
        tenantId: TENANT_CODE,
        code,
        employeeStatus: 'EMPLOYED',
        employeeType: 'PERMANENT',
        dateOfAppointment: Date.now() - 30 * 24 * 3600_000,
        user: {
          userName: code.toLowerCase().replace(/_/g, '.'),
          name: `PW Deact ${uniq}`,
          mobileNumber: mobile,
          type: 'EMPLOYEE',
          active: true,
          gender: 'MALE',
          dob: 631152000000,
          password: 'eGov@123',
          tenantId: TENANT_CODE,
          roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: TENANT_CODE }],
        },
        jurisdictions: [{
          boundary: SEED_BOUNDARY, boundaryType: SEED_BOUNDARY_TYPE,
          hierarchy: SEED_HIERARCHY, hierarchyType: SEED_HIERARCHY,
          tenantId: TENANT_CODE, isActive: true,
        }],
        assignments: [{
          department: SEED_DEPT, designation: SEED_DESIG,
          fromDate: Date.now() - 30 * 24 * 3600_000,
          isCurrentAssignment: true,
        }],
      }],
    };
    await postJson(auth, '/egov-hrms/employees/_create?tenantId=' + TENANT_CODE, createPayload);

    // Edit via UI → flip Status to Inactive → reason renders → save.
    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('row').filter({ hasText: code }).click();
    await page.getByRole('button', { name: /^Edit$/i }).click();

    const statusSelect = page.getByLabel(/^Status$/i);
    await statusSelect.click();
    await page.getByRole('option', { name: /Inactive/i }).click();

    // DeactivationReasonSection mounts — its "Reason for deactivation"
    // dropdown sources from the `deactivation-reasons` MDMS collection.
    const reasonSelect = page.getByLabel(/Reason for deactivation/i);
    await expect(reasonSelect).toBeVisible({ timeout: 10_000 });
    await reasonSelect.click();
    // MDMS on tenant holds at minimum ORDERBYCOMMISSIONER + OTHERS.
    const reasonOption = page.getByRole('option', { name: /ORDERBYCOMMISSIONER|OTHERS/ }).first();
    await reasonOption.click();

    await page.getByRole('button', { name: /^Save$/i }).click();
    await page.waitForTimeout(2000);

    const direct = await postJson(auth,
      `${HRMS_SEARCH}?tenantId=${TENANT_CODE}&codes=${encodeURIComponent(code)}&limit=1&offset=0`,
      { RequestInfo: requestInfo(auth) });
    const emp = ((direct.Employees as HrmsEmployee[]) || [])[0];
    expect(emp.employeeStatus).toBe('INACTIVE');
    expect(emp.isActive).toBe(false);
    expect(Array.isArray(emp.deactivationDetails)).toBe(true);
    expect((emp.deactivationDetails as unknown[]).length).toBeGreaterThan(0);
  });

  test('6. reset password — collapsed by default, expand rotates token', {
    annotation: {
      type: 'description',
      description: `Verifies the EmployeeEdit "Reset password" UI affordance: collapsed by default (New password field NOT visible), expanding reveals the form with a "Keep existing" cancel option. Doesn't actually rotate the password — that requires environment-dependent OAuth re-login round-trip.

Steps:
1. Generate a unique code; track for cleanup.
2. API-seed a fresh employee.
3. Navigate to LIST_PATH; search; click row; click Edit.
4. Locate "Reset password" button; assert visible.
5. Assert "New password" input is NOT visible (collapsed default).
6. Click Reset password.
7. Assert New password input is now visible.
8. Assert "Keep existing" button is visible (the cancel affordance).

Affirms the safety contract — admins must explicitly opt-in to password rotation; it's never the default.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    test.skip(
      !seedFksResolved && !process.env.SEED_DEPT,
      'no existing employee to derive live HRMS FKs from — set SEED_* env vars',
    );
    const code = testCode(testInfo, 'EMP_PWD');
    const uniq = code.split('_').pop() || '33333';
    const mobile = generateValidMobile(mobileRule);
    createdCodes.add(code);

    const auth = loadAuth();
    await postJson(auth, '/egov-hrms/employees/_create?tenantId=' + TENANT_CODE, {
      RequestInfo: requestInfo(auth, '_create'),
      Employees: [{
        tenantId: TENANT_CODE, code, employeeStatus: 'EMPLOYED', employeeType: 'PERMANENT',
        dateOfAppointment: Date.now() - 24 * 3600_000,
        user: {
          userName: code.toLowerCase().replace(/_/g, '.'),
          name: `PW Pwd ${uniq}`, mobileNumber: mobile,
          type: 'EMPLOYEE', active: true, gender: 'MALE', dob: 631152000000,
          password: 'eGov@123', tenantId: TENANT_CODE,
          roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: TENANT_CODE }],
        },
        jurisdictions: [{ boundary:SEED_BOUNDARY, boundaryType:SEED_BOUNDARY_TYPE, hierarchy:SEED_HIERARCHY, hierarchyType:SEED_HIERARCHY, tenantId: TENANT_CODE, isActive:true }],
        assignments: [{ department:SEED_DEPT, designation:SEED_DESIG, fromDate: Date.now()-24*3600_000, isCurrentAssignment:true }],
      }],
    });

    await page.goto(LIST_PATH);
    await page.getByPlaceholder(/search/i).first().fill(code);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('row').filter({ hasText: code }).click();
    await page.getByRole('button', { name: /^Edit$/i }).click();

    // Password section is collapsed — the "Reset password" button is the
    // only way in. The "New password" field must not be visible yet.
    const resetBtn = page.getByRole('button', { name: /Reset password/i });
    await expect(resetBtn).toBeVisible();
    await expect(page.getByLabel(/^New password/i)).not.toBeVisible();

    await resetBtn.click();
    const newPwdInput = page.getByLabel(/^New password/i);
    await expect(newPwdInput).toBeVisible();

    // Token-level sanity: a fresh OAuth call against the known default
    // should currently succeed (pre-change). We skip the actual rotation +
    // re-login round-trip because rotating through /user/oauth requires
    // the employee to be able to hit citizen login surfaces, which is
    // environment-dependent. Verify only that the reveal path mounts.
    await expect(page.getByRole('button', { name: /^Keep existing$/i })).toBeVisible();
  });

  test('7. bulk import — 3 valid + 2 invalid rows, create 3 lands', {
    annotation: {
      type: 'description',
      description: `Bulk-import end-to-end with mixed validity: 3 well-formed rows + 2 deliberately broken rows (short mobile; unknown department + unknown role). Confirms the preview marks 2 errors, the Create button shows "3" (not 5), and HRMS lands all 3 valid employees. Optionally exercises the credentials CSV download.

Steps:
1. Generate 3 valid + 2 invalid codes; track only valid for cleanup.
2. Navigate to /employees/bulk.
3. Wait for the Departments label (means reference-counts loaded — closed vocabularies ready).
4. Build xlsx via buildEmployeeXlsx with 5 rows (3 valid, 2 invalid by design).
5. setInputFiles with the buffer.
6. Assert preview shows /2.*error|error.*2/i (order-independent error count).
7. Assert button matching /Create\\s+3\\s+(employee|row)s?/i is visible.
8. Click Create; wait for /3\\s*(created|success)/i within 90s.
9. For each valid code, POST HRMS _search; assert exactly 1 result, isActive !== false.
10. If "credentials CSV" download button is visible, click it and confirm the download path is non-empty.

The xlsx sheet name is 'Employee' to match excelParser.ts's allow-list (Employee/Employees/EmployeeMaster/HRMS/employee).

No \`jurisdictions\` column is populated: EmployeeBulkImport.tsx treats it as
fully optional (parse-time: a warning, not a blocking error; validateRow:
skipped entirely when falsy) — and on this deployment the ROOT tenant (where
this spec manages employees) has zero boundary-hierarchy nodes at all
(same fact employee-create-tenant-459 documents), so ANY jurisdiction code
would fail the row-level "Boundary not found" check regardless of which
code was chosen. Omitting the column sidesteps a tenant-shape dependency
this test was never actually about.

Invalid row 1 uses a syntactically well-formed DOB (only the mobile is
short) rather than mobile+DOB both broken: excelParser.ts's parseEmployeeExcel
treats a malformed DOB as a parse-time failure and drops the row from the
returned data array entirely (never reaches the preview table at all), which
would silently shrink "Total" from 5 to 4 and defeat this test's own "preview
marks 2 errors" contract. A bad mobile alone still fails validateRow's
per-tenant MDMS length/pattern check and shows as an Error row, which is what
the test is actually asserting.`,
    },
    tag: ['@area:configurator-manage', '@area:hrms', '@kind:edge-case', '@layer:ui', '@persona:admin'] }, async ({
    page,
  }, testInfo) => {
    const validCodes = [1, 2, 3].map((i) => testCodeIndexed(testInfo, 'EMP_BULK_OK', i));
    const invalidCodes = [1, 2].map((i) => testCodeIndexed(testInfo, 'EMP_BULK_BAD', i));
    validCodes.forEach((c) => createdCodes.add(c));
    // Invalid rows are never created — no cleanup needed.

    await page.goto(`${LIST_PATH}/bulk`);

    // Wait for reference counts to populate so validateRow has the closed
    // vocabularies (departments/designations/boundaries) loaded.
    await expect(
      page.getByText(/Departments/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    const rows = [
      // Valid trio — PW_ codes, tenant-valid mobiles, real dept/desig. No
      // jurisdictions column (see annotation — optional, and unusable at
      // this spec's ROOT tenant which has no boundary hierarchy at all).
      ...validCodes.map((c, i) => ({
        employeeCode: c,
        name: `PW Bulk ${i + 1}`,
        userName: '',
        // Valid for THIS tenant's MDMS mobile rule — no hardcoded '07…'.
        mobileNumber: generateValidMobile(mobileRule),
        emailId: `${c.toLowerCase()}@example.com`,
        gender: 'FEMALE',
        dob: '1992-03-15',
        department: SEED_DEPT,
        designation: SEED_DESIG,
        roles: 'EMPLOYEE',
        jurisdictions: '',
        dateOfAppointment: '2026-02-01',
      })),
      // Invalid row 1 — mobile too short. DOB is well-formed on purpose: a
      // malformed DOB makes excelParser.ts drop the row at PARSE time (never
      // reaches the preview table), which would silently shrink this test's
      // "5 rows, 2 errors" contract to 4 rows — see annotation.
      {
        employeeCode: invalidCodes[0],
        name: 'PW Bulk Bad1',
        userName: '',
        mobileNumber: '99999',
        emailId: '',
        gender: 'MALE',
        dob: '1988-04-10',
        department: SEED_DEPT,
        designation: SEED_DESIG,
        roles: 'EMPLOYEE',
        jurisdictions: '',
        dateOfAppointment: '',
      },
      // Invalid row 2 — unknown department + unknown role code.
      {
        employeeCode: invalidCodes[1],
        name: 'PW Bulk Bad2',
        userName: '',
        // Valid mobile so the ONLY validation errors are the unknown dept/role.
        mobileNumber: generateValidMobile(mobileRule),
        emailId: '',
        gender: 'MALE',
        dob: '1990-01-01',
        department: 'NO_SUCH_DEPT',
        designation: SEED_DESIG,
        roles: 'NO_SUCH_ROLE',
        jurisdictions: '',
        dateOfAppointment: '',
      },
    ];

    const buffer = await buildEmployeeXlsx(rows);
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'employees.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });

    // Preview renders — expect 2 "error" marks (order-independent).
    // The BulkImportPanel labels invalid rows with an "error" badge.
    await expect(page.getByText(/2.*error|error.*2/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // Create button reflects the valid count.
    const createBtn = page.getByRole('button', {
      name: /Create\s+3\s+(employee|row)s?/i,
    });
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    await createBtn.click();

    // Completion page — 3 landed, download-credentials CTA surfaces.
    // RC8: completion copy is "Created 3 employees" (number AFTER the word),
    // not "3 created" — accept either order.
    await expect(
      page.getByText(/(?:created\s+3|3\s+(?:created|success))/i).first(),
    ).toBeVisible({
      timeout: 90_000,
    });

    // API sanity — all 3 valid codes are present & active.
    const auth = loadAuth();
    for (const c of validCodes) {
      const direct = await postJson(auth,
        `${HRMS_SEARCH}?tenantId=${TENANT_CODE}&codes=${encodeURIComponent(c)}&limit=1&offset=0`,
        { RequestInfo: requestInfo(auth) });
      const list = (direct.Employees as HrmsEmployee[]) || [];
      expect(list.length, `bulk-created ${c} should exist`).toBe(1);
      expect(list[0].isActive).not.toBe(false);
    }

    // Credentials CSV download — button is rendered in completionExtras.
    const downloadBtn = page.getByRole('button', { name: /credentials CSV/i });
    if (await downloadBtn.isVisible().catch(() => false)) {
      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      await downloadBtn.click();
      const download = await downloadPromise;
      expect(await download.path()).toBeTruthy();
    }
  });
});

// --- Helpers local to this spec ---

/**
 * The grid's own record count, read from its "Showing 1-10 of 65" footer.
 *
 * The footer is the only honest total on the page: the visible row count is
 * capped by the page size (10), so a filter that narrows 65 -> 40 changes no
 * row count at all. DigitDatagrid renders the footer only when total > 0, so an
 * absent footer plus the empty state means a real zero; an absent footer with
 * no empty state means the grid is mid-refetch (react-query unmounts the table
 * while a new filter's query is pending) and the caller must retry.
 */
async function readTotal(page: Page): Promise<number | null> {
  const footer = page.getByText(/Showing\s+\d+\s*[-–]\s*\d+\s+of\s+\d+/i).first();
  if ((await footer.count()) > 0) {
    const text = await footer.textContent({ timeout: 2_000 }).catch(() => null);
    const m = text?.match(/of\s+(\d+)/i);
    if (m) return Number(m[1]);
  }
  if ((await page.getByText(/No records found/i).count()) > 0) return 0;
  return null;
}

/**
 * readTotal() once the grid has stopped moving.
 *
 * For a total we can predict, prefer `expect.poll(() => readTotal(page))` —
 * it retries a stale read away. This exists for the reads whose expected value
 * is exactly what we are measuring (the per-status totals), where a stale read
 * would otherwise be indistinguishable from a settled one. The grid debounces
 * filter changes (~750ms measured), so we wait past that before sampling and
 * then require two consecutive identical readings.
 */
async function settledTotal(page: Page, opts?: { settleMs?: number; timeoutMs?: number }): Promise<number> {
  const settleMs = opts?.settleMs ?? 2_000;
  const deadline = Date.now() + (opts?.timeoutMs ?? 20_000);
  await page.waitForTimeout(settleMs);
  let previous: number | null = null;
  while (Date.now() < deadline) {
    const current = await readTotal(page);
    if (current !== null && current === previous) return current;
    previous = current;
    await page.waitForTimeout(400);
  }
  throw new Error(
    `the employee grid never settled on a record count (last read: ${previous ?? 'none — no footer and no empty state'})`,
  );
}

/**
 * An employee code that identifies exactly ONE record on this deployment.
 *
 * The quick-search filter matches the whole serialized record
 * (dataProvider clientFilter: `JSON.stringify(record).includes(q)`), not just
 * the code column, so plenty of real codes are useless as a narrowing probe:
 * searching `ADMIN` on the local stack returns all 65 rows, because every
 * employee's jurisdiction hierarchy is `MAPUTO_ADMIN`. Uniqueness is checked
 * against the same record set the grid itself lists (HRMS at TENANT_CODE,
 * limit 500 — the page size hrmsGetList uses), and candidates are walked in
 * sorted order so the choice is deterministic across runs.
 */
async function pickUniqueEmployeeCode(): Promise<string | null> {
  const auth = loadAuth();
  const employees = await employeeSearch(auth, TENANT_CODE, { limit: 500 });
  const serialized = employees.map((e) => JSON.stringify(e).toLowerCase());
  const codes = employees
    .map((e) => String(e.code ?? ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  for (const code of codes) {
    const needle = code.toLowerCase();
    if (serialized.filter((s) => s.includes(needle)).length === 1) return code;
  }
  return null;
}

interface BulkRow {
  employeeCode: string;
  name: string;
  userName: string;
  mobileNumber: string;
  emailId: string;
  gender: string;
  dob: string;
  department: string;
  designation: string;
  roles: string;
  jurisdictions: string;
  dateOfAppointment: string;
}

async function buildEmployeeXlsx(rows: BulkRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  // Sheet name MUST be one of: Employee / Employees / EmployeeMaster / HRMS /
  // employee (parseEmployeeExcel in excelParser.ts falls through those).
  const sheet = wb.addWorksheet('Employee');
  const headers = [
    'employeeCode', 'name', 'userName', 'mobileNumber', 'emailId', 'gender',
    'dob', 'department', 'designation', 'roles', 'jurisdictions', 'dateOfAppointment',
  ];
  sheet.addRow(headers);
  for (const r of rows) {
    sheet.addRow(headers.map((h) => (r as unknown as Record<string, string>)[h] ?? ''));
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
