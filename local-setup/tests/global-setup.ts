import { chromium } from '@playwright/test';

/**
 * Global setup hook for Playwright tests.
 *
 * This waits for localization seed and cache flush to complete before
 * any tests run. The localization-seed and localization-cache-bust
 * containers are one-shot jobs that complete independently after Kong
 * starts. Without this check, tests can race these containers and fail
 * due to missing localization data.
 */
export default async function globalSetup() {
  const baseURL = process.env.BASE_URL || 'http://127.0.0.1:18000';
  const tenantId = 'pg';
  const locale = 'en_IN';
  const maxRetries = 90;
  const retryDelay = 2000; // 2 seconds

  console.log('[Global Setup] Waiting for localization seed to complete...');

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  let success = false;
  let lastError: string = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // locale, tenantId, and module must be query parameters (not body fields)
      const searchURL = `${baseURL}/localization/messages/v1/_search?locale=${locale}&tenantId=${tenantId}&module=rainmaker-common`;
      const response = await page.request.post(searchURL, {
        headers: { 'Content-Type': 'application/json' },
        data: {
          RequestInfo: {
            apiId: 'global-setup',
            ver: '1.0',
            ts: Date.now(),
            action: '_search',
            msgId: `${Date.now()}-setup`,
            authToken: '',
          },
        },
        timeout: 10000,
      });

      if (response.ok()) {
        const body = await response.json();
        const messages = body?.messages ?? [];
        const messageCount = messages.length;

        // Check for specific seeded keys to ensure localization is fully ready
        const requiredKeys = [
          'CS_COMMON_SUBMIT',
        ];
        const messageMap = new Map(
          messages.map((msg: any) => [msg.code, msg.message])
        );
        const missingKeys = requiredKeys.filter(key => !messageMap.has(key));

        if (messageCount > 0 && missingKeys.length === 0) {
          console.log(
            `[Global Setup] Localization data available (${messageCount} messages for ${tenantId}/${locale}, all required keys present)`
          );
          success = true;
          break;
        } else if (messageCount === 0) {
          lastError = `Received empty messages array (attempt ${attempt}/${maxRetries})`;
          console.log(`[Global Setup] ${lastError}`);
        } else {
          lastError = `Missing required keys: ${missingKeys.join(', ')} (attempt ${attempt}/${maxRetries})`;
          console.log(`[Global Setup] ${lastError}`);
        }
      } else {
        lastError = `HTTP ${response.status()} (attempt ${attempt}/${maxRetries})`;
        console.log(`[Global Setup] Localization API returned ${lastError}`);
      }
    } catch (error) {
      lastError = `${error} (attempt ${attempt}/${maxRetries})`;
      console.log(`[Global Setup] Failed to call localization API: ${lastError}`);
    }

    if (attempt < maxRetries) {
      await page.waitForTimeout(retryDelay);
    }
  }

  await context.close();
  await browser.close();

  if (!success) {
    throw new Error(
      `[Global Setup] Localization seed did not complete within ${(maxRetries * retryDelay) / 1000}s. ` +
      `Last error: ${lastError}. ` +
      `Ensure docker compose up -d has finished and localization-seed + localization-cache-bust containers completed successfully.`
    );
  }

  console.log('[Global Setup] Complete — localization data ready for tests.');
}
