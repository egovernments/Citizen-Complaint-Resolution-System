/**
 * Citizen complaint-type localization regression (ethiopia, 2026-06-11).
 *
 * Repro: complaint type cards/dropdowns on the citizen create-complaint
 * flow rendered raw localization keys (then SERVICEDEFS.DRAINS, now COMPLAINT_HIERARCHY.*) instead of
 * display names, even on a fresh profile — i.e. not a browser-cache
 * problem but a locale/module mismatch between what the SPA requests
 * and what the localization service holds for the tenant.
 *
 * The test signs in as a citizen (phone OTP via the BFF), walks to the
 * complaint-type step, and fails if any visible text still looks like a
 * COMPLAINT_HIERARCHY key. Every /localization/messages/v1/_search request the
 * SPA makes is captured and printed on failure so the offending
 * locale/module/tenant combination is visible in the report.
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenLoginViaApi } from '../../utils/citizen-auth';
import { appBase } from '../../utils/auth';

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
        String(m?.code || '').startsWith('COMPLAINT_HIERARCHY.')
      ).length;
    } catch {
      /* non-JSON or aborted */
    }
    sink.push({ url: resp.url(), messageCount, servicedefsDotCount });
  });
}

test.describe('Citizen complaint-type localization', () => {
  test.slow();

  test('complaint type step shows display names, not COMPLAINT_HIERARCHY keys', async ({ page }) => {
    const locFetches: LocFetch[] = [];
    captureLocalizationTraffic(page, locFetches);

    await citizenLoginViaApi(page);

    await page.goto(`${appBase()}/citizen/pgr/create-complaint/complaint-type`);

    // The top complaint-type level (#lvl-0) is a combobox; options only enter
    // the DOM once it is opened.
    const typeCombo = page.locator('#lvl-0');
    await typeCombo.waitFor({ state: 'visible', timeout: 30_000 });
    await typeCombo.click();

    // Options render after the ComplaintHierarchy fetch resolves; an empty
    // list fails here rather than passing the raw-key check below.
    const options = page.getByRole('option');
    await expect.poll(async () => options.count(), { timeout: 20_000 }).toBeGreaterThan(0);

    const optionLabels = await options.allInnerTexts();
    console.log('COMPLAINT TYPE OPTIONS:', optionLabels);

    const bodyText = (await page.locator('body').innerText()) + '\n' + optionLabels.join('\n');
    const rawKeys = [...new Set(bodyText.match(/COMPLAINT_HIERARCHY\.[A-Z0-9._]+/g) || [])];

    if (rawKeys.length > 0) {
      console.log('RAW KEYS VISIBLE:', rawKeys.slice(0, 10));
      console.log('LOCALIZATION FETCHES:');
      for (const f of locFetches) {
        console.log(
          `  msgs=${f.messageCount} complaint_hierarchy.=${f.servicedefsDotCount} ${f.url}`
        );
      }
    }

    expect(rawKeys, `raw localization keys visible: ${rawKeys.join(', ')}`).toHaveLength(0);
  });
});
