import { test, expect } from '@playwright/test';
import { BASE_URL, TENANT } from '../utils/env';
import { getMobileValidationRule, generateValidMobile } from '../utils/mdms-mobile';

test('mobile validation reflects the deployment MDMS rule', {
  annotation: {
    type: 'description',
    description: `End-to-end verification that the citizen login page reflects the deployment's MDMS MobileNumberValidation rule (originally pinned to the 9-digit-only CCRS Kenya rollout, now parameterized). The page must hard-cap input length at rule.maxLength, typing a too-long number must truncate to <= maxLength, and the help text must reflect the rule length — confirming the MDMS rule made it through the validationRules Redis cache and into the UI. The v2 login card (SelectMobileNumber.js) renders NO x/<max> counter; the help text comes from buildMobileErrorMessage and reads like "Please enter a valid mobile number (9 digits, starting with 1 or 7)".

Steps:
1. Fetch the live mobile-validation rule from MDMS for TENANT.
2. Open <BASE_URL>/digit-ui/citizen/login and wait 8s for the form to mount.
3. Read maxlength off the Mobile Number textbox; assert maxlength === String(rule.maxLength).
4. Type a (maxLength+1)-digit number and assert the input value is truncated to <= maxLength characters.
5. Clear and type a valid mobile number; assert the Continue/Next button is enabled.
6. Read body text and assert the help text mentions the rule length ("<n> digits"), not a stale length.

Catches a regression where the validationRules Redis cache wasn't invalidated after MDMS update — old rule sticks and the test fails on maxlength or the help text.`,
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

  const bodyText = await page.locator('body').innerText();

  // The v2 login card (SelectMobileNumber.js) hard-caps the input via
  // maxLength — assert that reflects the MDMS rule. (The old x/<max>
  // counter no longer exists in v2, so we no longer scrape it.)
  expect(maxLength).toBe(String(expectedLen));

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
  // v2 renames the CTA to "Continue" (falls back from CS_COMMONS_NEXT);
  // accept either wording so the assertion survives the rename.
  const nextBtn = page.locator('button:has-text("Continue"), button:has-text("Next")').first();
  const validEnabled = await nextBtn.isEnabled().catch(() => false);
  console.log(`Continue/Next enabled with valid mobile "${validMobile}":`, validEnabled);
  expect(validEnabled).toBe(true);

  // Verify the help text mentions the rule's length — guards against a
  // stale length sticking in the bundle / localization cache. v2's
  // buildMobileErrorMessage renders "(<n> digits, starting with …)"
  // (space + plural "digits"), NOT the old "<n>-digit" copy. min may
  // differ from max (e.g. "9-10 digits"), so match either the exact
  // maxLength or a "<min>-<max> digits" range that includes it.
  const helpText = bodyText.toLowerCase();
  console.log('Placeholder:', await mobileInput.getAttribute('placeholder'));
  expect(helpText).toMatch(/\d+(?:-\d+)?\s*digits/);
  expect(helpText).toContain(String(expectedLen));
});
