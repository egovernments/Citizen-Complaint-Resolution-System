/**
 * Employee PGR Complaint Details — Flow 5 render slice (operational scope).
 *
 * Stories landed in this file map 1:1 to EMPLOYEE-FLOWS-CATALOGUE.md:
 *
 *   5.1   — details page initial load (no error)
 *   5.4   — Complaint No. header label + value
 *   5.5   — Current Status chip rendered with localized text
 *   5.6   — Complaint Type + Subtype labels + values
 *   5.9   — Filed Date in DD/MM/YYYY
 *   5.16  — Complaint Timeline section renders with checkpoint rows
 *   5.18  — Timeline actor name is clean (no role-list concat) — currently
 *           test.fail until theflywheel/digit-ui-esbuild#112 (CCRS #524)
 *           lands on naipepea.
 *   5.24a — Take Action button HIDDEN when complaint is in a terminal
 *           state with no nextActions (CLOSEDAFTERREJECTION).
 *   5.24b — Take Action button VISIBLE when complaint is non-terminal
 *           (PENDINGFORASSIGNMENT).
 *
 * Auth: bypasses OTP via `loginViaApi` (ROPC token → seeded localStorage).
 * Fixtures: two persistent complaint IDs on naipepea, override via env.
 */
import { test, expect, type Page } from '@playwright/test';
import { loginViaApi } from '../utils/auth';
import { BASE_URL, TENANT } from '../utils/env';
import { getPersona } from '../utils/personas';

// getPersona('employee') asks the live deployment who actually holds
// EMPLOYEE/SUPERUSER instead of assuming ADMIN — it tries FLOW5_EMPLOYEE_USER/
// EMPLOYEE_USER/etc via personas.ts's candidate list first, and only falls
// back to ADMIN when nothing else logs in, which is the same net effect the
// old `FLOW5_EMPLOYEE_USER || ADMIN` fallback had for naipepea. (We
// previously tried EMP-KE_NAIROBI-000089 there but its password broke during
// the encryption key rotation — see memory: project_naipepea_login_broken —
// 13 ke.nairobi users in the failing bucket. ADMIN survived; personas.ts's
// login() probing CITY then ROOT is what makes that survive portably too.)

// Fixture SRIDs — precedence:
//   1. explicit env (TERMINAL_COMPLAINT_SRID / NONTERMINAL_COMPLAINT_SRID)
//   2. legacy env (FLOW5_*)
//   3. lifecycle.setup.ts output (lifecycle-fixtures.json) — the suite
//      seeds these against the configured tenant before chromium runs,
//      so the SRIDs always match the live deployment
//
// There is deliberately NO hardcoded last-resort default. There used to be a
// pair of naipepea SRIDs here, which meant that on any deployment where
// lifecycle.setup.ts fail-softed (bomet: ASSIGN 400s with DEPARTMENT_NOT_FOUND
// because the ADMIN fallback actor has no HRMS department), every story in this
// file navigated to a complaint that does not exist on the target, rendered
// "No Results Found", and burned a 30s timeout waiting for a field-pair that
// was never going to mount. Nine identical timeouts, all reported as UI
// failures, all actually one missing fixture. A complaint id from a different
// deployment is not a sane default — with no fixture we skip, naming the cause.
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';
const _fixtures = readLifecycleFixtures();

// The file is found by path, so it is not necessarily THIS tenant's — a
// leftover (or a LIFECYCLE_FIXTURES_FILE aimed at another run) carries SRIDs
// that are navigated to under TENANT, render "No Results Found", and burn the
// same 30s timeouts the no-hardcoded-default rule above exists to prevent. Same
// class of stale-artifact bug, same answer: trust the recorded tenant.
const _fixtureTenantMismatch = _fixtures && _fixtures.tenant !== TENANT;
const _complaints = _fixtureTenantMismatch ? undefined : _fixtures?.complaints;

// NOTE: `?.complaints?.terminal_rated` — BOTH links optional-chained. When
// lifecycle.setup.ts fails soft it writes a `status:'skipped'` fixture with no
// `complaints` key; guarding only the call (`?.complaints.x`) threw a
// load-time TypeError and took the whole file down.
const TERMINAL_COMPLAINT_ID =
  process.env.TERMINAL_COMPLAINT_SRID
  || process.env.FLOW5_TERMINAL_SRID
  || _complaints?.terminal_rated
  || '';
const NONTERMINAL_COMPLAINT_ID =
  process.env.NONTERMINAL_COMPLAINT_SRID
  || process.env.FLOW5_NONTERMINAL_SRID
  || _complaints?.non_terminal
  || '';

/**
 * Why THIS fixture is unusable, or '' when it's good.
 *
 * Per-fixture on purpose. A single FIXTURE_SKIP demanding both IDs meant one
 * missing fixture took down every story in the file — including the eight that
 * only ever open the terminal complaint, which was sitting right there. The
 * fixtures are seeded by separate steps and fail independently (a deployment
 * with no eligible assignee gets `non_terminal` but never reaches
 * `terminal_rated`), so gating them together turns one gap into a whole-file
 * blackout and hides which fixture is actually absent.
 */
function fixtureSkip(srid: string, envVar: string): string {
  if (srid) return '';
  const reason = _fixtureTenantMismatch
    ? `lifecycle-fixtures.json was generated for ${_fixtures!.tenant}, not ${TENANT} — its SRIDs do not exist here`
    : _fixtures?.skipped_reason
      ? `lifecycle.setup.ts did not seed complaints: ${_fixtures.skipped_reason}`
      : 'no lifecycle-fixtures.json on disk — lifecycle.setup.ts did not run';
  return `${reason}. Override with ${envVar} to pin an explicit complaint.`;
}

const TERMINAL_SKIP = fixtureSkip(TERMINAL_COMPLAINT_ID, 'TERMINAL_COMPLAINT_SRID');
const NONTERMINAL_SKIP = fixtureSkip(NONTERMINAL_COMPLAINT_ID, 'NONTERMINAL_COMPLAINT_SRID');

async function openDetails(page: Page, srid: string, skipReason: string): Promise<void> {
  // Skip rather than navigate to a complaint we know isn't there. Without this
  // the page renders "No Results Found" and the field-pair wait below times out
  // after 30s, disguising a missing fixture as a UI regression. Gated on the
  // ONE fixture this story asked for — see fixtureSkip().
  test.skip(!srid, skipReason);

  const employee = await getPersona('inbox-viewer'); // needs nextActions (GRO+jurisdiction) for the 5.24b Take-Action gate
  await loginViaApi(page, {
    // `tenant` is what gets injected into Employee.* localStorage (the
    // complaint's own tenant, so pgr-services/workflow calls resolve
    // correctly); `authTenant` is where the OAuth call itself is aimed.
    // They can differ — loginViaApi defaults authTenant to root-derived-
    // from-tenant, which breaks for a real onboarded employee that only
    // exists at the city tenant. employee.tenant is the tenant
    // personas.ts's login() actually proved this credential works at.
    tenant: TENANT,
    authTenant: employee.tenant,
    username: employee.username,
    password: employee.password,
  });

  await page.goto(
    `${BASE_URL}/digit-ui/employee/pgr/complaint-details/${srid}`,
    { waitUntil: 'domcontentloaded', timeout: 30_000 },
  );

  // Wait for any field-pair to mount — the details body renders as a
  // grid of .digit-viewcard-field-pair divs after the parallel
  // _search / workflow / mdms fetches resolve.
  await page
    .locator('.digit-viewcard-field-pair')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
}

/** Returns the value text adjacent to a given .digit-viewcard-label. */
async function valueForLabel(page: Page, label: string): Promise<string> {
  // The label and value are sibling divs inside .digit-viewcard-field-pair.
  // Match by exact label text, then read the .digit-viewcard-value sibling.
  const value = page
    .locator('.digit-viewcard-field-pair', { has: page.locator('.digit-viewcard-label', { hasText: new RegExp(`^\\s*${label}\\s*$`) }) })
    .locator('.digit-viewcard-value');
  await value.first().waitFor({ state: 'visible', timeout: 10_000 });
  return (await value.first().innerText()).trim();
}

test.describe('PGR complaint details — Flow 5 render slice', () => {
  // Each test gets its own page context — no shared state between stories.

  test('Story 5.1 — details page loads without error (terminal fixture) @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);

    const heading = page.getByText('Complaint Details', { exact: true }).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Something went wrong/i);
    expect(body).not.toMatch(/Complaint not found/i);
  });

  test('Story 5.4 — Complaint No. label + value match the SRID @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);

    const value = await valueForLabel(page, 'Complaint No.');
    expect(value).toBe(TERMINAL_COMPLAINT_ID);
  });

  test('Story 5.5 — Current Status chip renders localized status text @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);

    const status = await valueForLabel(page, 'Current Status');
    // We deliberately do not lock to a specific localization or terminal
    // state — the terminal fixture may be closed-after-resolution OR
    // closed-after-rejection depending on how it was seeded. Just assert
    // the chip renders a non-empty, localized (not raw-enum) string.
    expect(status.length).toBeGreaterThan(0);
    expect(status).not.toMatch(/^[A-Z_]+$/);
  });

  test('Story 5.6 — complaint classification rows render localized values @p1', { tag: ['@persona:employee'] }, async ({ page }) => {
    await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);

    // PGRDetails.js renders the classification block between the
    // "Complaint No." and "Filed Date" rows. FLAT tenants render exactly
    // two rows there ("Complaint Type" + "Complaint Subtype"); tenants with
    // a configured RAINMAKER-PGR.ComplaintHierarchy render one row PER
    // hierarchy level (Main Category › Sector › Sub-Type …) with dynamic,
    // level-derived labels (buildComplaintPath). So we no longer pin the
    // two fixed labels — we assert that >=1 classification row renders a
    // real localized value, tolerating N level-rows.
    const pairs = page.locator('.digit-viewcard-field-pair');
    // Read every pair's label/value in a single in-page pass. A manual
    // nth()+innerText() loop auto-waits (up to the whole 120s test timeout)
    // on any pair missing a `.digit-viewcard-value` child — the details
    // grid renders a trailing empty field-pair with no value element, which
    // hung the old loop for the full timeout. evaluateAll reads the DOM
    // synchronously, so an absent child yields "" instead of blocking.
    const rows: { label: string; value: string }[] = await pairs.evaluateAll((els) =>
      els.map((el) => ({
        label: (el.querySelector('.digit-viewcard-label')?.textContent || '').trim(),
        value: (el.querySelector('.digit-viewcard-value')?.textContent || '').trim(),
      })),
    );

    const startIdx = rows.findIndex((r) => /^Complaint No\.?$/i.test(r.label));
    const endIdx = rows.findIndex((r) => /^Filed Date$/i.test(r.label));
    expect(startIdx, 'Complaint No. row must render').toBeGreaterThanOrEqual(0);
    expect(endIdx, 'Filed Date row must render after Complaint No.').toBeGreaterThan(startIdx);

    // Everything between them is classification (flat pair OR N hierarchy levels).
    const classificationRows = rows.slice(startIdx + 1, endIdx);
    expect(classificationRows.length, 'at least one classification row must render').toBeGreaterThanOrEqual(1);
    for (const r of classificationRows) {
      expect(r.value.length, `classification row "${r.label}" must have a value`).toBeGreaterThan(0);
      // Not a raw enum / missing-localization key (e.g. "GARBAGE_RELATED").
      expect(r.value).not.toMatch(/^[A-Z_]+$/);
    }
  });

  test('Story 5.9 — Filed Date renders in DD/MM/YYYY @p1', { tag: ['@persona:employee'] }, async ({ page }) => {
    await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);

    const filed = await valueForLabel(page, 'Filed Date');
    expect(filed).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  test('Story 5.16 — Complaint Timeline section renders with checkpoint rows @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);

    // Accept the localized English label OR the raw i18n key / sw_KE rendering.
    const timelineHeader = page.getByText(/Complaint Timeline|CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE/i).first();
    await expect(timelineHeader).toBeVisible({ timeout: 10_000 });

    // .timeline-subelements wraps each checkpoint's body (date + actor +
    // comments). The terminal-fixture has APPLY + REJECT + REOPEN + RATE
    // history, so at least 2 rows must exist.
    const checkpoints = page.locator('.timeline-subelements');
    const count = await checkpoints.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('Story 5.18 — timeline actor name is clean (no role-list concat) — #524', { tag: ['@persona:employee'] }, async ({ page }) => {
    // #524 fix is now in-repo (digit-ui-esbuild TimeLineWrapper.js `formatPerson`
    // returns just `person.name`), so this asserts the post-fix shape directly.
    // Previously masked with `test.fail(true)` pending a deploy; unmasked once
    // the bundle shipped.
    await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);

    // #524: actor names must not carry the appended role list. We don't
    // pin a specific actor name (varies by deployment/seed) — instead we
    // assert that NO timeline row renders the role-list concat shape
    // (" - Customer Support Representative, ...") that #524 strips.
    await expect(page.getByText(/Complaint Timeline|CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE/i).first())
      .toBeVisible({ timeout: 10_000 });
    const timelineText = (await page.locator('.timeline-date').allInnerTexts()).join(' \n ');
    expect(timelineText.length, 'timeline should render at least one actor row').toBeGreaterThan(0);
    expect(timelineText).not.toMatch(/Customer Support Representative/);
    expect(timelineText).not.toMatch(/Grievance Routing Officer/);
    expect(timelineText).not.toMatch(/SUPERUSER/);
  });

  test('Story 5.24a — Take Action HIDDEN on terminal-state complaint @p1', { tag: ['@persona:employee'] }, async ({ page }) => {
    await openDetails(page, TERMINAL_COMPLAINT_ID, TERMINAL_SKIP);

    // CLOSEDAFTERREJECTION has no nextActions for any role, so the
    // button must not render. We do not just check count===0 — that
    // would pass if the entire page failed to load. Anchor on a known
    // section first.
    await expect(
      page.getByText(/Complaint Timeline|CS_COMPLAINT_DETAILS_COMPLAINT_TIMELINE/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    const takeAction = page.getByRole('button', { name: /^Take Action$/i });
    await expect(takeAction).toHaveCount(0);
  });

  test('Story 5.24b — Take Action VISIBLE on non-terminal complaint @p0', { tag: ['@persona:employee'] }, async ({ page }) => {
    await openDetails(page, NONTERMINAL_COMPLAINT_ID, NONTERMINAL_SKIP);

    // The take-action control renders ONLY when the workflow returns
    // nextActions for the viewing employee (PGRDetails.js gates the
    // ActionBar on `workflowDetails.data.nextActions.length > 0`). That
    // gate — not the label — is what this story asserts. Its visible text
    // is `t("ES_COMMON_TAKE_ACTION")`, which is localized per deployment
    // (and renders the raw key on tenants whose localization seed omits
    // it), so pinning the English "Take Action" string is non-portable.
    // Target the SubmitBar structurally instead: the details page has a
    // single ActionBar submit button, present iff the next-actions gate
    // passes.
    const takeAction = page.locator(
      '.digit-action-bar-wrap button, .action-bar-wrap button, .action-bar-wrap button.submit-bar',
    );
    await expect(takeAction.first()).toBeVisible({ timeout: 10_000 });
    await expect(takeAction.first()).toBeEnabled();
  });
});
