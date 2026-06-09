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
 * exercise the wizard end-to-end against a dev build (BASE_URL =
 * http://localhost:18081 by default — the worktree dev server) so we
 * can validate before the PR merges and naipepea pulls.
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

const PHONE = generateCitizenPhone();

test.describe('06-citizen-pin-and-cascade — PR #74 regression', () => {
  test.slow();

  test('pin step + locality cascade no longer trap the citizen', {
    annotation: {
      type: 'description',
      description: `Catches the two pre-fix traps in the citizen wizard. CCRS#469: picking a pin would leak its reverse-geocoded pincode onto formData.postalCode, and stale validation would re-fire on step advance ("Pincode not serviceable"). CCRS#477: the cascade rendered every level immediately, so a citizen could pick a Ward without picking County → Sub-County. Post-fix the cascade gates each level and the pincode toast is gone.

Steps:
1. test.slow(); setTimeout 180s.
2. Attach pageerror listener (only catches uncaught throws — bundle has noisy console.error from PropTypes etc).
3. citizenOtpLogin; assert Citizen.token persisted.
4. Navigate to /pgr/create-complaint, wait 6s for hydration.
5. Step 0: open type dropdown → pick first item; if a subtype dropdown appears, pick its first item too. NEXT.
6. Step 1: don't touch the map. NEXT.
7. Step 2: don't edit postal code. NEXT.
8. Assert no "pincode not serviceable" toast appeared during steps 1–2.
9. Step 3 cascade: assert exactly 1 dropdown initially (County).
10. Pick County; assert dropdown count becomes 2 (Sub-County appeared).
11. Pick Sub-County; assert count becomes 3 (Ward appeared).
12. Pick Ward (a leaf).
13. Assert pageErrors === [].

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

    await citizenOtpLogin(page, PHONE);
    const token = await page.evaluate(() => localStorage.getItem('Citizen.token'));
    expect(token, 'OTP login should persist Citizen.token').toBeTruthy();

    await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(6000);

    const clickNext = async (label: RegExp = /^(NEXT|Next)$/) => {
      const btn = page.locator('button').filter({ hasText: label }).first();
      await btn.waitFor({ state: 'visible', timeout: 10_000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(2500);
    };

    // ── Step 0: pick complaint type (and subtype if shown) ──────────
    const typeDropdown = page.locator('input.digit-dropdown-employee-select-wrap--elipses').first();
    await typeDropdown.waitFor({ state: 'visible', timeout: 15_000 });
    await typeDropdown.click();
    await page.waitForTimeout(800);
    await page.locator('.digit-dropdown-item').first().click();
    await page.waitForTimeout(1500);

    const dropdownsAfterType = await page.locator('input.digit-dropdown-employee-select-wrap--elipses').count();
    if (dropdownsAfterType > 1) {
      const subtype = page.locator('input.digit-dropdown-employee-select-wrap--elipses').nth(1);
      await subtype.click();
      await page.waitForTimeout(800);
      await page.locator('.digit-dropdown-item').first().click();
      await page.waitForTimeout(800);
    }
    await clickNext();

    // ── Step 1: Pin Location — DON'T touch the map. Click Next. ─────
    // Pre-fix this would trap the citizen at step 2 with a 40476
    // toast; we want the wizard to advance straight through.
    await page.waitForTimeout(2500);
    await clickNext();

    // ── Step 2: Location Details — DON'T edit postalCode. Click Next.
    // Pre-fix the allowlist check would fire on the auto-filled
    // pincode and surface "Pincode not serviceable". Post-fix the
    // ward resolution short-circuits the allowlist.
    await page.waitForTimeout(2500);
    await clickNext();

    // ── Assert no pincode toast appeared during pin/location steps ──
    const pincodeToast = page.locator('text=/pincode.*not serv|CS_COMMON_PINCODE_NOT_SERVICABLE/i');
    await expect(pincodeToast).toHaveCount(0);

    // ── Step 3: Complaint Location (boundary cascade) ───────────────
    // Wait for the cascade to mount.
    await page.waitForTimeout(3000);
    const cascadeDropdowns = page.locator('input[class*="select-wrap--elipses"]');

    // Post-fix: only the top-level dropdown (County) is visible until a
    // selection is made.
    const initialCount = await cascadeDropdowns.count();
    expect(
      initialCount,
      `Expected only 1 cascade dropdown (County) initially; got ${initialCount}. ` +
        `Pre-fix this was 3 because every level rendered eagerly.`,
    ).toBe(1);

    // Pick County → Sub-County dropdown should appear.
    await cascadeDropdowns.first().click();
    await page.waitForTimeout(800);
    await page.locator('.digit-dropdown-item').first().click();
    await page.waitForTimeout(1500);
    const afterCounty = await cascadeDropdowns.count();
    expect(afterCounty, 'Sub-County dropdown should appear after picking County').toBe(2);

    // Pick Sub-County → Ward dropdown should appear.
    await cascadeDropdowns.nth(1).click();
    await page.waitForTimeout(800);
    await page.locator('.digit-dropdown-item').first().click();
    await page.waitForTimeout(1500);
    const afterSub = await cascadeDropdowns.count();
    expect(afterSub, 'Ward dropdown should appear after picking Sub-County').toBe(3);

    // Pick Ward (a leaf — no children).
    await cascadeDropdowns.nth(2).click();
    await page.waitForTimeout(800);
    await page.locator('.digit-dropdown-item').first().click();
    await page.waitForTimeout(800);

    expect(pageErrors, 'no uncaught errors during the wizard').toEqual([]);
  });
});
