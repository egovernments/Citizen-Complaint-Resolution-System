import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';

test('complaint type dropdown shows human-readable translated names', {
  annotation: {
    type: 'description',
    description: `Localization regression guard: when a citizen opens the complaint type dropdown, every entry must be a translated, human-readable label — not a blank, and not a raw i18n key like "SERVICEDEFS.PARKING" or "CS_…". These would slip through if the localization seed for service definitions misses a tenant or locale.

Steps:
1. setTimeout 90s; citizenOtpLogin with a fresh phone.
2. Navigate to /digit-ui/citizen/pgr/create-complaint/complaint-type, wait 8s for hydration.
3. Open the first combobox using the hierarchical picker pattern from walkWizard:
   - Locate button[role="combobox"] or the legacy input selector.
   - Click and wait for [role="option"] to appear, retrying up to 3 times with increasing
     delays (1 s, 3 s, 5 s) to handle slow MDMS responses on ke.
4. Read the trimmed text of every visible [role="option"] (hierarchical / CRS UI),
   falling back to the flat v1 selectors (.option-des-container .main-option,
   .digit-dropdown-employee-select-wrap--item) for older deployments.
5. Assert items.length > 0.
6. Assert no item is empty.
7. Assert no item starts with "SERVICEDEFS." or "CS_" — those would be raw i18n keys.

Catches a regression where a tenant misses a locale fallback and the dropdown shows the
underlying MDMS code to the citizen. Handles both flat (Ethiopia) and hierarchical
drill-down (Bomet ke CRS) wizard shapes.`,
  },
  tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
  test.setTimeout(90_000);
  await citizenOtpLogin(page);

  // Navigate to the citizen complaint creation page.
  // Use the /complaint-type sub-route so the ke CRS wizard lands directly on
  // Step 1 (the hierarchical complaint-type picker), matching the URL used by
  // wizard.spec.ts's walkWizard.  The older /create-complaint root also works
  // for flat-dropdown deployments because it redirects to the same step.
  await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForTimeout(8000);

  // ── Locate the first combobox ──────────────────────────────────────────────
  //
  // Modern digit-ui (ke CRS / hierarchical) renders each drill-down level as
  //   button[role="combobox"]
  // Older flat deployments used:
  //   input[class*="select-wrap--elipses"]
  //
  // Match both so the spec survives on either build (same strategy as
  // wizard.spec.ts walkWizard).
  const comboboxLocator = page.locator(
    'button[role="combobox"], input[class*="select-wrap--elipses"]',
  );
  await comboboxLocator.first().waitFor({ state: 'visible', timeout: 15_000 });

  // ── Open the dropdown with retry (mirrors walkWizard's ke handling) ────────
  //
  // On ke the CRS listbox is populated asynchronously from MDMS.  The listbox
  // can appear empty on the first render; the walkWizard loop retries up to 3
  // times with increasing waits.  Apply the same pattern here.
  let items: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await comboboxLocator.first().click();
    const waitMs = 1000 + attempt * 2000; // 1 s, 3 s, 5 s
    await page.waitForTimeout(waitMs);

    items = await page.evaluate(() => {
      // Hierarchical CRS / modern digit-ui: [role="option"] inside a listbox.
      const roleOptions = document.querySelectorAll('[role="option"]');
      if (roleOptions.length > 0) {
        return Array.from(roleOptions).map(el => el.textContent?.trim() || '');
      }
      // Flat dropdown (v2): ul[role="listbox"] li span.truncate
      const truncateOptions = document.querySelectorAll(
        'ul[role="listbox"] li[role="option"] span.truncate',
      );
      if (truncateOptions.length > 0) {
        return Array.from(truncateOptions).map(el => el.textContent?.trim() || '');
      }
      // Legacy v1 selectors
      const v1Options = document.querySelectorAll(
        '.option-des-container .main-option, .digit-dropdown-employee-select-wrap--item',
      );
      return Array.from(v1Options).map(el => el.textContent?.trim() || '');
    });

    console.log(`Attempt ${attempt + 1}: found ${items.length} dropdown items`);
    if (items.length > 0) break;

    // Close the empty dropdown before retrying — click again to toggle off.
    await comboboxLocator.first().click();
    await page.waitForTimeout(500 + attempt * 500);
  }

  console.log('Dropdown items:', items);

  // Must have items
  expect(items.length).toBeGreaterThan(0);

  // Every item must be non-empty
  const emptyItems = items.filter(t => t.length === 0);
  expect(emptyItems, 'Some dropdown items are blank').toHaveLength(0);

  // No item should show a raw i18n key (e.g. "SERVICEDEFS.PARKING")
  const rawKeys = items.filter(t => t.startsWith('SERVICEDEFS.') || t.startsWith('CS_'));
  expect(rawKeys, `Raw i18n keys found: ${rawKeys.join(', ')}`).toHaveLength(0);
});
