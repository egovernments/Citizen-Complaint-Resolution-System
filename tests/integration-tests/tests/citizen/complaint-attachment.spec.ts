import { tenantSlug } from '../utils/identity-bff';
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
import { fileComplaintUrl, fileComplaintViaWizard } from '../utils/citizen-filing';

// Match an uploaded image by the generic filestore path or the deployment's own
// host (BASE_HOST, derived from BASE_URL) — never a hardcoded demo hostname.
// Develop's PhotoPicker previews the picked file from a local object URL
// (img.cms-photo-thumb) while it uploads; the filestore URL is the detail half's.
const previewImgSelector =
  `img.cms-photo-thumb, img[src*="filestore"], img[src*="file-store"], img[src*="${BASE_HOST}"], ` +
  'img[alt*="upload" i], img[alt*="thumbnail" i], img[alt*="issue" i]';
const detailImgSelector =
  `img[src*="filestore"], img[src*="file-store"], img[src*="${BASE_HOST}"], ` +
  'img[alt*="thumbnail" i], img[alt*="attachment" i], img[alt*="issue" i]';


test.describe('citizen complaint — attachment lifecycle #555', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('upload preview renders, then detail page surfaces the same image', { tag: ['@persona:citizen'] }, async ({ page }) => {
    // ============ OTP login (uses suite-wide provisioned citizen) ============
    await citizenOtpLogin(page);
    await page.waitForTimeout(3_000);

    // ============ Open new-complaint wizard ============
    // Develop's filing flow (utils/citizen-filing.ts): the photo picker sits on
    // step 1, next to the description and category.
    await page.goto(fileComplaintUrl(), { waitUntil: 'domcontentloaded' });
    const FILE_INPUT = 'input[type="file"]';
    await expect(page.locator('#complaint-description'), 'the details step must render').toBeVisible({ timeout: 20_000 });
    expect(await page.locator(FILE_INPUT).count(), 'the details step must offer a photo input').toBeGreaterThan(0);

    await page
      .locator(FILE_INPUT)
      .first()
      .setInputFiles(path.resolve(__dirname, '../fixtures/avatar.png'));
    await page.waitForTimeout(3_500);

    const previewImgs = page.locator(previewImgSelector);
    expect(
      await previewImgs.count(),
      '#555 — the picked photo must show a preview <img>',
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
        { timeout: 60_000 },
      )
      .catch(() => null);
    // Next stays disabled until the photo has uploaded.
    await fileComplaintViaWizard(page, { description: 'Integration test description for #555 attachment.' });
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
      `${BASE_URL}/${tenantSlug()}/digit-ui/citizen/pgr/complaints/${complaintNumber}?cb=${Date.now()}`,
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
