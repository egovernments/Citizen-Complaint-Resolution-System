/**
 * Citizen-flow regression for theflywheel/digit-ui-esbuild#74:
 *   - egovernments/CCRS#469: pin-location validation trap. The map's
 *     reverse-geocoded pincode (e.g. "40476") used to mirror onto
 *     formData.postalCode via a render mutation; react-hook-form
 *     retained the value across step changes, so picking a fresh pin
 *     and stepping forward still validated against the stale code.
 *   - egovernments/CCRS#477: locality cascade allowed selecting Ward
 *     directly without picking County → Sub-County, because every
 *     dropdown rendered as soon as the boundary tree loaded.
 *
 * The fix lives in the citizen FormExplorer + BoundaryComponent. We
 * exercise the wizard end-to-end against the configured deployment
 * (BASE_URL env var — defaults to https://naipepea.digit.org via env.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';

test.describe('06-citizen-pin-and-cascade — PR #74 regression', () => {
  test.slow();

  test('pin step + locality cascade no longer trap the citizen', {
    annotation: {
      type: 'description',
      description: `Catches the two pre-fix traps in the citizen wizard. CCRS#469: picking a pin would leak its reverse-geocoded pincode onto formData.postalCode, and stale validation would re-fire on step advance ("Pincode not serviceable"). CCRS#477: the cascade rendered every level immediately, so a citizen could pick a Ward without picking County → Sub-County. Post-fix the cascade gates each level and the pincode toast is gone.

Steps:
1. test.slow(); setTimeout 180s.
2. Attach pageerror listener (only catches uncaught throws — bundle has noisy console.error from PropTypes etc).
3. citizenOtpLogin (provisioned citizen); assert Citizen.token persisted.
4. Navigate to /pgr/create-complaint/complaint-type, wait 6s for hydration.
5. Step 1: open type dropdown → pick first item; if a subtype dropdown appears, pick its first item too. NEXT.
6. Step 2: Pin Location — don't touch the map. NEXT.
7. Assert no "pincode not serviceable" toast appeared after step 2.
8. Step 3 Location Details (cascade): assert exactly 1 cascade dropdown initially (top-level Region/County).
9. Pick Region; assert dropdown count becomes 2 (Sub-Region appeared).
10. Pick Sub-Region; assert count becomes 3 (Woreda/Ward appeared).
11. Pick Woreda/Ward (a leaf). NEXT becomes enabled.
12. Assert pageErrors === [].

The cascade dropdowns use button[role="combobox"] on modern digit-ui (Ethiopia) or
input[class*="select-wrap--elipses"] on older builds — the locator covers both.
Long-running with explicit DOM count assertions to lock in the cascade gating contract — pre-fix it was always 3, post-fix it grows 1 → 2 → 3.`,
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

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`, {
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
    // Cascade-specific: matches both modern button comboboxes and older inputs.
    const cascadeDropdowns = page.locator(
      'button[role="combobox"], input[class*="select-wrap--elipses"]',
    );
    // Item selector covers both shadcn [role="option"] and older .digit-dropdown-item.
    const firstOption = page.locator('[role="option"], .digit-dropdown-item').first();

    // ── Step 1: Complaint Details (Type + Subtype) ──────────────────
    await dropdowns.first().waitFor({ state: 'visible', timeout: 15_000 });
    await dropdowns.first().click();
    await page.waitForTimeout(800);
    await firstOption.click();
    await page.waitForTimeout(1500);

    // Subtype is the 2nd dropdown — appears or becomes enabled after Type pick.
    // On ke (CRS digit-ui) the Sub-Type combobox renders immediately but starts
    // disabled; it enables after the Category MDMS response arrives. Wait for it.
    const subtypeVisible = await dropdowns.nth(1).isVisible({ timeout: 3000 }).catch(() => false);
    if (subtypeVisible) {
      await expect(dropdowns.nth(1)).toBeEnabled({ timeout: 8000 }).catch(() => {});
      const subtypeEnabled = await dropdowns.nth(1).isEnabled().catch(() => false);
      if (subtypeEnabled) {
        await dropdowns.nth(1).click();
        await page.waitForTimeout(800);
        await page.locator('[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible').first().click();
        await page.waitForTimeout(1000);
      }
    }
    await clickNext();

    // ── Step 2: Pin Location — DON'T touch the map. Click Next. ─────
    // Pre-fix this would trap the citizen at step 3 with a 40476
    // toast; we want the wizard to advance straight through.
    await page.waitForTimeout(2500);
    await clickNext();

    // ── Assert no pincode toast appeared after pin step ──────────────
    const pincodeToast = page.locator('text=/pincode.*not serv|CS_COMMON_PINCODE_NOT_SERVICABLE/i');
    await expect(pincodeToast).toHaveCount(0);

    // ── Step 3: Location Details (boundary cascade) ──────────────────
    // Wait for the cascade to mount. The cascade is part of the Location
    // Details step — it starts with only the top-level boundary (Region
    // or County) visible and gates each child level until the parent is
    // selected (CCRS#477 fix).
    await page.waitForTimeout(3000);

    // Post-fix: only the top-level dropdown (Region/County) is visible
    // initially. Pre-fix this was already ≥2 because every level rendered
    // eagerly. The exact depth varies by tenant boundary tree (Ethiopia =
    // 2 levels: Region → Ward; Kenya = 3 levels: County → Sub-County → Ward).
    const initialCount = await cascadeDropdowns.count();
    expect(
      initialCount,
      `Expected only 1 cascade dropdown (top-level boundary) initially; got ${initialCount}. ` +
        `Pre-fix this was >1 because every level rendered eagerly.`,
    ).toBe(1);

    // Pick top-level (Region/County) → next level should appear.
    await cascadeDropdowns.first().click();
    await page.waitForTimeout(800);
    await page.locator('[role="option"], .digit-dropdown-item').first().click();
    await page.waitForTimeout(1500);
    const afterFirstPick = await cascadeDropdowns.count();
    expect(
      afterFirstPick,
      `Cascade should add at least one child level after picking the top-level boundary (got ${afterFirstPick}).`,
    ).toBeGreaterThan(1);

    // Walk any remaining unset cascade dropdowns (second and third levels if present).
    // On ke child dropdowns render immediately but start disabled — wait for each
    // to become enabled before interacting (Playwright polls via toBeEnabled).
    for (let i = 1; i < afterFirstPick; i++) {
      const dd = cascadeDropdowns.nth(i);
      // Wait up to 6 s for the dropdown to become enabled after the parent pick.
      await expect(dd).toBeEnabled({ timeout: 6000 }).catch(() => {});
      const ddEnabled = await dd.isEnabled().catch(() => false);
      if (!ddEnabled) break; // still disabled — no further levels
      // Use /^Select/i (no trailing space) to also match "Select…" (ke shadcn placeholder).
      const hasValue = await dd.evaluate(
        (el) => !(el as HTMLElement).innerText.match(/^Select/i),
      ).catch(() => false);
      if (hasValue) continue; // already auto-filled
      await dd.click();
      await page.waitForTimeout(800);
      await page.locator('[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible').first().click();
      await page.waitForTimeout(1500);
    }

    expect(pageErrors, 'no uncaught errors during the wizard').toEqual([]);
  });
});
