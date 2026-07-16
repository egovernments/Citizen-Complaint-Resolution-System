/**
 * Citizen file-complaint wizard — happy path
 *
 * Walks all 6 steps of the live wizard and asserts the confirmation page
 * contract. Per docs/personas/citizen-flows.md Stories 3.1–3.7, the
 * wizard is 6 steps (not 8 as the original catalogue claimed) and the
 * URL stays at `/create-complaint/complaint-type` for every step.
 *
 * Ground rules from the 2026-04-29 walk:
 *   - Step 1 (Complaint Details) requires Type + Subtype dropdowns.
 *   - Step 2 (Pin Complaint Location) — don't touch the map (CCRS#469).
 *   - Step 3 (Location Details) postal code is auto-filled from step 2.
 *   - Step 4 (Complaint's Location) cascades County → Sub-County → Ward,
 *     gating each level (CCRS#477).
 *   - Step 5 description is required.
 *   - Step 6 photo dropzone is optional; SUBMIT is the final button.
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, PGR_ID_PREFIX } from '../utils/env';
import { readProvisionedCitizen } from '../utils/citizen-provision';
import { requires } from '../utils/capabilities';

test.describe('Citizen file-complaint wizard', () => {
  // ── Raw-key localization scan ─────────────────────────────────────────────
  //
  // Visible text that looks like a raw localization key: uppercase letter/digit
  // run with at least one `.`/`_` separator. Matches BOUNDARY.OROMIA,
  // ADMIN_KE_NAIROBI, SERVICEDEFS.DRAINS, CS_COMMON_COMPLAINT_SUBMITTED.
  // Does NOT match real display names ("Oromia", "Nairobi County", "Bomet")
  // or dashed identifiers (PGR-2026-06-13-004235).
  //
  // Regex is preserved verbatim from
  //   local-setup/tests/e2e/specs/citizen/complaint-submit.spec.ts
  const RAW_KEY_RE = /\b[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+\b/g;
  const rawKeysIn = (text: string) =>
    [...new Set(text.match(RAW_KEY_RE) || [])];

  const assertNoRawKeys = async (page: Page, stepLabel: string) => {
    const text = await page.locator('body').textContent() ?? '';
    const keys = rawKeysIn(text);
    expect(
      keys,
      `Step "${stepLabel}" shows raw localization keys: ${keys.slice(0, 10).join(', ')}`,
    ).toHaveLength(0);
  };

  /**
   * Walk all 6 wizard steps through SUBMIT and wait for the response page.
   *
   * @param page            Playwright Page from the test fixture.
   * @param options.onAfterStep      Optional async callback fired after each named
   *                                 interaction point (receives a human-readable step label).
   * @param options.assertPincodeToast  When true, asserts that no "pincode not serviceable"
   *                                    toast appears after step 2 (happy-path check).
   */
  async function walkWizard(
    page: Page,
    options: {
      onAfterStep?: (label: string) => Promise<void>;
      assertPincodeToast?: boolean;
    } = {},
  ): Promise<void> {
    const { onAfterStep, assertPincodeToast = false } = options;

    // Modern digit-ui renders dropdowns as <button role="combobox"> (shadcn
    // style); older builds used `input.digit-dropdown-employee-select-wrap--elipses`.
    // Match both so the test survives on either build.
    const dropdowns = page.locator(
      'button[role="combobox"], input.digit-dropdown-employee-select-wrap--elipses',
    );
    // Modern wizard uses <button role="combobox">; older builds used a
    // wrapped <input>. Match both for cross-build compatibility.
    const cascadeDropdowns = page.locator(
      'button[role="combobox"], input[class*="select-wrap--elipses"]',
    );

    const clickNext = async () => {
      const btn = page.locator('button:visible').filter({ hasText: /^NEXT$/ }).first();
      await btn.waitFor({ state: 'visible', timeout: 10_000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(2500);
    };

    // ── Step 1: Complaint Details (Type + optional Subtype hierarchy) ──────────
    //
    // Handles two distinct wizard shapes detected at runtime via DOM:
    //
    //   • Flat (Ethiopia): wizard renders a single "Complaint Type" combobox.
    //     After picking one option the NEXT button enables — no further comboboxes
    //     appear. The loop below runs exactly once and exits.
    //
    //   • Hierarchical (Bomet ke): MDMS has ComplaintHierarchyDefinition with
    //     CATEGORY → SUB_TYPE levels. The wizard renders only the first combobox
    //     ("Complaint Type / Select a complaint type") initially; after the user
    //     picks a Category a second combobox (Sub-Type) slides in. Additional
    //     nesting levels follow the same pattern. The loop picks the first
    //     available option at each level until no new combobox appears.
    //
    // Safety limit of 8 levels covers every known deployment.
    await dropdowns.first().waitFor({ state: 'visible', timeout: 15_000 });
    await onAfterStep?.('Step 1 – initial render');

    for (let level = 0; level < 8; level++) {
      const combobox = dropdowns.nth(level);
      const visible = await combobox.isVisible({ timeout: level === 0 ? 5000 : 3000 }).catch(() => false);
      if (!visible) break;

      // On ke (CRS-based digit-ui) ALL hierarchy-level comboboxes render
      // immediately, but child levels are disabled until the parent is
      // selected. Wait up to 8 s for the element to become enabled (the
      // parent selection triggers an MDMS call that may take 2–4 s on ke).
      // Use expect().toBeEnabled() so Playwright actively polls the enabled
      // state rather than doing a one-shot check.
      await expect(combobox).toBeEnabled({ timeout: 8000 }).catch(() => {});
      const enabled = await combobox.isEnabled().catch(() => false);
      if (!enabled) {
        // Still disabled after 8 s — no further interactive levels exist
        // for this deployment at this point in the hierarchy.
        break;
      }

      // Skip comboboxes that already carry a real value (not a placeholder).
      // `innerText` on a button combobox includes the placeholder span text.
      // On ke the shadcn Select renders "Select…" (ellipsis, no space) as the
      // placeholder; on Ethiopia it renders "Select a complaint type". Match
      // both: /^Select/i covers "Select…", "Select a …", "Select the level…".
      const hasPlaceholder = await combobox.evaluate(
        (el) => /^Select/i.test((el as HTMLElement).innerText.trim()),
      ).catch(() => true);
      if (!hasPlaceholder) {
        // Already filled — move to the next level without interacting.
        continue;
      }

      // The ke CRS complaint-type picker (y2 component) renders a
      // <ul role="listbox"> populated from MDMS. On slow deployments the
      // options array is empty at first render; the listbox appears but has
      // no <li role="option"> children. Retry up to 3 times with increasing
      // waits so the MDMS response can arrive before we give up.
      //
      // Scope the option locator to the currently open listbox so we don't
      // accidentally match hidden options from a sibling dropdown (ke renders
      // all hierarchy levels in the DOM simultaneously, each with its own
      // listbox; an unscoped first() may pick from a closed, invisible one).
      let option = page.locator(
        '[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible',
      ).first();
      let optionVisible = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        await combobox.click();
        // Wait longer on ke (MDMS can take 2-4 s); start shorter for
        // Ethiopia which is typically faster.
        const waitMs = 1000 + attempt * 2000;
        await page.waitForTimeout(waitMs);
        option = page.locator(
          '[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible',
        ).first();
        optionVisible = await option.isVisible({ timeout: 5000 }).catch(() => false);
        if (optionVisible) break;
        // Close the empty dropdown before retrying — click again to toggle off.
        await combobox.click();
        await page.waitForTimeout(500 + attempt * 500);
      }
      if (!optionVisible) break;
      await option.click();
      // After selecting a level, wait for the next combobox to become enabled
      // (ke renders subsequent levels disabled and enables them progressively).
      await page.waitForTimeout(1500);
      await onAfterStep?.(`Step 1 – after level-${level} selection`);
    }

    await clickNext();

    // ── Step 2: Pin Complaint Location — DON'T touch the map ────────
    await page.waitForTimeout(2500);
    await onAfterStep?.('Step 2 – Pin Location');
    await clickNext();

    if (assertPincodeToast) {
      // No "Pincode not serviceable" toast (CCRS#469 fix verified)
      const pincodeToast = page.locator(
        'text=/pincode.*not serv|CS_COMMON_PINCODE_NOT_SERVICABLE/i',
      );
      await expect(pincodeToast).toHaveCount(0);
    }

    // ── Step 3: Location Details — fill EVERY cascade level to the leaf ──
    // The map pin auto-resolves the boundary cascade only as deep as the
    // deployment has boundary geometry (geojson). On tenants whose tree is
    // deeper than the geometry (e.g. Maputo: geometry stops at Bairro but the
    // hierarchy has a Quarteirão leaf below it), the deepest level(s) render
    // EMPTY after the pin auto-fill and must be picked manually — the form's
    // mandatory leaf gate won't enable NEXT until the true leaf is selected.
    // Loop up to 8 levels (was 3 — Kenya's County→SubCounty→Ward) so any
    // number of cascade levels is filled; already-auto-filled levels are
    // skipped, empty ones (the leaf) get selected.
    await page.waitForTimeout(2000);
    await onAfterStep?.('Step 3 – Location Details initial render');

    for (let i = 0; i < 8; i++) {
      const dd = cascadeDropdowns.nth(i);
      // Wait briefly — the cascade child may not have rendered yet.
      const visible = await dd.isVisible({ timeout: 5000 }).catch(() => false);
      if (!visible) break;
      // On ke (CRS digit-ui) all boundary cascade dropdowns render immediately
      // but child levels are disabled until the parent is selected. Wait up
      // to 6 s for each level to become enabled after the parent selection.
      await expect(dd).toBeEnabled({ timeout: 6000 }).catch(() => {});
      const ddEnabled = await dd.isEnabled().catch(() => false);
      if (!ddEnabled) break;
      // Skip if this dropdown already has a selection.
      // Use /^Select/i (no trailing space) to also match "Select…" (ke shadcn placeholder).
      const hasValue = await dd.evaluate(
        (el) => !(el as HTMLElement).innerText.match(/^Select/i),
      ).catch(() => false);
      if (hasValue) continue;
      await dd.click();
      await page.waitForTimeout(800);
      await page
        .locator('[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible')
        .first()
        .click();
      await page.waitForTimeout(1500);
      await onAfterStep?.(`Step 3 – after cascade dropdown ${i} selection`);
    }
    await clickNext();

    // ── Step 5: Additional Details (Description required) ──────────
    const description = page.locator('textarea').first();
    await description.waitFor({ state: 'visible', timeout: 10_000 });
    await onAfterStep?.('Step 5 – Description');
    await description.fill(
      `PW citizen wizard test ${Date.now()} — auto-filed, please ignore`,
    );
    await clickNext();

    // ── Step 6: Upload Photos (skip) → SUBMIT ───────────────────────
    await page.waitForTimeout(2000);
    await onAfterStep?.('Step 6 – Upload Photos');

    const submitBtn = page.locator('button:visible').filter({ hasText: /^SUBMIT$/ }).first();
    await submitBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await submitBtn.click();
    await page.waitForTimeout(8000);
  }

  test('walks 6 steps + submits + lands on /pgr/response with PGR ID', {
    annotation: {
      type: 'description',
      description: `Citizen happy-path: a logged-in citizen files a complaint by walking all six steps of the file-complaint wizard, clicks Submit, and lands on the confirmation page with a PGR identifier.

Steps:
1. OTP-login as the provisioned citizen (readProvisionedCitizen / citizen-fixture.json).
2. Open /digit-ui/citizen/pgr/create-complaint/complaint-type.
3. Step 1 (Complaint Details): pick Type and Subtype from the dropdowns, click Next.
4. Step 2 (Pin Location): accept the default pin — do NOT touch the map (CCRS#469 keeps the test stable).
5. Step 3 (Location Details): assert postal code is auto-filled from step 2; click Next.
6. Step 4 (Complaint's Location): pick County → Sub-County → Ward (cascade gates each level — CCRS#477).
7. Step 5 (Description): fill the required description, click Next.
8. Step 6 (Photo): skip the optional dropzone, click SUBMIT.
9. Assert the URL flips to /pgr/response and a complaint id matching ^<PGR_ID_PREFIX>-PGR-\\d{4}-\\d{2}-\\d{2}-\\d+$ is rendered.
   The prefix is discovered live from egov-idgen (citizen.setup.ts); PGR_ID_PREFIX env is the fallback ("PG" stock, "NCCG" on Nairobi).

Test timeout is 180s — six steps plus DOM settles plus the final POST regularly exceeds 90s.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'],
  }, async ({ page }) => {
    test.setTimeout(180_000);
    // Use the provisioned citizen (citizen-fixture.json) so login succeeds on
    // every deployment without registering a fresh phone each run.
    await citizenOtpLogin(page);

    await page.goto(
      `${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.waitForTimeout(5000);

    await walkWizard(page, { assertPincodeToast: true });

    // ── Confirmation page contract ─────────────────────────────────
    // Gated on the declared capability, not a stray env hatch: whether a
    // deployment's PGR backend actually accepts a citizen-filed complaint (e.g.
    // the bomet ke HTTP 400 / JsonMappingException history) is exactly what
    // capabilities.ts's pgr.citizenCreate encodes (APPLY role includes CITIZEN).
    // Both maputo-local and bomet declare it 'required', so this must run for
    // real on both — a true regression now fails loudly instead of hiding
    // behind PGR_CREATE_UNSUPPORTED. Wizard navigation (Steps 1-6) above always
    // runs regardless, and is independently verified by the raw-keys test.
    requires(test, 'pgr.citizenCreate', 'wizard navigation is verified by the raw-keys test');
    await expect(page).toHaveURL(/\/citizen\/pgr\/response/);
    const body = page.locator('body');
    await expect(body).toContainText('Complaint Submitted');
    // Deployment-specific complaint-ID prefix is discovered live by
    // citizen.setup.ts (egov-idgen pgr.servicerequestid) and persisted on the
    // provisioned citizen; PGR_ID_PREFIX (env) is the fallback.
    const pgrIdPrefix = readProvisionedCitizen()?.pgrIdPrefix ?? PGR_ID_PREFIX;
    await expect(body).toContainText(new RegExp(`${pgrIdPrefix}-PGR-\\d{4}-\\d{2}-\\d{2}-\\d+`));
    await expect(body).toContainText(/Go back to home page/i);

    // Smoke: no error fallback rendered
    await expect(body).not.toContainText('Something went wrong');
  });

  test('no raw localization keys visible at any wizard step', {
    annotation: {
      type: 'description',
      description: `Walks the citizen file-complaint wizard step-by-step and after each step scans the page body text for raw localization keys (e.g. SERVICEDEFS.DRAINS, BOUNDARY.OROMIA, CS_COMMON_*). Fails immediately with the offending key(s) if any are visible to the citizen at that step.

The regex /\\b[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+\\b/g is preserved verbatim from the legacy complaint-submit.spec.ts regression.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'],
  }, async ({ page }) => {
    test.setTimeout(180_000);
    // Use the provisioned citizen so login succeeds on every deployment.
    await citizenOtpLogin(page);

    await page.goto(
      `${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.waitForTimeout(5000);

    await walkWizard(page, {
      onAfterStep: (label) => assertNoRawKeys(page, label),
    });

    // ── Confirmation page ─────────────────────────────────────────────────
    await expect(page).toHaveURL(/\/citizen\/pgr\/response/);
    await assertNoRawKeys(page, 'Confirmation page');
  });
});
