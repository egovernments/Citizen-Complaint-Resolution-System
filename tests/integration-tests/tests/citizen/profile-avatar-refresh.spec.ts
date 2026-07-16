/**
 * Citizen profile — sidebar Avatar refresh on photo save (CCRS #556 render half).
 *
 * STATUS: `.fixme` until the citizen sidebar v2 component gets the
 * photo render port. The legacy CitizenSideBar.Profile fix (commit
 * 52296df7) only powers the mobile drawer; the live desktop sidebar
 * on bomet is the v2 component `digit-ui-components-v2/citizen-sidebar.tsx`
 * which has zero photo handling (`grep -c photo` = 0).
 *
 * The save half is covered by `citizen/profile-photo-save-556.spec.ts`.
 * Drop `.fixme` when the v2 sidebar gets a `photoUrl` prop in its
 * Avatar + an effect subscribing to `Digit.UserService.getUser()`.
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BASE_URL, FIXED_OTP, generateCitizenPhone } from '../utils/env';

const CITIZEN_LOGIN_URL = '/digit-ui/citizen/login';
const CITIZEN_PROFILE_URL = '/digit-ui/citizen/user/profile';

test.describe('citizen profile — sidebar Avatar refresh on save #556 (v2 port)', () => {
  test.fixme(
    'sidebar avatar img.src changes after save without a hard refresh',
    { tag: ['@persona:citizen'] },
    async ({ page }) => {
      const mobile = generateCitizenPhone();

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
      await page.waitForURL(/\/digit-ui\/citizen(?!\/login)/, { timeout: 25_000 });

      await page.goto(`${BASE_URL}${CITIZEN_PROFILE_URL}?cb=${Date.now()}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3_000);

      const sidebarAvatar = page
        .locator(
          'aside img, [class*="sidebar" i] img, [class*="SideBar" i] img, [class*="v2-citizen-sidebar" i] img',
        )
        .first();
      const before = await sidebarAvatar.getAttribute('src').catch(() => null);

      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8_000 });
      await page.getByRole('button', { name: /change photo/i }).click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(path.resolve(__dirname, '../fixtures/avatar.png'));
      await page.waitForTimeout(1_500);

      await page.getByRole('button', { name: /^save$|update profile|^update$/i }).first().click();
      await page
        .waitForResponse(
          (r) => /\/user\/profile\/_update|\/user\/users\/_update/.test(r.url()) && r.status() < 500,
          { timeout: 15_000 },
        )
        .catch(() => null);
      await page.waitForTimeout(3_000);

      const after = await sidebarAvatar.getAttribute('src').catch(() => null);
      expect(after, 'sidebar avatar src must change after profile save').not.toBe(before);
    },
  );
});
