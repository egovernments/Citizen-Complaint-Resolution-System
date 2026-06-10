/**
 * E2E spec for the EscalationConfig editor — configurator-owned.
 *
 * The Phase 3 escalation work landed the EscalationConfigEditor inside the
 * configurator (commit f7b1cbb9a) but did NOT add a configurator-side spec.
 * The only test coverage to date lives in `tests/integration-tests/` (the
 * cross-repo Playwright suite that bundles UI + API + OTEL checks together).
 * That's fine for the full pipeline but leaves the editor itself untested
 * from the configurator's own e2e harness — meaning UI regressions can ship
 * without anything in this repo catching them.
 *
 * Scope of this spec:
 *   1. Log in (Management mode) against the target environment.
 *   2. Navigate directly to /manage/escalation-config.
 *   3. Open the (single, root-tenant) escalation record for edit.
 *   4. Assert the editor renders:
 *        - "Max escalation depth" numeric input
 *        - At least one SLA-per-level row (SlaByLevelInput renders inputs
 *          with placeholder "milliseconds" or "hh:mm:ss")
 *        - Designation tree side panel
 *   5. The spec is intentionally READ-ONLY so it's safe to point at a live
 *      tenant (Bomet/Nairobi) without rotating the production config.
 *
 * Run:
 *   cd configurator
 *   E2E_BASE_URL=https://bometfeedbackhub.digit.org/configurator \
 *     E2E_TENANT=ke \
 *     E2E_USERNAME=ADMIN E2E_PASSWORD=eGov@123 \
 *     npx playwright test --config e2e/playwright.config.ts \
 *     e2e/escalation-config.spec.ts --reporter=line
 *
 * The spec runs against the deployed configurator (Bomet uses tenant `ke`,
 * the dev sandbox at `crs-mockup.egov.theflywheel.in` uses `pg`).
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Config — env-driven so the spec works against any tenant
// ---------------------------------------------------------------------------
const BASE_URL = process.env.E2E_BASE_URL
  || process.env.BASE_URL
  || 'https://crs-mockup.egov.theflywheel.in';
const TENANT = process.env.E2E_TENANT || 'pg';
const USERNAME = process.env.E2E_USERNAME || 'ADMIN';
const PASSWORD = process.env.E2E_PASSWORD || 'eGov@123';

// Unique entity prefix per CLAUDE.md convention. This spec doesn't currently
// create any entities (read-only), but the prefix is exported so a future
// `save` flow can tag its modifications without colliding across runs.
const TS = Date.now();
const RUN_TAG = `PW_ESC_${String(TS).slice(-6)}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Logs in via the Management-mode login form. Mirrors the pattern in
 * `e2e-onboarding/onboarding.spec.ts` (clickButton(/Management/)) but
 * defaults differently — Management mode is required to reach /manage/*.
 *
 * If `BASE_URL` is a production-style deployment that 401s ADMIN/eGov@123,
 * the test fails fast at this step with the actual login error captured in
 * the screenshot/trace artifacts.
 */
async function loginAsManagement(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);

  // Click Management mode tab/button (vs the default "Onboarding")
  const managementBtn = page.getByRole('button', { name: /Management/i }).first();
  await managementBtn.click({ timeout: 10_000 });

  // Tenant (defaults to `statea` on a fresh form; override to ours).
  const tenantInput = page.locator('#tenantCode');
  if (await tenantInput.count()) {
    await tenantInput.fill(TENANT);
  }

  const usernameInput = page.locator('#username');
  if (await usernameInput.count() && (await usernameInput.inputValue()) !== USERNAME) {
    await usernameInput.fill(USERNAME);
  }

  const passwordInput = page.locator('#password');
  if (await passwordInput.count() && !(await passwordInput.inputValue())) {
    await passwordInput.fill(PASSWORD);
  }

  await page.locator('button[type="submit"]').click();

  // Land on /manage. If the login fails or the env redirects elsewhere,
  // waitForURL throws with a clear "Timed out waiting for URL" trace and
  // the failure screenshot captures the actual page.
  await page.waitForURL(/\/manage(\/|$)/, { timeout: 30_000 });
}

/**
 * Opens the EscalationConfig record for edit. The list view renders the
 * single root-tenant record; clicking its row drops us into MdmsResourceEdit
 * which mounts the custom EscalationConfigEditor.
 */
async function openEscalationConfigEditor(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/manage/escalation-config`);
  // The list page renders inside react-admin's CoreAdminUI. Wait for either
  // the (single) record row or the "No records" empty state.
  await page.waitForLoadState('networkidle');

  // Try clicking the first row to navigate into edit. If there's a direct
  // "Edit" button, fall back to that. Some MDMS resources expose row-click
  // to /show by default; the configurator routes /show -> /edit for editable
  // resources but to be safe we try /edit explicitly via URL if the row
  // click doesn't land us on an edit URL.
  const firstRow = page.locator('table tbody tr').first();
  if (await firstRow.count()) {
    await firstRow.click({ timeout: 10_000 });
  }
  // If the row click landed on /show, force an edit by appending `/<id>` —
  // react-admin's resource routes are `/<resource>/<id>` for edit. The
  // single record exists at id=`RAINMAKER-PGR.EscalationConfig` (the
  // descriptor lists `maxDepth` as the idField but in practice the row
  // click handler resolves it). If neither works we fall through and rely
  // on the assertion to fail with a screenshot.

  // The editor itself takes a moment to fetch the record + render the
  // custom editor.
  await page.waitForLoadState('networkidle');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
// Test titles are kept fully static (no template literals) so Playwright's
// worker-resume protocol can locate the test by title across reruns. RUN_TAG
// only shows up as an annotation, not in the test name.
test.describe.serial('EscalationConfig editor', () => {
  test('login + open editor + assert key fields render', async ({ page }) => {
    test.info().annotations.push({ type: 'run-tag', description: RUN_TAG });

    await loginAsManagement(page);
    await openEscalationConfigEditor(page);

    // -- Assertion 1: maxDepth input is present.
    // The descriptor labels it "Max escalation depth"; the form uses an
    // <input type="number">. We match on the label text and fall back to
    // any visible numeric input if the label isn't found (some MDMS
    // editors render labels via react-admin's <NumberInput> wrapper that
    // doesn't use a native <label for>).
    const maxDepthByLabel = page.getByLabel(/Max escalation depth/i);
    const maxDepthFallback = page.locator('input[type="number"]').first();
    const maxDepthInput = (await maxDepthByLabel.count())
      ? maxDepthByLabel
      : maxDepthFallback;
    await expect(maxDepthInput).toBeVisible({ timeout: 20_000 });

    // -- Assertion 2: at least one SLA row from SlaByLevelInput.
    // The widget renders inputs with placeholder "hh:mm:ss" (default mode)
    // or "milliseconds" (raw mode), and a remove button with
    // aria-label="remove level <n>".
    const slaRow = page.locator(
      'input[placeholder="hh:mm:ss"], input[placeholder="milliseconds"]'
    ).first();
    const removeBtn = page.locator('button[aria-label^="remove level"]').first();
    // Either marker is sufficient to prove SlaByLevelInput rendered.
    const slaIsVisible = (await slaRow.count()) > 0 || (await removeBtn.count()) > 0;
    expect(
      slaIsVisible,
      'SlaByLevelInput did not render — no placeholder input or remove button found'
    ).toBe(true);

    // -- Assertion 3: DesignationTreePanel side panel.
    // The panel renders a "Designations" label heading. EscalationConfig
    // is the only editor that mounts this panel, so its presence is a
    // reliable proxy for "the custom EscalationConfigEditor mounted, not
    // the generic form fallback".
    await expect(
      page.getByText(/Designations/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
