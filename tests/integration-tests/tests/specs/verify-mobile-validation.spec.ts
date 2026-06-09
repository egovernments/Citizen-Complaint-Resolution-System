import { test, expect } from '@playwright/test';

const BASE_URL = 'https://naipepea.digit.org';

test('mobile validation reflects 9-digit-only MDMS rule', {
  annotation: {
    type: 'description',
    description: `End-to-end verification that the citizen login page reflects the 9-digit-only MDMS UserValidation rule (CCRS Kenya rollout). The page must hard-cap input length at 9, the visible counter must read x/9, and a typed 10-digit number must be truncated to 9 — confirming the MDMS rule made it through the validationRules Redis cache and into the UI.

Steps:
1. Open https://naipepea.digit.org/digit-ui/citizen/login and wait 8s for the form to mount.
2. Read maxlength + placeholder off the Mobile Number textbox; assert maxlength === '9'.
3. Scrape the counter text from body innerText (matches /\\d+\\/\\d+/) and assert the denominator is '9'.
4. Type "0712345678" (10 chars) and assert the input value is truncated to ≤ 9 characters.
5. Clear and type a valid 9-digit "712345678"; assert the Next button is enabled.
6. Read the placeholder again and assert body text contains "9-digit" but does NOT contain "10-digit".

Catches a regression where the validationRules Redis cache wasn't invalidated after MDMS update — old 10-digit rule sticks and the test fails on maxlength or counter.`,
  },
  tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto(`${BASE_URL}/digit-ui/citizen/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // Inspect the mobile input directly — placeholder + maxLength reflect MDMS rule
  const mobileInput = page.getByRole('textbox', { name: /mobile number/i }).first();
  await mobileInput.waitFor({ state: 'visible', timeout: 10_000 });
  const maxLength = await mobileInput.getAttribute('maxlength');
  const placeholder = await mobileInput.getAttribute('placeholder');
  console.log('maxLength:', maxLength, '| placeholder:', placeholder);

  // Read the counter / hint text near the input
  const bodyText = await page.locator('body').innerText();
  const counterMatch = bodyText.match(/(\d+)\/(\d+)/);
  console.log('Counter shows:', counterMatch ? counterMatch[0] : 'NOT FOUND');

  // Old rule had max=10. New rule must be max=9.
  expect(maxLength).toBe('9');
  expect(counterMatch?.[2]).toBe('9');

  // Try entering a 10-digit number — input should truncate to 9 OR validation rejects
  await mobileInput.fill('0712345678');
  await page.waitForTimeout(500);
  const valAfter10 = await mobileInput.inputValue();
  console.log('After typing "0712345678" (10 chars):', JSON.stringify(valAfter10), 'length=', valAfter10.length);
  expect(valAfter10.length).toBeLessThanOrEqual(9);

  // Try a valid 9-digit number — Next button should enable
  await mobileInput.fill('');
  await mobileInput.fill('712345678');
  await page.waitForTimeout(500);
  const nextBtn = page.locator('button:has-text("Next")').first();
  const valid9Enabled = await nextBtn.isEnabled().catch(() => false);
  console.log('Next enabled with valid 9-digit "712345678":', valid9Enabled);
  expect(valid9Enabled).toBe(true);

  // Verify the placeholder hint reflects 9-digit rule
  const placeholderText = await mobileInput.getAttribute('placeholder');
  console.log('Placeholder:', placeholderText);

  // Verify the page hint mentions 9 digits, not 10
  expect(bodyText.toLowerCase()).toContain('9-digit');
  expect(bodyText).not.toContain('10-digit');
});
