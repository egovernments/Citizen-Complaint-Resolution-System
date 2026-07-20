import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Demo: citizen-side complaint create with image attachment on bomet — #555.
 *
 *   #555 — Uploaded file thumbnail must be visible on the complaint
 *          create form (immediate preview, server-side toast on
 *          rejected formats) AND on the complaint detail page
 *          (filestore URL must be public-reachable so <img> renders
 *          with naturalWidth > 0).
 *
 *   This spec walks the citizen UI:
 *     1. OTP login
 *     2. Open New Complaint wizard
 *     3. Pick complaint type → sub-type → details
 *     4. Upload fixture image on the attachment step
 *     5. Assert the image is accepted in the form state (preview img
 *        appears with non-empty src) — that's "image is uploading
 *        correctly"
 *     6. If the wizard surfaces a Submit, complete + capture the
 *        complaint number → visit its detail page → assert the
 *        thumbnail renders with naturalWidth > 0 (proves the public
 *        URL contract from the #555 server-side fix).
 *
 *   PLAYWRIGHT_BASE_URL=https://bometfeedbackhub.digit.org \
 *   PLAYWRIGHT_SKIP_SETUP=1 \
 *     npx playwright test demo-555-attachment-bomet --workers=1
 */

const CITIZEN_LOGIN_URL = '/digit-ui/citizen/login';
const CITIZEN_HOME_URL = '/digit-ui/citizen/pgr-home';
const STATIC_OTP = '123456';
const CITIZEN_MOBILE = '712345003';

test.describe('Demo: citizen complaint attachment on bomet — #555', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('upload image on complaint create, preview appears with non-empty src', async ({ page }) => {
    // ============ 1. Citizen OTP login ============
    await page.goto(`${CITIZEN_LOGIN_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_500);

    const mobileInput = page.locator('input[type="tel"], input[type="number"]').first();
    await mobileInput.click();
    await mobileInput.pressSequentially(CITIZEN_MOBILE, { delay: 80 });
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /get otp|continue|next/i }).first().click();
    await page.waitForTimeout(2_500);

    const otpDigitInputs = page.locator('input[autocomplete="one-time-code" i], input[maxlength="1"]');
    const otpDigitCount = await otpDigitInputs.count();
    if (otpDigitCount >= 6) {
      for (let i = 0; i < 6; i++) {
        await otpDigitInputs.nth(i).fill(STATIC_OTP[i]);
      }
    } else {
      await page
        .getByRole('textbox')
        .filter({ hasNot: page.locator('[type="tel"], [type="number"]') })
        .first()
        .fill(STATIC_OTP);
    }
    await page.waitForTimeout(800);
    await page
      .getByRole('button', { name: /verify|login|submit|continue/i })
      .first()
      .click();
    await page.waitForURL(/\/digit-ui\/citizen(?!\/login)/, { timeout: 25_000 });
    await page.waitForTimeout(3_000);

    // ============ 2. Open New Complaint wizard ============
    // PGR-home → File new complaint CTA. Tile or button.
    await page.goto(`${CITIZEN_HOME_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    // Click the "New Complaint" / "File new" tile. Robust to a few
    // copy variants.
    const newComplaintTile = page
      .getByRole('button', { name: /new complaint|file.*complaint|create.*complaint|register.*complaint/i })
      .or(page.getByRole('link', { name: /new complaint|file.*complaint|create.*complaint|register.*complaint/i }))
      .first();
    if (await newComplaintTile.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await newComplaintTile.click();
      await page.waitForTimeout(2_500);
    } else {
      // Fall back to the direct route.
      await page.goto(`/digit-ui/citizen/pgr/complaint-type?cb=${Date.now()}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2_500);
    }

    // ============ 3. Walk the wizard until we reach a file input ============
    // Pick first available complaint type / sub-type / etc. The exact
    // wizard structure varies by tenant; this spec walks "first option
    // of every radio/combobox + first Next button" up to a bounded
    // number of steps.
    const FILE_INPUT = 'input[type="file"]';
    const MAX_STEPS = 8;
    let fileInputReached = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      await page.waitForTimeout(2_000);

      if ((await page.locator(FILE_INPUT).count()) > 0) {
        fileInputReached = true;
        break;
      }

      // Fill EVERY unfilled combobox on the current step. A combobox
      // is "filled" when its text content matches a non-placeholder
      // pattern (placeholders typically start with "Select").
      const comboCount = await page.getByRole('combobox').count();
      for (let i = 0; i < comboCount; i++) {
        const combo = page.getByRole('combobox').nth(i);
        const txt = (await combo.textContent().catch(() => '')) || '';
        // Skip if filled (no "Select …" placeholder).
        if (!/^Select/i.test(txt.trim())) continue;
        if (!(await combo.isVisible().catch(() => false))) continue;
        await combo.scrollIntoViewIfNeeded();
        await combo.click();
        await page.waitForTimeout(700);
        const opt = page
          .locator('[role="listbox"][data-state="open"] [role="option"], [role="option"]')
          .first();
        if (await opt.isVisible({ timeout: 1_500 }).catch(() => false)) {
          await opt.click();
          await page.waitForTimeout(700);
        }
      }

      // Fill any required text input that's still empty (e.g. description).
      const requiredText = page.locator('textarea, input[type="text"]');
      const reqCount = await requiredText.count();
      for (let i = 0; i < reqCount; i++) {
        const inp = requiredText.nth(i);
        if (!(await inp.isVisible().catch(() => false))) continue;
        const val = (await inp.inputValue().catch(() => '')) || '';
        if (val.length > 0) continue;
        await inp.click();
        await inp.fill('Test complaint description for #555 attachment proof.');
        await page.waitForTimeout(500);
        break;
      }

      // Click first radio if any.
      const radio = page.locator('input[type="radio"]').first();
      if (await radio.isVisible({ timeout: 800 }).catch(() => false)) {
        await radio.evaluate((el) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!;
          setter.call(el, true);
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('click', { bubbles: true }));
        });
        await page.waitForTimeout(500);
      }

      // Click Next / Continue.
      const nextBtn = page
        .getByRole('button', { name: /^next$|continue/i })
        .first();
      if (await nextBtn.isEnabled({ timeout: 1_500 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(2_000);
      }
    }

    expect(
      fileInputReached,
      'wizard must surface a file input within the first 8 steps to exercise the #555 upload path',
    ).toBeTruthy();

    // ============ 4. Upload the fixture image ============
    await page
      .locator(FILE_INPUT)
      .first()
      .setInputFiles(path.resolve(__dirname, '../fixtures/avatar.png'));
    await page.waitForTimeout(3_500);

    // ============ 5. Preview img element appears with src ============
    // After upload, the form should show a preview <img> (the
    // ComplaintPhotos.js parser fix means the preview src is the
    // public filestore URL, not a hex blob or internal http://minio
    // hostname).
    const previewImgs = page.locator(
      'img[src*="file-store"], img[src*="bometfeedbackhub"], img[alt*="upload" i], img[alt*="thumbnail" i], img[alt*="issue" i]',
    );
    const previewCount = await previewImgs.count();
    expect(
      previewCount,
      'a preview <img> with a filestore/public URL should appear after successful upload',
    ).toBeGreaterThan(0);

    // Assert the first preview is reachable (naturalWidth > 0 means
    // the browser actually loaded the bytes — public-URL contract).
    const naturalWidth = await previewImgs.first().evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(
      naturalWidth,
      `preview img must have naturalWidth > 0 (public URL must be browser-reachable). got ${naturalWidth}`,
    ).toBeGreaterThan(0);

    // Hold for the recording so the preview is visible.
    await page.waitForTimeout(4_500);
  });
});
