import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test('complaint type dropdown shows human-readable translated names', async ({ page }) => {
  test.setTimeout(90_000);
  const phone = generateCitizenPhone();
  await citizenOtpLogin(page, phone);

  // Navigate to the citizen complaint creation (FormExplorer)
  await page.goto(`${BASE_URL}/digit-ui/citizen/pgr/create-complaint`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(8000);

  // Find and click the complaint type dropdown
  const dropdown = page.locator('input[class*="select-wrap--elipses"]').first();
  await dropdown.waitFor({ state: 'visible', timeout: 15_000 });
  await dropdown.click();
  await page.waitForTimeout(2000);

  // Get the dropdown items text
  const items = await page.evaluate(() => {
    const els = document.querySelectorAll(
      '.option-des-container .main-option, .digit-dropdown-employee-select-wrap--item'
    );
    return Array.from(els).map(el => el.textContent?.trim() || '');
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
