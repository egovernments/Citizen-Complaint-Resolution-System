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
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

// We authenticate the state-tenant ADMIN (passes at `ke`) and inject the
// city tenant (`ke.nairobi`) into the Employee.* localStorage keys so
// getCurrentTenantId() resolves to ke.nairobi for the pgr-services and
// workflow calls. We previously tried EMP-KE_NAIROBI-000089 but its
// password broke during the encryption key rotation (see memory:
// project_naipepea_login_broken — 13 ke.nairobi users in the failing
// bucket). ADMIN is the deployment's only resilient employee right now.
const EMPLOYEE_USER = process.env.FLOW5_EMPLOYEE_USER || ADMIN_USER;
const EMPLOYEE_PASS = process.env.FLOW5_EMPLOYEE_PASS || ADMIN_PASS;

// Fixtures — long-lived complaints on naipepea. If they disappear, set
// env overrides or refresh via:
//   curl /pgr-services/v2/request/_search?tenantId=ke.nairobi&applicationStatus=...
const TERMINAL_SRID =
  process.env.FLOW5_TERMINAL_SRID || 'PG-PGR-2026-04-23-004403';
const NONTERMINAL_SRID =
  process.env.FLOW5_NONTERMINAL_SRID || 'NCCG-PGR-2026-05-06-023467';

async function openDetails(page: Page, srid: string): Promise<void> {
  await loginViaApi(page, {
    tenant: TENANT,
    username: EMPLOYEE_USER,
    password: EMPLOYEE_PASS,
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

  test('Story 5.1 — details page loads without error (terminal fixture) @p0', async ({ page }) => {
    await openDetails(page, TERMINAL_SRID);

    const heading = page.getByText('Complaint Details', { exact: true }).first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Something went wrong/i);
    expect(body).not.toMatch(/Complaint not found/i);
  });

  test('Story 5.4 — Complaint No. label + value match the SRID @p0', async ({ page }) => {
    await openDetails(page, TERMINAL_SRID);

    const value = await valueForLabel(page, 'Complaint No.');
    expect(value).toBe(TERMINAL_SRID);
  });

  test('Story 5.5 — Current Status chip renders localized status text @p0', async ({ page }) => {
    await openDetails(page, TERMINAL_SRID);

    const status = await valueForLabel(page, 'Current Status');
    // We deliberately do not lock to a specific localization — just
    // assert non-empty and not a raw enum like "CLOSEDAFTERREJECTION"
    // (raw enums show only when the localization key is missing).
    expect(status.length).toBeGreaterThan(0);
    expect(status).not.toMatch(/^[A-Z_]+$/);
    expect(status.toLowerCase()).toContain('reject');
  });

  test('Story 5.6 — Complaint Type and Subtype labels render values @p1', async ({ page }) => {
    await openDetails(page, TERMINAL_SRID);

    const type = await valueForLabel(page, 'Complaint Type');
    expect(type.length).toBeGreaterThan(0);
    expect(type).not.toMatch(/^[A-Z_]+$/);

    const subtype = await valueForLabel(page, 'Complaint Subtype');
    expect(subtype.length).toBeGreaterThan(0);
    expect(subtype).not.toMatch(/^[A-Z_]+$/);
  });

  test('Story 5.9 — Filed Date renders in DD/MM/YYYY @p1', async ({ page }) => {
    await openDetails(page, TERMINAL_SRID);

    const filed = await valueForLabel(page, 'Filed Date');
    expect(filed).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  test('Story 5.16 — Complaint Timeline section renders with checkpoint rows @p0', async ({ page }) => {
    await openDetails(page, TERMINAL_SRID);

    const timelineHeader = page.getByText('Complaint Timeline', { exact: true });
    await expect(timelineHeader).toBeVisible({ timeout: 10_000 });

    // .timeline-subelements wraps each checkpoint's body (date + actor +
    // comments). The terminal-fixture has APPLY + REJECT + REOPEN + RATE
    // history, so at least 2 rows must exist.
    const checkpoints = page.locator('.timeline-subelements');
    const count = await checkpoints.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('Story 5.18 — timeline actor name is clean (no role-list concat) — #524', async ({ page }) => {
    // theflywheel/digit-ui-esbuild#112 fix not yet live on naipepea as
    // of 2026-05-14 — workflow-v2's EMPLOYEE-role enrichment packs the
    // roles into assigner.name and the frontend hasn't stripped them
    // yet. Flip from `test.fail` to expected-green once the bundle
    // ships.
    test.fail(true, 'CCRS #524 — fix merged in theflywheel/digit-ui-esbuild#112 but not deployed yet');

    await openDetails(page, TERMINAL_SRID);

    // Find any timeline actor row that names the admin who rejected
    // this complaint. Expected (post-fix): just "Nairobi Admin".
    // Today: "Nairobi Admin - Customer Support Representative, ..." .
    const adminRow = page
      .locator('.timeline-date')
      .filter({ hasText: /Nairobi Admin/i })
      .first();
    await expect(adminRow).toBeVisible({ timeout: 10_000 });

    const text = (await adminRow.innerText()).trim();
    // The fix strips ` - ` and everything after across three call
    // sites. We assert the post-fix shape so this test goes green
    // automatically the day the bundle lands.
    expect(text).not.toMatch(/Customer Support Representative/);
    expect(text).not.toMatch(/Grievance Routing Officer/);
    expect(text).not.toMatch(/SUPERUSER/);
  });

  test('Story 5.24a — Take Action HIDDEN on terminal-state complaint @p1', async ({ page }) => {
    await openDetails(page, TERMINAL_SRID);

    // CLOSEDAFTERREJECTION has no nextActions for any role, so the
    // button must not render. We do not just check count===0 — that
    // would pass if the entire page failed to load. Anchor on a known
    // section first.
    await expect(
      page.getByText('Complaint Timeline', { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    const takeAction = page.getByRole('button', { name: /^Take Action$/i });
    await expect(takeAction).toHaveCount(0);
  });

  test('Story 5.24b — Take Action VISIBLE on non-terminal complaint @p0', async ({ page }) => {
    await openDetails(page, NONTERMINAL_SRID);

    const takeAction = page.getByRole('button', { name: /^Take Action$/i });
    await expect(takeAction).toBeVisible({ timeout: 10_000 });
    await expect(takeAction).toBeEnabled();
  });
});
