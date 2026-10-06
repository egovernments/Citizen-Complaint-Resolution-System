import { tenantSlug } from '../utils/identity-bff';
/**
 * Citizen-flow regression for theflywheel/digit-ui-esbuild#74:
 *   - egovernments/CCRS#469: pin-location validation trap. The map's
 *     reverse-geocoded pincode (e.g. "40476") used to mirror onto
 *     formData.postalCode via a render mutation; react-hook-form
 *     retained the value across step changes, so picking a fresh pin
 *     and stepping forward still validated against the stale code.
 *   - egovernments/CCRS#477: locality cascade allowed selecting Ward
 *     directly without picking County → Sub-County, because every
 *     dropdown rendered as soon as the boundary tree loaded. Every level
 *     renders from the start again (so a ward can be searched for
 *     directly), and picking one now fills its own County → Sub-County.
 *
 * The fix lives in the citizen FormExplorer + BoundaryComponent. We
 * exercise the wizard end-to-end against the configured deployment
 * (BASE_URL env var — see env.ts; local default http://localhost).
 * The cascade walk is boundary-tree agnostic: it steps through however
 * many levels the tenant's hierarchy exposes down to the selectable leaf
 * (e.g. County → … → Bairro on mz.maputo).
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';

test.describe('06-citizen-pin-and-cascade — PR #74 regression', () => {
  test.slow();

  test('pin step + locality cascade no longer trap the citizen', {
    annotation: {
      type: 'description',
      description: `Catches the two pre-fix traps in the citizen wizard. CCRS#469: picking a pin would leak its reverse-geocoded pincode onto formData.postalCode, and stale validation would re-fire on step advance ("Pincode not serviceable"). CCRS#477: the cascade rendered every level immediately, so a citizen could pick a Ward without picking County → Sub-County. Every level still renders from the start, but picking the deepest level fills the levels above it from the boundary tree, and the pincode toast is gone.

Steps:
1. test.slow(); setTimeout 180s.
2. Attach pageerror listener (only catches uncaught throws — bundle has noisy console.error from PropTypes etc).
3. citizenOtpLogin (provisioned citizen); assert Citizen.token persisted.
4. Navigate to /pgr/create-complaint/complaint-type, wait 6s for hydration.
5. Step 1: open type dropdown → pick first item; if a subtype dropdown appears, pick its first item too. NEXT.
6. Step 2: Pin Location — assert the optional map starts with no marker and NEXT is enabled.
7. Assert no "pincode not serviceable" toast appeared after step 2.
8. Step 3 Location Details (cascade): assert more than 1 cascade dropdown initially — every level renders from the start.
9. Pick the deepest level first; assert every level above it now shows a value (its own ancestors).
10. Assert pageErrors === [].

The cascade dropdowns use button[role="combobox"] on modern digit-ui (Ethiopia) or
input[class*="select-wrap--elipses"] on older builds — the locator covers both.
The dropdowns are scoped to the cascade's own .pgr-boundary-cascade container, so the complaint-type dropdowns on the (hidden, still mounted) first step don't count. The total depth is NOT pinned — it varies by tenant boundary tree (2 levels on some deployments, 4 on mz.maputo) — only "every level from the start, and a deep pick fills its ancestors" is asserted.`,
    },
    tag: ['@area:pgr', '@ccrs:74', '@kind:regression', '@layer:ui', '@persona:citizen', '@pr:74'] }, async ({ page }) => {
    test.setTimeout(180_000);

    // We watch for *uncaught* JS errors only. The bundle produces a long
    // trail of pre-existing PropTypes / list-key / clip-path warnings via
    // console.error that have nothing to do with this PR — assert on
    // pageerror instead so our signal isn't drowned in noise.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Use the provisioned citizen (citizen-fixture.json, mobile 744928150)
    // so login succeeds on every deployment without re-registering.
    await citizenOtpLogin(page);
    const token = await page.evaluate(() => localStorage.getItem('Citizen.token'));
    expect(token, 'OTP login should persist Citizen.token').toBeTruthy();

    await page.goto(`${BASE_URL}/${tenantSlug()}/digit-ui/citizen/pgr/create-complaint/complaint-type`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(6000);

    const clickNext = async () => {
      const btn = page.locator('button:visible').filter({ hasText: /^NEXT$/ }).first();
      await btn.waitFor({ state: 'visible', timeout: 10_000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(2500);
    };

    // Cross-build dropdown locator: modern digit-ui (Ethiopia) uses
    // button[role="combobox"]; older builds used input.digit-dropdown-*.
    const dropdowns = page.locator(
      'button[role="combobox"], input.digit-dropdown-employee-select-wrap--elipses',
    );
    // Cascade-specific: matches both modern button comboboxes and older inputs,
    // inside the cascade only (earlier steps stay mounted while hidden).
    const cascadeDropdowns = page
      .locator('.pgr-boundary-cascade')
      .locator('button[role="combobox"], input[class*="select-wrap--elipses"]');
    // ── Step 1: Complaint Details — walk EVERY hierarchy level ──────
    // The complaint-type hierarchy depth is tenant-defined (MDMS
    // RAINMAKER-PGR.ComplaintHierarchyDefinition): 2 levels on mz.maputo
    // (CATEGORY → SUB_TYPE) but 4 on ke (AUTHORITY_TYPE → MAIN_CATEGORY →
    // SECTOR → SUB_TYPE). EVERY level with options is mandatory, so NEXT
    // stays disabled until the deepest one is picked. Assuming a fixed
    // Type+Subtype pair left SECTOR/SUB_TYPE unset on ke and the test hung
    // on a permanently-disabled NEXT. Walk until no enabled, unset level
    // remains; safety limit of 8 covers every known deployment.
    await dropdowns.first().waitFor({ state: 'visible', timeout: 15_000 });
    for (let level = 0; level < 8; level++) {
      const combobox = dropdowns.nth(level);
      const visible = await combobox
        .isVisible({ timeout: level === 0 ? 5000 : 3000 })
        .catch(() => false);
      if (!visible) break;
      // Child levels render disabled until the parent's MDMS lookup lands.
      await expect(combobox).toBeEnabled({ timeout: 8000 }).catch(() => {});
      if (!(await combobox.isEnabled().catch(() => false))) break;
      // Skip any level the app already auto-filled.
      const hasPlaceholder = await combobox
        .evaluate((el) => /^Select/i.test((el as HTMLElement).innerText.trim()))
        .catch(() => true);
      if (!hasPlaceholder) continue;
      await combobox.click();
      await page.waitForTimeout(800);
      const option = page
        .locator('[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible')
        .first();
      if (!(await option.isVisible({ timeout: 5000 }).catch(() => false))) break;
      await option.click();
      await page.waitForTimeout(1500);
    }
    await clickNext();

    // ── Step 2: optional Pin Location — continue without a pin. ─────
    // The configured centre is only a viewport. It must not create a marker,
    // reverse-geocoded postal code, or mandatory-value gate.
    await page.waitForTimeout(2500);
    const map = page.locator('.leaflet-container').first();
    await expect(map).toBeVisible();
    await expect(map.locator('.leaflet-marker-icon')).toHaveCount(0);
    await expect(page.locator('button:visible').filter({ hasText: /^NEXT$/ }).first()).toBeEnabled();
    await clickNext();

    // ── Assert no pincode toast appeared after pin step ──────────────
    const pincodeToast = page.locator('text=/pincode.*not serv|CS_COMMON_PINCODE_NOT_SERVICABLE/i');
    await expect(pincodeToast).toHaveCount(0);

    // ── Step 3: Location Details (boundary cascade) ──────────────────
    // Every level renders from the start so a citizen can search for their
    // ward directly. What CCRS#477 needs is that a ward never stands without
    // its own County → Sub-County: picking the deepest level fills them.
    await page.waitForTimeout(3000);

    const initialCount = await cascadeDropdowns.count();
    expect(
      initialCount,
      `Expected every cascade level to render from the start; got ${initialCount}.`,
    ).toBeGreaterThan(1);

    // Pick the deepest level that lists from the start. On a very large tree
    // (Maputo's quarteirões) the lowest level waits, disabled, for its parent.
    let deepestIndex = initialCount - 1;
    while (deepestIndex > 0 && !(await cascadeDropdowns.nth(deepestIndex).isEnabled())) deepestIndex--;
    const deepest = cascadeDropdowns.nth(deepestIndex);
    await expect(deepest).toBeEnabled({ timeout: 6000 });
    await deepest.click();
    await page.waitForTimeout(800);
    await page.locator('[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible').first().click();
    await page.waitForTimeout(1500);

    // Every level above it now holds that place's own ancestors. Use /^Select/i
    // (no trailing space) to also match "Select…" (ke shadcn placeholder).
    for (let i = 0; i < deepestIndex; i++) {
      const text = await cascadeDropdowns.nth(i).evaluate((el) => (el as HTMLElement).innerText.trim());
      expect(text, `Cascade level ${i + 1} should be filled by the deepest pick`).not.toMatch(/^Select/i);
    }

    expect(pageErrors, 'no uncaught errors during the wizard').toEqual([]);
  });
});
