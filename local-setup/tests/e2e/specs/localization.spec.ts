import { test, expect } from '@playwright/test';
import { loginViaApi } from '../utils/auth';
import { requiredEnv } from '../utils/identity';

const BASE_URL = requiredEnv('BASE_URL');
const TENANT = requiredEnv('DIGIT_TENANT');
const ADMIN_USER = requiredEnv('DIGIT_USERNAME');
const ADMIN_PASS = requiredEnv('DIGIT_PASSWORD');

test.describe('Employee app localization', () => {
  test('requests en_IN messages and renders the home without raw keys', async ({ page }) => {
    const localizationRequests: { url: string; response: any }[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/localization/messages/v1/_search')) {
        try {
          localizationRequests.push({ url, response: await response.json() });
        } catch {
          // ignore non-JSON responses
        }
      }
    });

    // Sign-in is hosted by Keycloak now; the SPA fetches its messages as the
    // employee home boots.
    await loginViaApi(page, { baseURL: BASE_URL, tenant: TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    await page.waitForTimeout(3_000);

    // 1. At least one localization API call was made
    expect(
      localizationRequests.length,
      'Expected at least one localization API call — the DIGIT UI should fetch translations on page load',
    ).toBeGreaterThan(0);

    // 2. CRITICAL: The locale parameter must be "en_IN", NOT "en_IN_IN".
    //    When globalConfigs.localeDefault is wrongly set to "en_IN",
    //    the UI constructs "en_IN" + "_" + "IN" = "en_IN_IN" which has no data.
    const allUrls = localizationRequests.map((r) => r.url);
    expect(
      allUrls.some((u) => u.includes('locale=en_IN_IN')),
      'Detected locale=en_IN_IN — globalConfigs.localeDefault is likely "en_IN" instead of "en"',
    ).toBe(false);
    expect(allUrls.some((u) => /locale=en_IN(?!_)/.test(u)), 'Expected locale=en_IN in localization requests').toBe(true);

    // 3. The workspace has messages for the locale it boots in.
    const totalMessages = localizationRequests.reduce((sum, r) => sum + (r.response?.messages?.length ?? 0), 0);
    test.info().annotations.push({ type: 'localization-messages', description: `Total messages received: ${totalMessages}` });
    expect.soft(totalMessages, `Localization API returned no messages for ${TENANT}`).toBeGreaterThan(0);

    // 4. Navigation and home cards show translations, not raw keys.
    const bodyText = await page.locator('body').innerText();
    for (const rawKey of [
      'CORE_COMMON_HOME',
      'ACTION_TEST_COMPLAINTS',
      'CS_HEADER_COMPLAINT',
      'CS_HOME_HEADER',
      'ACTION_TEST_SEARCH_COMPLAINT',
      'CORE_COMMON_LOGOUT',
    ]) {
      expect.soft(bodyText, `Raw key "${rawKey}" visible on the employee home`).not.toContain(rawKey);
    }

    // Uppercase-underscore runs that look like untranslated keys. A threshold
    // of 5 catches regressions while allowing for edge cases.
    const localizationKeyLike = (bodyText.match(/\b[A-Z][A-Z0-9_]{7,}\b/g) || []).filter((k) => k.includes('_'));
    test.info().annotations.push({
      type: 'raw-keys-found',
      description: `Potential raw keys on the employee home: ${localizationKeyLike.length} (${localizationKeyLike.slice(0, 10).join(', ')})`,
    });
    expect.soft(localizationKeyLike.length, `Found ${localizationKeyLike.length} potential raw localization keys`).toBeLessThan(5);
  });
});
