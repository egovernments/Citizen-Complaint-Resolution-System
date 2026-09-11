/**
 * Citizen profile — photo save round-trip (CCRS #556).
 *
 * The #556 fix landed in `UserProfile.js` (include `photo` in session
 * writeback) and `CitizenSideBar.Profile` (useEffect dep). This spec
 * proves the SAVE half end-to-end: OTP login → upload photo → backend
 * `_update` returns 2xx → page stays on /user/profile (no hard reload).
 *
 * The render half (sidebar Avatar reflects the new photo) is a
 * separate concern — the live citizen sidebar on bomet is the v2
 * component (`digit-ui-components-v2/citizen-sidebar.tsx`) which has
 * no photo rendering at all. Tracked as a follow-up on #556.
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BASE_URL, FIXED_OTP, generateCitizenPhone } from '../utils/env';

const CITIZEN_LOGIN_URL = '/digit-ui/citizen/login';
const CITIZEN_PROFILE_URL = '/digit-ui/citizen/user/profile';

test.describe('citizen profile — photo save round-trip #556', () => {
  // Citizen flow does its own OTP login — don't reuse admin auth.json.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('upload photo, _update returns 2xx, no hard reload', { tag: ['@persona:citizen'] }, async ({ page }) => {
    const mobile = generateCitizenPhone();

    // ============ OTP login ============
    await page.goto(`${BASE_URL}${CITIZEN_LOGIN_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_500);

    await page
      .locator('input[type="tel"], input[type="number"]')
      .first()
      .pressSequentially(mobile, { delay: 80 });
    await page.getByRole('button', { name: /get otp|continue|next/i }).first().click();
    await page.waitForTimeout(2_500);

    const otpDigits = page.locator('input[autocomplete="one-time-code" i], input[maxlength="1"]');
    if ((await otpDigits.count()) >= 6) {
      for (let i = 0; i < 6; i++) await otpDigits.nth(i).fill(FIXED_OTP[i]);
    } else {
      await page.getByRole('textbox').first().fill(FIXED_OTP);
    }
    await page.getByRole('button', { name: /verify|login|submit|continue/i }).first().click();
    // On ke/bomet the SPA performs an MDMS round-trip before settling on
    // /all-services or /select-language.  The 25 s budget is extended to
    // 45 s; the regex excludes only the /login leaf so any citizen sub-path
    // (including intermediate select-language / select-city routes) satisfies
    // the guard and the test continues without waiting for the final home.
    await page.waitForURL(/\/digit-ui\/citizen(?!\/login\b)/, { timeout: 45_000 });
    await page.waitForTimeout(3_000);

    // ============ Open Edit Profile ============
    await page.goto(`${BASE_URL}${CITIZEN_PROFILE_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_500);

    const sidebar = page.locator('aside, [class*="sidebar" i], [class*="SideBar" i]').first();
    const sidebarImgsBefore = await sidebar.locator('img').count();

    // ============ Upload photo via Change photo button + filechooser ============
    const changePhotoBtn = page.getByRole('button', { name: /change photo/i });
    if (await changePhotoBtn.isVisible().catch(() => false)) {
      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8_000 });
      await changePhotoBtn.click();
      const fileChooser = await fileChooserPromise.catch(() => null);
      if (fileChooser) {
        await fileChooser.setFiles(path.resolve(__dirname, '../fixtures/avatar.png'));
      } else {
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles(path.resolve(__dirname, '../fixtures/avatar.png'));
      }
    } else {
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles(path.resolve(__dirname, '../fixtures/avatar.png'));
    }
    await page.waitForTimeout(2_500);

    // ============ Save — assert /_update returns non-5xx ============
    const saveResponsePromise = page.waitForResponse(
      (r) =>
        /\/user\/profile\/_update|\/user\/_updatenovalidate|\/user\/users\/_update/.test(r.url()) &&
        r.status() < 500,
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: /^save$|update profile|^update$/i }).first().click();
    const saveResp = await saveResponsePromise.catch(() => null);
    expect(saveResp, '_update endpoint must be hit and respond non-5xx').not.toBeNull();
    expect(saveResp!.status(), 'profile save round-trip must succeed').toBeLessThan(400);
    await page.waitForTimeout(3_500);

    // ============ No hard reload — still on /user/profile ============
    expect(page.url(), 'no hard reload should have happened — still on profile').toMatch(
      /\/digit-ui\/citizen\/user\/profile/,
    );

    // Record sidebar img-count delta as an observation (the render half
    // is the v2 sidebar port follow-up; we don't fail this spec on it).
    const sidebarImgsAfter = await sidebar.locator('img').count();
    test.info().annotations.push({
      type: 'observation',
      description: `sidebar <img> count before=${sidebarImgsBefore}, after=${sidebarImgsAfter} — render half tracked separately`,
    });
  });
});
