import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL } from '../utils/env';

test('complaint type dropdown shows human-readable translated names', {
  annotation: {
    type: 'description',
    description: `Localization regression guard: when a citizen opens the complaint type dropdown, every entry must be a translated, human-readable label — not a blank, and not a raw i18n key like "SERVICEDEFS.PARKING" or "CS_…". These would slip through if the localization seed for service definitions misses a tenant or locale.

Steps:
1. setTimeout 90s; citizenOtpLogin with a fresh phone.
2. Navigate to /digit-ui/citizen/pgr/create-complaint, wait 8s for hydration.
3. Locate the first select-wrap dropdown input and click to open it.
4. Read the trimmed text of every visible option (.option-des-container .main-option, .digit-dropdown-employee-select-wrap--item).
5. Assert items.length > 0.
6. Assert no item is empty.
7. Assert no item starts with "SERVICEDEFS." or "CS_" — those would be raw i18n keys.

Catches a regression where a tenant misses a locale fallback and the dropdown shows the underlying MDMS code to the citizen.`,
  },
  tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
  test.setTimeout(90_000);
  await citizenOtpLogin(page);

  // Navigate to the citizen complaint creation (FormExplorer)
  await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(8000);

  // Find and click the complaint type dropdown.
  // digit-ui v2 renders the complaint-type field as a Radix-style combobox button
  // (button[role="combobox"]#complaint-type) rather than the legacy
  // input[class*="select-wrap--elipses"] used on older Kenya deployments.
  // Both selectors are tried so the spec works across deployment versions.
  const legacyDropdown = page.locator('input[class*="select-wrap--elipses"]').first();
  const v2Combobox = page.locator('button[role="combobox"]#complaint-type');

  const isLegacy = await legacyDropdown.isVisible({ timeout: 2000 }).catch(() => false);
  if (isLegacy) {
    await legacyDropdown.click();
  } else {
    await v2Combobox.waitFor({ state: 'visible', timeout: 15_000 });
    await v2Combobox.click();
  }
  await page.waitForTimeout(2000);

  // Get the dropdown items text.
  // v2: ul[role="listbox"] li[role="option"] span.truncate
  // v1: .option-des-container .main-option or .digit-dropdown-employee-select-wrap--item
  const items = await page.evaluate(() => {
    const v2Options = document.querySelectorAll('ul[role="listbox"] li[role="option"] span.truncate');
    if (v2Options.length > 0) {
      return Array.from(v2Options).map(el => el.textContent?.trim() || '');
    }
    const v1Options = document.querySelectorAll(
      '.option-des-container .main-option, .digit-dropdown-employee-select-wrap--item'
    );
    return Array.from(v1Options).map(el => el.textContent?.trim() || '');
  });

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
