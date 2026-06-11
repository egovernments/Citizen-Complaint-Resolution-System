/**
 * Citizen complaint-type localization regression (ethiopia, 2026-06-11).
 *
 * Repro: complaint type cards/dropdowns on the citizen create-complaint
 * flow rendered raw localization keys (SERVICEDEFS.DRAINS, …) instead of
 * display names, even on a fresh profile — i.e. not a browser-cache
 * problem but a locale/module mismatch between what the SPA requests
 * and what the localization service holds for the tenant.
 *
 * The test logs in as a citizen via OTP (fixed dev OTP), walks to the
 * complaint-type step, and fails if any visible text still looks like a
 * SERVICEDEFS key. Every /localization/messages/v1/_search request the
 * SPA makes is captured and printed on failure so the offending
 * locale/module/tenant combination is visible in the report.
 */
import { test, expect, type Page } from '@playwright/test';

const CITIZEN_MOBILE = process.env.CITIZEN_MOBILE || '777777777';
const CITIZEN_OTP = process.env.CITIZEN_OTP || '123456';

type LocFetch = { url: string; messageCount: number; servicedefsDotCount: number };

function captureLocalizationTraffic(page: Page, sink: LocFetch[]) {
  page.on('response', async (resp) => {
    if (!resp.url().includes('/localization/messages/v1/_search')) return;
    let messageCount = -1;
    let servicedefsDotCount = -1;
    try {
      const body = await resp.json();
      const msgs = Array.isArray(body?.messages) ? body.messages : [];
      messageCount = msgs.length;
      servicedefsDotCount = msgs.filter((m: any) =>
        String(m?.code || '').startsWith('SERVICEDEFS.')
      ).length;
    } catch {
      /* non-JSON or aborted */
    }
    sink.push({ url: resp.url(), messageCount, servicedefsDotCount });
  });
}

async function citizenOtpLogin(page: Page) {
  await page.goto('/digit-ui/citizen');

  // Language selection screen (first visit only) — continue past it.
  const continueBtn = page
    .locator('button:has-text("Continue"), button:has-text("CONTINUE")')
    .first();
  if (await continueBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await continueBtn.click();
  }

  // The citizen home renders without auth; go straight to the login
  // route (the nav's Login button doesn't navigate reliably headless).
  await page.goto('/digit-ui/citizen/login');

  // Mobile number screen: single tel input.
  const mobileInput = page.locator('input[type="tel"]').first();
  await mobileInput.waitFor({ state: 'visible', timeout: 30_000 });
  await mobileInput.click();
  await mobileInput.fill(CITIZEN_MOBILE);
  await expect(mobileInput).toHaveValue(CITIZEN_MOBILE);
  await page
    .locator('button[type="submit"], button:has-text("Continue")')
    .first()
    .click();

  // OTP screen: 6 single-char boxes with auto-advance; typing into the
  // first box and letting auto-advance route the rest is how a citizen
  // does it, so do the same.
  const otpBoxes = page.locator('input[maxlength="1"]');
  await otpBoxes.first().waitFor({ state: 'visible', timeout: 30_000 }).catch(async () => {
    throw new Error(
      `OTP boxes never appeared after submitting mobile. URL=${page.url()} BODY=${(
        await page.locator('body').innerText()
      ).slice(0, 500)}`
    );
  });
  await otpBoxes.first().click();
  await page.keyboard.type(CITIZEN_OTP, { delay: 80 });
  const otpSubmit = page.locator('button[type="submit"], button:has-text("Continue")').first();
  if (await otpSubmit.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await otpSubmit.click().catch(() => {/* may have auto-submitted */});
  }

  // Genuinely logged in = we leave every /login route.
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
}

test.describe('Citizen complaint-type localization', () => {
  test.slow();

  test('complaint type step shows display names, not SERVICEDEFS keys', async ({ page }) => {
    const locFetches: LocFetch[] = [];
    captureLocalizationTraffic(page, locFetches);

    await citizenOtpLogin(page);

    await page.goto('/digit-ui/citizen/pgr/create-complaint/complaint-type');

    // The complaint types live behind a combobox; options only enter the
    // DOM once it is opened.
    const typeCombo = page.getByRole('combobox', { name: /complaint type/i }).first();
    await typeCombo.waitFor({ state: 'visible', timeout: 30_000 });
    await typeCombo.click();

    // Options render after the ServiceDefs fetch resolves.
    const options = page.getByRole('option');
    await expect.poll(async () => options.count(), { timeout: 20_000 }).toBeGreaterThan(4);

    const optionLabels = await options.allInnerTexts();
    console.log('COMPLAINT TYPE OPTIONS:', optionLabels);

    const bodyText = (await page.locator('body').innerText()) + '\n' + optionLabels.join('\n');
    const rawKeys = [...new Set(bodyText.match(/SERVICEDEFS[._][A-Z0-9._]+/g) || [])];

    if (rawKeys.length > 0) {
      console.log('RAW KEYS VISIBLE:', rawKeys.slice(0, 10));
      console.log('LOCALIZATION FETCHES:');
      for (const f of locFetches) {
        console.log(
          `  msgs=${f.messageCount} servicedefs.=${f.servicedefsDotCount} ${f.url}`
        );
      }
    }

    expect(rawKeys, `raw localization keys visible: ${rawKeys.join(', ')}`).toHaveLength(0);

    // Positive check: real complaint-type group labels are in the open
    // dropdown, so an empty/broken list can't pass by accident.
    expect(bodyText).toMatch(/Garbage|Drains|Street\s?Lights|Water and Sewage/i);
  });
});
