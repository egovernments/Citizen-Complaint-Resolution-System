/**
 * Citizen full complaint-submit regression (ethiopia, 2026-06-11).
 *
 * Repro: the create-complaint wizard completed every step but the final
 * SUBMIT was vetoed with "Sorry we are not providing service in this
 * city" (CS_COMMON_PINCODE_NOT_SERVICABLE). Two stacked causes: the
 * default-data-handler template seeded pg's Indian pincode allowlist
 * (143001–143005) onto the new tenant, and the client-side gate only
 * honored the map-resolved ward — never the manually selected one,
 * which is the only kind a tenant without boundary polygons can produce.
 *
 * The test drives the whole wizard as a citizen — complaint type,
 * map-pin confirm, Region→Ward cascade PLUS a typed postal code (the
 * exact input that used to trip the false veto) — through SUBMIT, and
 * asserts the response page confirms submission. One real complaint is
 * created per run, consistent with the other lifecycle suites.
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenOtpLogin } from '../../utils/citizen-auth';

// Addis Ababa central postal code; deliberately NOT in any allowlist a
// stale bootstrap could have copied.
const POSTAL_CODE = process.env.CITIZEN_POSTAL_CODE || '1000';

async function pickFirstOption(page: Page, combo: ReturnType<Page['locator']>) {
  await combo.click();
  const options = page.getByRole('option');
  await expect.poll(async () => options.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  const label = (await options.first().innerText()).trim();
  await options.first().click();
  return label;
}

test.describe('Citizen complaint submit', () => {
  test.slow();

  test('full wizard with typed postal code submits successfully', async ({ page }) => {
    // Pin the map's reverse-geocode to an answer WITHOUT a postcode.
    // When Nominatim returns one, the postal field is map-filled and
    // read-only, formData.postalCode stays unset, and the allowlist
    // gate is bypassed — i.e. the typed-postal path under test never
    // runs. Stubbing keeps that branch deterministic (and the run
    // independent of OSM availability/rate limits).
    await page.route('**nominatim.openstreetmap.org/reverse*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          display_name: 'Meskel Square, Addis Ababa, Ethiopia',
          address: { city: 'Addis Ababa', country: 'Ethiopia' },
        }),
      })
    );

    await citizenOtpLogin(page);
    await page.goto('/digit-ui/citizen/pgr/create-complaint/complaint-type');

    const nextBtn = page.getByRole('button', { name: /^next$/i });

    // ── Step 0: complaint type (+ subtype when the type has any) ──
    const typeCombo = page.getByRole('combobox', { name: /complaint type/i }).first();
    await typeCombo.waitFor({ state: 'visible', timeout: 30_000 });
    const typeLabel = await pickFirstOption(page, typeCombo);
    console.log('COMPLAINT TYPE:', typeLabel);

    const subCombo = page.getByRole('combobox', { name: /sub\s?-?\s?type/i }).first();
    if (await subCombo.isVisible({ timeout: 3_000 }).catch(() => false)) {
      console.log('SUBTYPE:', await pickFirstOption(page, subCombo));
    }
    await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
    await nextBtn.click();

    // ── Step 1: map pin — auto-seeded from MAP_CENTER, just confirm ──
    await expect(nextBtn).toBeEnabled({ timeout: 30_000 });
    await nextBtn.click();

    // ── Step 2: location — Region → Ward cascade + typed postal code ──
    // No boundary polygons on this tenant, so the map never auto-fills
    // the cascade; the citizen picks manually. This manual selection is
    // exactly what must supersede the pincode allowlist at submit.
    const regionCombo = page.locator('#boundary-regions');
    await regionCombo.waitFor({ state: 'visible', timeout: 30_000 });
    console.log('REGION:', await pickFirstOption(page, regionCombo));

    const wardCombo = page.locator('#boundary-ward');
    await wardCombo.waitFor({ state: 'visible', timeout: 15_000 });
    console.log('WARD:', await pickFirstOption(page, wardCombo));

    const postal = page.locator('#postal-code');
    await expect(postal).toBeEnabled();
    await postal.click();
    // Type key-by-key — the field once disabled itself after the first
    // keystroke (fixed in d3caecb1), which fill() would mask.
    await page.keyboard.type(POSTAL_CODE, { delay: 60 });
    await expect(postal).toHaveValue(POSTAL_CODE);

    await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
    await nextBtn.click();

    // ── Step 3: description ──
    const description = page.locator('#complaint-description');
    await description.waitFor({ state: 'visible', timeout: 15_000 });
    await description.fill(
      `e2e submit regression — typed postal ${POSTAL_CODE}, manual ward selection`
    );
    await expect(nextBtn).toBeEnabled({ timeout: 10_000 });
    await nextBtn.click();

    // ── Step 4: photos (optional) → SUBMIT ──
    const submitBtn = page.getByRole('button', { name: /^submit$/i });
    await expect(submitBtn).toBeEnabled({ timeout: 15_000 });
    await submitBtn.click();

    // The old bug surfaced here: an inline serviceability veto instead
    // of navigation. Assert the veto never shows AND we land on the
    // response page with a success headline + complaint reference.
    await page.waitForURL((url) => url.pathname.includes('/pgr/response'), { timeout: 30_000 });
    const bodyText = await page.locator('body').innerText();

    expect(bodyText).not.toMatch(/not providing service|NOT_SERVICABLE/i);
    expect(bodyText).toMatch(/complaint submitted|CS_COMMON_COMPLAINT_SUBMITTED/i);
    expect(bodyText).not.toMatch(/couldn't be submitted|NOT_SUBMITTED/i);

    // Complaint reference chip (serviceRequestId, e.g. PGR-2026-06-11-001234).
    const refMatch = bodyText.match(/PGR[-/][A-Z0-9-/]+/i);
    expect(refMatch, `no complaint reference visible on response page:\n${bodyText.slice(0, 600)}`).toBeTruthy();
    console.log('COMPLAINT REFERENCE:', refMatch?.[0]);
  });
});
