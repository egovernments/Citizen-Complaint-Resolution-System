import { tenantSlug } from '../utils/identity-bff';
/**
 * Citizen file-complaint wizard — happy path
 *
 * Walks the live wizard and asserts the confirmation page contract. Develop's
 * flow (CreatePGRFlowV2, the #2038 design) has three steps and the URL stays
 * at `/create-complaint/complaint-type` for every one:
 *   - Step 1 (Complaint details): the description is required, photos are
 *     optional, and every complaint-category level is required.
 *   - Step 2 (Location): the map pin is optional and starts with no marker;
 *     the boundary cascade is required down to its leaf (every level shows
 *     from the start and a pick fills the levels above it, CCRS#477).
 *   - Step 3 (Review): "Submit complaint" is the final button.
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, PGR_ID_PREFIX } from '../utils/env';
import { readProvisionedCitizen } from '../utils/citizen-provision';
import { requires } from '../utils/capabilities';
import { continueFiling, currentPane, fillDetailsStep, fillLocationStep, primaryButton } from '../utils/citizen-filing';

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

  type TextChunk = { text: string; where: string };

  /**
   * Collect the page's rendered text one DOM text node at a time, each tagged
   * with a short description of the element that owns it.
   *
   * Why not `body.textContent()` (what this used to do): textContent welds every
   * text node together with no separator, so two adjacent field labels
   * ("AUTHORITY_TYPE" and "MAIN_CATEGORY") arrive as the single string
   * "AUTHORITY_TYPEMAIN_CATEGORY" — and the regex then reports that weld as one
   * bogus key that exists nowhere in the product, hiding both real keys and
   * sending whoever reads the failure hunting for a key that was never looked up.
   *
   * Scanning node-by-node keeps exactly the same coverage (every text node
   * textContent would have seen) while making each reported key a string a
   * citizen actually reads, plus where on the page it sits. Splitting can only
   * remove weld artefacts, never a real key: a rendered key is always one node.
   *
   * <script>/<style>/<noscript> are skipped — their contents are code, never
   * shown to a citizen, and inline JS is full of CONSTANT_CASE identifiers that
   * textContent used to feed to the regex as pure false positives.
   */
  const collectTextChunks = (page: Page): Promise<TextChunk[]> =>
    page.evaluate(() => {
      const describe = (el: Element | null): string => {
        if (!el) return '<unknown>';
        const parts: string[] = [];
        let node: Element | null = el;
        for (let depth = 0; node && depth < 3; node = node.parentElement, depth++) {
          let s = node.tagName.toLowerCase();
          if (node.id) {
            s += `#${node.id}`;
          } else {
            const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
            if (cls) s += `.${cls}`;
          }
          parts.unshift(s);
          if (node.tagName === 'BODY') break;
        }
        return parts.join(' > ');
      };

      const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement && SKIP.has(node.parentElement.tagName)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });

      const out: { text: string; where: string }[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.textContent || '').trim();
        if (text) out.push({ text, where: describe(n.parentElement) });
      }
      return out;
    });

  const assertNoRawKeys = async (page: Page, stepLabel: string) => {
    const chunks = await collectTextChunks(page);
    // key -> first chunk that showed it (dedup: one key repeated down a listbox
    // shouldn't drown the report).
    const hits = new Map<string, TextChunk>();
    for (const chunk of chunks) {
      for (const key of rawKeysIn(chunk.text)) {
        if (!hits.has(key)) hits.set(key, chunk);
      }
    }
    const report = [...hits.entries()]
      .map(
        ([key, c]) =>
          `  • ${key}\n      in:            ${c.where}\n      rendered text: ${JSON.stringify(c.text)}`,
      )
      .join('\n');
    expect(
      [...hits.keys()],
      `Step "${stepLabel}" shows ${hits.size} raw localization key(s) to the citizen:\n${report}`,
    ).toHaveLength(0);
  };

  /**
   * Walk develop's three filing steps (details, location, review) through
   * Submit and wait for the response page (utils/citizen-filing.ts).
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
      exerciseOptionalPinClear?: boolean;
    } = {},
  ): Promise<void> {
    const {
      onAfterStep,
      assertPincodeToast = false,
      exerciseOptionalPinClear = false,
    } = options;

    // ── Step 1: Complaint details (description, photos, category levels) ──
    await fillDetailsStep(page, { onAfterStep });
    await continueFiling(page);

    // ── Step 2: Location (optional pin, boundary to the leaf, postal, landmark) ──
    const pane = currentPane(page);
    const map = pane.locator('.leaflet-container').first();
    const marker = map.locator('.leaflet-marker-icon');
    const next = primaryButton(page);
    await expect(map, 'pin-location map must mount before its state is asserted').toBeVisible();
    await expect(
      marker,
      'a fresh complaint must use the configured coordinates only as its viewport, not as a selected pin',
    ).toHaveCount(0);
    await fillLocationStep(page, { onAfterStep });
    await expect(
      next,
      'the exact map pin is optional; a citizen must be able to continue without one',
    ).toBeEnabled();

    if (exerciseOptionalPinClear) {
      // Make reverse geocoding deterministic and deliberately slow. The old
      // component accepted this response after Clear, patched the cleared
      // GeoLocationsPoint back into formData, and restored the marker.
      await page.route('https://nominatim.openstreetmap.org/reverse**', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            display_name: 'Playwright delayed reverse-geocode result',
            address: { postcode: '00100' },
          }),
        });
      });
      // Typing makes the clear control available immediately. Forward search
      // is irrelevant to this interaction, so keep it deterministic too.
      await page.route('https://nominatim.openstreetmap.org/search**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );

      const searchInput = pane.locator('.cms-map input[type="text"]').first();
      await expect(searchInput).toBeVisible();
      await searchInput.fill('pin selected only to be cleared');

      const bounds = await map.boundingBox();
      expect(bounds, 'Leaflet map must have a measurable click target').not.toBeNull();
      await map.click({
        position: {
          x: Math.max(20, Math.floor(bounds!.width * 0.62)),
          y: Math.max(20, Math.floor(bounds!.height * 0.58)),
        },
      });
      await expect(marker, 'clicking the map must create one explicit pin').toHaveCount(1);

      // A reverse geocode is still deliberately in flight. The loading status
      // must not intercept pointer input: the user can replace the pin and then
      // clear it without waiting for address enrichment (CCRS#1808).
      await map.click({
        position: {
          x: Math.max(20, Math.floor(bounds!.width * 0.38)),
          y: Math.max(20, Math.floor(bounds!.height * 0.42)),
        },
      });
      await expect(marker, 'a second real map click must replace the pin while geocoding is in flight').toHaveCount(1);

      // GeoLocations renders this icon-only control immediately after the
      // search input. Use a real pointer click so an input-blocking veil makes
      // this regression test fail instead of being bypassed programmatically.
      const clearControl = searchInput.locator('xpath=following-sibling::div[1]');
      await expect(clearControl, 'the map search field must expose its clear control').toHaveCount(1);
      await clearControl.click();

      await expect(marker, 'Clear must remove the explicitly selected pin').toHaveCount(0);
      await expect(next, 'clearing an optional pin must not disable Next').toBeEnabled();

      // Wait beyond the delayed reverse response. It must be ignored rather
      // than resurrecting the marker/form value or rewriting session storage.
      await page.waitForTimeout(1600);
      await expect(marker, 'a stale reverse-geocode response must not restore a cleared pin').toHaveCount(0);
      await expect(next).toBeEnabled();
      const savedMapLocation = await page.evaluate(() =>
        (window as any).Digit?.SessionStorage?.get?.('PGR_MAP_LOCATION') ?? null,
      );
      expect(savedMapLocation, 'Clear must remove the cross-complaint map cache').toBeNull();
    }

    await continueFiling(page);

    if (exerciseOptionalPinClear) {
      // Re-entering the map step exercises the wizard restore path. The
      // cleared value must remain cleared after the component remounts.
      const back = page.locator('button.cms-back');
      await expect(back).toBeVisible();
      await back.click();
      await expect(map).toBeVisible();
      await expect(marker, 'Back navigation must not restore a cleared/session-cached pin').toHaveCount(0);
      await expect(next).toBeEnabled();
      await continueFiling(page);
    }

    if (assertPincodeToast) {
      // No "Pincode not serviceable" toast (CCRS#469 fix verified)
      const pincodeToast = page.locator(
        'text=/pincode.*not serv|CS_COMMON_PINCODE_NOT_SERVICABLE/i',
      );
      await expect(pincodeToast).toHaveCount(0);
    }

    // ── Step 3: Review → Submit complaint ──────────────────────────
    await onAfterStep?.('Step 3 – Review');
    await expect(next).toHaveText(/submit/i);
    await continueFiling(page);
    await page.waitForURL(/\/citizen\/pgr\/response/, { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  test('walks 6 steps + submits + lands on /pgr/response with PGR ID', {
    annotation: {
      type: 'description',
      description: `Citizen happy-path: a logged-in citizen files a complaint by walking the three steps of the file-complaint wizard, clicks Submit, and lands on the confirmation page with a PGR identifier. (The test title predates the three-step design; it is kept so the run history stays joined.)

Steps:
1. OTP-login as the provisioned citizen (readProvisionedCitizen / citizen-fixture.json).
2. Open /{slug}/digit-ui/citizen/pgr/create-complaint/complaint-type.
3. Step 1 (Complaint details): fill the required description, pick every category level, click Next.
4. Step 2 (Location): assert there is no default marker, complete the boundary cascade, and assert Next is enabled without a pin; select a pin, clear it while reverse geocoding is in flight, and assert it stays cleared.
5. Step 3 (Review): Back to the map keeps the pin cleared; click Submit complaint.
6. Assert the URL flips to /pgr/response and a complaint id matching ^<PGR_ID_PREFIX>-PGR-\\d{4}-\\d{2}-\\d{2}-\\d+$ is rendered.
   The prefix is discovered live from egov-idgen (citizen.setup.ts); PGR_ID_PREFIX env is the fallback ("PG" stock, "NCCG" on Nairobi).

Test timeout is 180s — the steps plus DOM settles plus the final POST regularly exceed 90s.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'],
  }, async ({ page }) => {
    test.setTimeout(180_000);
    // Use the provisioned citizen (citizen-fixture.json) so login succeeds on
    // every deployment without registering a fresh phone each run.
    await citizenOtpLogin(page);

    await page.goto(
      `${BASE_URL}/${tenantSlug()}/digit-ui/citizen/pgr/create-complaint/complaint-type`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.waitForTimeout(5000);

    let createPayload: any = null;
    page.on('request', (request) => {
      if (request.method() !== 'POST' || !request.url().includes('/pgr-services/v2/request/_create')) return;
      try { createPayload = request.postDataJSON(); } catch { /* assertion below reports the missing payload */ }
    });

    await walkWizard(page, {
      assertPincodeToast: true,
      exerciseOptionalPinClear: true,
    });

    // ── Confirmation page contract ─────────────────────────────────
    // Gated on the declared capability, not a stray env hatch: whether a
    // deployment's PGR backend actually accepts a citizen-filed complaint (e.g.
    // the bomet ke HTTP 400 / JsonMappingException history) is exactly what
    // capabilities.ts's pgr.citizenCreate encodes (APPLY role includes CITIZEN).
    // Both maputo-local and bomet declare it 'required', so this must run for
    // real on both — a true regression now fails loudly instead of hiding
    // behind PGR_CREATE_UNSUPPORTED. Wizard navigation (all steps) above always
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

    expect(createPayload, 'the wizard must issue a PGR create request').not.toBeNull();
    const geoLocation = createPayload?.service?.address?.geoLocation ?? {};
    expect(
      geoLocation,
      'a pin that was cleared before submit must not leak coordinates into the create payload',
    ).not.toHaveProperty('latitude');
    expect(geoLocation).not.toHaveProperty('longitude');
  });

  test('no raw localization keys visible at any wizard step', {
    annotation: {
      type: 'description',
      description: `Walks the citizen file-complaint wizard step-by-step and after each step scans every rendered text node for raw localization keys (e.g. SERVICEDEFS.DRAINS, BOUNDARY.OROMIA, CS_COMMON_*). Fails immediately, listing each offending key with the element that renders it and the exact text the citizen sees.

The regex /\\b[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+\\b/g is preserved verbatim from the legacy complaint-submit.spec.ts regression.

KNOWN RED on bomet (ke) — this is a real content defect, not a test bug. The wizard's level labels come from
CreatePGRFlowV2.tsx labelFor():  t((hierarchyType + "_" + levelCode).toUpperCase())  falling back to the MDMS
level's own \`label\`. On ke, RAINMAKER-PGR.ComplaintHierarchyDefinition[0] is hierarchyType "PGR_TEST" — a
7-row sample tree ("Sample AUTHORITY_TYPE", "Example Sub-type 1") whose levels are authored with
label === levelCode ("AUTHORITY_TYPE", "MAIN_CATEGORY", ...). No PGR_TEST_* rows exist in rainmaker-pgr
localization, so t() returns the key, the fallback is the equally raw label, and the citizen reads
"AUTHORITY_TYPE". It wins over the real 829-row "PGR" tree only because the picker takes the FIRST definition
that has any rows and PGR_TEST is listed first. Local (mz.maputo) ships one definition, "PGR", whose labels are
"Category"/"Sub-Type" — human-readable, so the same missing-localization fallback is invisible and this passes.
Fix on ke = drop/deactivate the PGR_TEST definition (also restores the real complaint tree to citizens); merely
loading PGR_TEST_* localization rows would only hide that citizens are being served a sample hierarchy.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'],
  }, async ({ page }) => {
    test.setTimeout(180_000);
    // Use the provisioned citizen so login succeeds on every deployment.
    await citizenOtpLogin(page);

    await page.goto(
      `${BASE_URL}/${tenantSlug()}/digit-ui/citizen/pgr/create-complaint/complaint-type`,
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
