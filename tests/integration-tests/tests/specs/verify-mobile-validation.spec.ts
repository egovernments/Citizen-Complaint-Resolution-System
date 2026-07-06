import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT } from '../utils/env';
import { getMobileValidationRule, generateValidMobile } from '../utils/mdms-mobile';

test('mobile validation reflects the deployment MDMS rule', {
  annotation: {
    type: 'description',
    description: `End-to-end verification that the citizen login page reflects the deployment's MDMS MobileNumberValidation rule (originally pinned to the 9-digit-only CCRS Kenya rollout, now parameterized). The page must hard-cap input length at rule.maxLength, the visible counter must read x/<maxLength>, and typing a too-long number must truncate to <= maxLength — confirming the MDMS rule made it through the validationRules Redis cache and into the UI.

Steps:
1. Fetch the live mobile-validation rule from MDMS for TENANT.
2. Open <BASE_URL>/digit-ui/citizen/login and wait 8s for the form to mount.
3. Read maxlength + placeholder off the Mobile Number textbox; assert maxlength === String(rule.maxLength).
4. Scrape the counter text from body innerText (matches /\\d+\\/\\d+/) and assert the denominator equals rule.maxLength.
5. Type a (maxLength+1)-digit number and assert the input value is truncated to <= maxLength characters.
6. Clear and type a valid mobile number; assert the Next button is enabled.
7. Read body text and assert it mentions the rule length, not a stale length.

Catches a regression where the validationRules Redis cache wasn't invalidated after MDMS update — old rule sticks and the test fails on maxlength or counter.`,
  },
  tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:admin'] }, async ({ page }) => {
  test.setTimeout(60_000);

  // Source the rule from MDMS for the active tenant so the spec stays
  // tenant-agnostic — same test passes against a 9-digit Kenya deployment
  // and a 10-digit Indian one.
  const rule = await getMobileValidationRule(TENANT);
  const expectedLen = rule.maxLength;
  const validMobile = generateValidMobile(rule);
  const tooLong = '0'.repeat(expectedLen + 1);

  await page.goto(`${BASE_URL}/digit-ui/citizen/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  // Inspect the mobile input directly — placeholder + maxLength reflect MDMS rule
  const mobileInput = page.getByRole('textbox', { name: /mobile number/i }).first();
  await mobileInput.waitFor({ state: 'visible', timeout: 10_000 });
  const maxLength = await mobileInput.getAttribute('maxlength');
  const placeholder = await mobileInput.getAttribute('placeholder');
  console.log('maxLength:', maxLength, '| placeholder:', placeholder, '| expected:', expectedLen);

  // Read the counter / hint text near the input
  const bodyText = await page.locator('body').innerText();
  const counterMatch = bodyText.match(/(\d+)\/(\d+)/);
  console.log('Counter shows:', counterMatch ? counterMatch[0] : 'NOT FOUND');

  expect(maxLength).toBe(String(expectedLen));
  expect(counterMatch?.[2]).toBe(String(expectedLen));

  // Try entering a too-long number — input should truncate to maxLength OR validation rejects
  await mobileInput.fill(tooLong);
  await page.waitForTimeout(500);
  const valAfterTooLong = await mobileInput.inputValue();
  console.log(`After typing "${tooLong}" (${tooLong.length} chars):`, JSON.stringify(valAfterTooLong), 'length=', valAfterTooLong.length);
  expect(valAfterTooLong.length).toBeLessThanOrEqual(expectedLen);

  // Try a valid number for the rule — Next button should enable
  await mobileInput.fill('');
  await mobileInput.fill(validMobile);
  await page.waitForTimeout(500);
  const nextBtn = page.locator('button:has-text("Next")').first();
  const validEnabled = await nextBtn.isEnabled().catch(() => false);
  console.log(`Next enabled with valid mobile "${validMobile}":`, validEnabled);
  expect(validEnabled).toBe(true);

  // Verify the page hint mentions the rule's length — guards against a
  // stale "10-digit"/"9-digit" string from a previous rule sticking in
  // the bundle / localization cache.
  const placeholderText = await mobileInput.getAttribute('placeholder');
  console.log('Placeholder:', placeholderText);
  expect(bodyText.toLowerCase()).toContain(`${expectedLen}-digit`);
});
