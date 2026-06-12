/**
 * Citizen entry flow — anonymous home + login route.
 *
 * Covers the two surfaces every citizen sees BEFORE auth: the V2 home
 * (All Services + language switcher in header) and the login route
 * (mobile-number form, plus a tenant/city picker on multi-tenant
 * deployments). Each surface is checked for (a) the legacy structural
 * assertions and (b) no raw localization keys leaking — the same
 * regression class as the complaint-type spec, applied to the pre-auth
 * screens. The login route additionally fails if a rendered tenant
 * picker is empty (population fetch returned nothing or hit the wrong
 * module).
 */
import { test, expect, type Page } from '@playwright/test';

type LocFetch = { url: string; messageCount: number };

function captureLoc(page: Page, sink: LocFetch[]) {
  page.on('response', async (resp) => {
    if (!resp.url().includes('/localization/messages/v1/_search')) return;
    try {
      const body = await resp.json();
      const msgs = Array.isArray(body?.messages) ? body.messages : [];
      sink.push({ url: resp.url(), messageCount: msgs.length });
    } catch {
      /* aborted/non-JSON */
    }
  });
}

// Uppercase letter/digit run with at least one `.`/`_` separator —
// matches CS_COMMON_LOGIN, CORE_COMMON_OTP, BOUNDARY.OROMIA,
// SERVICEDEFS.DRAINS. Doesn't match "Login", "OTP", "Bomet", phone
// numbers, or dashed identifiers (PGR-2026-06-11-001).
const RAW_KEY_RE = /\b[A-Z][A-Z0-9]*(?:[._][A-Z0-9]+)+\b/g;
const rawKeysIn = (text: string) =>
  [...new Set(text.match(RAW_KEY_RE) || [])];

function logFetches(fetches: LocFetch[]) {
  console.log('LOCALIZATION FETCHES:');
  for (const f of fetches) console.log(`  msgs=${f.messageCount} ${f.url}`);
}

test.describe('Citizen Flow', () => {
  test('citizen home renders with language switcher, services, and no raw keys', async ({
    page,
  }) => {
    const locFetches: LocFetch[] = [];
    captureLoc(page, locFetches);

    await page.goto('/digit-ui/citizen');

    const body = page.locator('body');
    await expect(body).toContainText(/english/i, { timeout: 30_000 });
    await expect(body).toContainText(/all services/i);
    // Anonymous visitor: the header offers Login.
    await expect(
      page.getByRole('button', { name: /login/i }).first()
    ).toBeVisible();

    const homeText = await body.innerText();
    const rawKeys = rawKeysIn(homeText);
    if (rawKeys.length) logFetches(locFetches);
    expect(
      rawKeys,
      `citizen home shows raw localization keys: ${rawKeys
        .slice(0, 10)
        .join(', ')}`
    ).toHaveLength(0);
  });

  test('login route: mobile form, populated tenant picker, no raw keys', async ({
    page,
  }) => {
    const locFetches: LocFetch[] = [];
    captureLoc(page, locFetches);

    await page.goto('/digit-ui/citizen/login');

    const mobileInput = page.locator('input[type="tel"]').first();
    await mobileInput.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(
      page.locator('button[type="submit"], button:has-text("Continue")').first()
    ).toBeVisible();

    // Tenant / city picker: many citizen deployments render one before
    // login. If present, it MUST be populated — an empty dropdown means
    // the tenant-fetch wired up to the wrong module or returned nothing,
    // and the citizen cannot proceed. If the deployment doesn't render
    // a picker at all (single-tenant SPA), don't fail — just log.
    const tenantPicker = page
      .getByRole('combobox', { name: /city|tenant|location|ward/i })
      .first();
    const pickerVisible = await tenantPicker
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (pickerVisible) {
      await tenantPicker.click();
      const options = page.getByRole('option');
      await expect
        .poll(async () => options.count(), { timeout: 10_000 })
        .toBeGreaterThan(0);
      const opts = await options.allInnerTexts();
      console.log('TENANT PICKER OPTIONS:', opts.slice(0, 10));

      const optKeys = rawKeysIn(opts.join('\n'));
      expect(
        optKeys,
        `tenant picker options contain raw keys: ${optKeys.join(
          ', '
        )} (sample: ${opts.slice(0, 5).join(' | ')})`
      ).toHaveLength(0);

      // Close the dropdown so the body-level localization scan below
      // doesn't see the popped-out option list.
      await page.keyboard.press('Escape');
    } else {
      console.log('TENANT PICKER: not present on login route');
    }

    const loginText = await page.locator('body').innerText();
    const rawKeys = rawKeysIn(loginText);
    if (rawKeys.length) logFetches(locFetches);
    expect(
      rawKeys,
      `citizen login shows raw localization keys: ${rawKeys
        .slice(0, 10)
        .join(', ')}`
    ).toHaveLength(0);
  });
});
