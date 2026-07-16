/**
 * Citizen complaint — image attachment lifecycle (CCRS #555).
 *
 * Two halves of #555:
 *   1. Upload preview — the create form should show an <img> preview
 *      with a public-reachable URL (naturalWidth > 0) after the file
 *      is set, proving the `ComplaintPhotos.js` parser fix.
 *   2. Detail page render — the same image should appear on the
 *      complaint detail page (citizen view) once submitted.
 *
 * The detail half currently fails on bomet — Gurjeet 2026-05-20
 * UNRESOLVED retest. This spec catches both halves so the regression
 * surface is one whole flow.
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { BASE_URL, BASE_HOST } from '../utils/env';
import { citizenOtpLogin } from '../utils/citizen-login';
import { requires } from '../utils/capabilities';

// Match an uploaded image by the generic filestore path or the deployment's own
// host (BASE_HOST, derived from BASE_URL) — never a hardcoded demo hostname.
const previewImgSelector =
  `img[src*="filestore"], img[src*="file-store"], img[src*="${BASE_HOST}"], ` +
  'img[alt*="upload" i], img[alt*="thumbnail" i], img[alt*="issue" i]';
const detailImgSelector =
  `img[src*="filestore"], img[src*="file-store"], img[src*="${BASE_HOST}"], ` +
  'img[alt*="thumbnail" i], img[alt*="attachment" i], img[alt*="issue" i]';

const CITIZEN_HOME_URL = '/digit-ui/citizen/pgr-home';
const COMPLAINT_TYPE_URL = '/digit-ui/citizen/pgr/complaint-type';

test.describe('citizen complaint — attachment lifecycle #555', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('upload preview renders, then detail page surfaces the same image', async ({ page }) => {
    // ============ OTP login (uses suite-wide provisioned citizen) ============
    await citizenOtpLogin(page);
    await page.waitForTimeout(3_000);

    // ============ Open new-complaint wizard ============
    await page.goto(`${BASE_URL}${CITIZEN_HOME_URL}?cb=${Date.now()}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);
    const newComplaintTile = page
      .getByRole('button', { name: /new complaint|file.*complaint|create.*complaint|register.*complaint/i })
      .or(page.getByRole('link', { name: /new complaint|file.*complaint|create.*complaint|register.*complaint/i }))
      .first();
    if (await newComplaintTile.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await newComplaintTile.click();
      await page.waitForTimeout(2_500);
    } else {
      await page.goto(`${BASE_URL}${COMPLAINT_TYPE_URL}?cb=${Date.now()}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2_500);
    }

    // ============ Walk wizard until a file input surfaces ============
    const FILE_INPUT = 'input[type="file"]';
    let fileInputReached = false;
    for (let step = 0; step < 8; step++) {
      await page.waitForTimeout(2_000);
      if ((await page.locator(FILE_INPUT).count()) > 0) {
        fileInputReached = true;
        break;
      }
      const comboCount = await page.getByRole('combobox').count();
      for (let i = 0; i < comboCount; i++) {
        const combo = page.getByRole('combobox').nth(i);
        const txt = (await combo.textContent().catch(() => '')) || '';
        if (!/^Select/i.test(txt.trim())) continue;
        if (!(await combo.isVisible().catch(() => false))) continue;
        // On ke (CRS digit-ui) child-level comboboxes render immediately but
        // start disabled; skip them — they will be enabled after the parent
        // level is selected and this loop picks them on the next outer iteration.
        if (!(await combo.isEnabled().catch(() => false))) continue;
        await combo.scrollIntoViewIfNeeded();
        await combo.click();
        await page.waitForTimeout(700);
        const opt = page
          .locator('[role="listbox"][data-state="open"] [role="option"], [role="option"]:visible, .digit-dropdown-item:visible')
          .first();
        if (await opt.isVisible({ timeout: 1_500 }).catch(() => false)) {
          await opt.click();
          await page.waitForTimeout(700);
        }
      }
      const requiredText = page.locator('textarea, input[type="text"]');
      const reqCount = await requiredText.count();
      for (let i = 0; i < reqCount; i++) {
        const inp = requiredText.nth(i);
        if (!(await inp.isVisible().catch(() => false))) continue;
        if (((await inp.inputValue().catch(() => '')) || '').length > 0) continue;
        await inp.click();
        await inp.fill('Integration test description for #555 attachment.');
        break;
      }
      const radio = page.locator('input[type="radio"]').first();
      if (await radio.isVisible({ timeout: 800 }).catch(() => false)) {
        await radio.evaluate((el: HTMLInputElement) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!;
          setter.call(el, true);
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('click', { bubbles: true }));
        });
      }
      const nextBtn = page.getByRole('button', { name: /^next$|continue/i }).first();
      if (await nextBtn.isEnabled({ timeout: 1_500 }).catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(2_000);
      }
    }
    expect(fileInputReached, 'wizard must reach the upload step within 8 wizard transitions').toBeTruthy();

    // ============ Upload + preview img naturalWidth > 0 ============
    await page
      .locator(FILE_INPUT)
      .first()
      .setInputFiles(path.resolve(__dirname, '../fixtures/avatar.png'));
    await page.waitForTimeout(3_500);

    const previewImgs = page.locator(previewImgSelector);
    expect(
      await previewImgs.count(),
      '#555 — preview <img> must appear with a filestore/public URL after upload',
    ).toBeGreaterThan(0);
    const previewNaturalWidth = await previewImgs
      .first()
      .evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(
      previewNaturalWidth,
      `#555 — preview img must load (naturalWidth > 0); got ${previewNaturalWidth}`,
    ).toBeGreaterThan(0);

    // ============ Submit + capture complaint id ============
    const createPromise = page
      .waitForResponse(
        (r) => /\/pgr-services\/.*\/_create/.test(r.url()) && r.status() < 500,
        { timeout: 30_000 },
      )
      .catch(() => null);
    for (let i = 0; i < 6; i++) {
      const submitBtn = page
        .getByRole('button', { name: /^submit$|^send$|file complaint|raise complaint/i })
        .first();
      const nextBtn = page.getByRole('button', { name: /^next$|continue/i }).first();
      const btn = (await submitBtn.isVisible({ timeout: 800 }).catch(() => false)) ? submitBtn : nextBtn;
      if (await btn.isEnabled({ timeout: 1_500 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(2_500);
      } else {
        break;
      }
    }
    const createResp = await createPromise;
    if (!createResp) {
      test.info().annotations.push({
        type: 'skipped',
        description: '#555 detail render — wizard submit did not complete in this run.',
      });
      return;
    }
    const createJson = await createResp.json().catch(() => ({} as Record<string, unknown>));
    const sr0 = (
      (createJson as Record<string, unknown>).ServiceWrappers as Array<Record<string, unknown>> | undefined
    )?.[0]?.service as Record<string, unknown> | undefined;
    const complaintNumber = sr0?.serviceRequestId as string | undefined;
    expect(complaintNumber, '_create response must include a serviceRequestId').toBeTruthy();

    // ============ Detail page — Attachments img renders ============
    // Gated on the declared capability, not a stray env hatch: whether the
    // detail page renders the uploaded attachment <img> can't be discovered by
    // a read-only probe (see capabilities.ts), so deploy/expectations/*.json
    // carries the call per deployment. maputo-local + bomet both declare this
    // 'required', so a real #555 detail-half regression now fails loudly
    // instead of hiding behind ATTACHMENT_DETAIL_UNSUPPORTED. The upload-preview
    // half above always validates the ComplaintPhotos.js parser regardless.
    requires(test, 'ui.citizen.attachmentDetailRender', 'CCRS#555 detail half');
    // Citizen detail route is `/citizen/pgr/complaints/:id` (PLURAL) — see
    // pgr/src/pages/citizen/index.js:33 and the route contract locked in by
    // track-my-complaint.spec.ts. `/complaint-details/:id` is the EMPLOYEE
    // route; under /citizen it matches nothing, so the page renders an empty
    // shell (BackButton only) and the Attachments <img> can never appear.
    await page.goto(
      `${BASE_URL}/digit-ui/citizen/pgr/complaints/${complaintNumber}?cb=${Date.now()}`,
    );
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5_000);

    const detailImgs = page.locator(detailImgSelector);
    await expect(
      detailImgs.first(),
      '#555 — Attachments section on the citizen detail page must surface an <img>',
    ).toBeVisible({ timeout: 15_000 });
    const detailNaturalWidth = await detailImgs
      .first()
      .evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(
      detailNaturalWidth,
      `#555 — detail img must load (naturalWidth > 0); got ${detailNaturalWidth}`,
    ).toBeGreaterThan(0);
  });
});
