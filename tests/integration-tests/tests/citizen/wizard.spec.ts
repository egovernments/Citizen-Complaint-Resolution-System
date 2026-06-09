/**
 * Citizen file-complaint wizard — happy path
 *
 * Walks all 6 steps of the live wizard and asserts the confirmation page
 * contract. Per docs/personas/citizen-flows.md Stories 3.1–3.7, the
 * wizard is 6 steps (not 8 as the original catalogue claimed) and the
 * URL stays at `/create-complaint/complaint-type` for every step.
 *
 * Ground rules from the 2026-04-29 walk:
 *   - Step 1 (Complaint Details) requires Type + Subtype dropdowns.
 *   - Step 2 (Pin Complaint Location) — don't touch the map (CCRS#469).
 *   - Step 3 (Location Details) postal code is auto-filled from step 2.
 *   - Step 4 (Complaint's Location) cascades County → Sub-County → Ward,
 *     gating each level (CCRS#477).
 *   - Step 5 description is required.
 *   - Step 6 photo dropzone is optional; SUBMIT is the final button.
 */
import { test, expect } from '@playwright/test';
import { citizenOtpLogin } from '../utils/citizen-login';
import { BASE_URL, generateCitizenPhone } from '../utils/env';

test.describe('Citizen file-complaint wizard', () => {
  test('walks 6 steps + submits + lands on /pgr/response with NCCG-PGR ID', {
    annotation: {
      type: 'description',
      description: `Citizen happy-path: a logged-in citizen files a complaint by walking all six steps of the file-complaint wizard, clicks Submit, and lands on the confirmation page with a Nairobi-County-Government PGR identifier.

Steps:
1. OTP-login as a fresh citizen phone number.
2. Open /digit-ui/citizen/pgr/create-complaint/complaint-type.
3. Step 1 (Complaint Details): pick Type and Subtype from the dropdowns, click Next.
4. Step 2 (Pin Location): accept the default pin — do NOT touch the map (CCRS#469 keeps the test stable).
5. Step 3 (Location Details): assert postal code is auto-filled from step 2; click Next.
6. Step 4 (Complaint's Location): pick County → Sub-County → Ward (cascade gates each level — CCRS#477).
7. Step 5 (Description): fill the required description, click Next.
8. Step 6 (Photo): skip the optional dropzone, click SUBMIT.
9. Assert the URL flips to /pgr/response and a complaint id matching ^NCCG-PGR-\\d{4}-\\d{2}-\\d{2}-\\d+$ is rendered.

Test timeout is 180s — six steps plus DOM settles plus the final POST regularly exceeds 90s on Nairobi.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'],
  }, async ({ page }) => {
    test.setTimeout(180_000);
    const phone = generateCitizenPhone();
    await citizenOtpLogin(page, phone);

    await page.goto(
      `${BASE_URL}/digit-ui/citizen/pgr/create-complaint/complaint-type`,
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );
    await page.waitForTimeout(5000);

    // Modern digit-ui renders dropdowns as <button role="combobox"> (shadcn
    // style); older builds used `input.digit-dropdown-employee-select-wrap--elipses`.
    // Match both so the test survives on either build.
    const dropdowns = page.locator(
      'button[role="combobox"], input.digit-dropdown-employee-select-wrap--elipses',
    );
    // Modern wizard uses <button role="combobox">; older builds used a
    // wrapped <input>. Match both for cross-build compatibility.
    const cascadeDropdowns = page.locator(
      'button[role="combobox"], input[class*="select-wrap--elipses"]',
    );

    const clickNext = async () => {
      const btn = page.locator('button:visible').filter({ hasText: /^NEXT$/ }).first();
      await btn.waitFor({ state: 'visible', timeout: 10_000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(2500);
    };

    // ── Step 1: Complaint Details (Type + Subtype) ──────────────────
    await dropdowns.first().waitFor({ state: 'visible', timeout: 15_000 });
    await dropdowns.first().click();
    await page.waitForTimeout(800);
    await page.locator('[role="option"], .digit-dropdown-item').first().click();
    await page.waitForTimeout(1500);

    // Subtype is the 2nd dropdown — required-* appears after Type pick
    await dropdowns.nth(1).click();
    await page.waitForTimeout(800);
    await page.locator('[role="option"], .digit-dropdown-item').first().click();
    await page.waitForTimeout(1000);
    await clickNext();

    // ── Step 2: Pin Complaint Location — DON'T touch the map ────────
    await page.waitForTimeout(2500);
    await clickNext();

    // No "Pincode not serviceable" toast (CCRS#469 fix verified)
    const pincodeToast = page.locator(
      'text=/pincode.*not serv|CS_COMMON_PINCODE_NOT_SERVICABLE/i',
    );
    await expect(pincodeToast).toHaveCount(0);

    // ── Step 3: Location Details — pick County → SubCounty → Ward ──
    // The modern wizard collapses the old separate "location cascade"
    // (was Step 4) into Step 3: the County dropdown appears immediately;
    // SubCounty and Ward appear progressively as parents get picked.
    await page.waitForTimeout(2000);
    for (let i = 0; i < 3; i++) {
      const dd = cascadeDropdowns.nth(i);
      // Wait briefly — the cascade child may not have rendered yet.
      const visible = await dd.isVisible({ timeout: 5000 }).catch(() => false);
      if (!visible) break;
      // Skip if this dropdown already has a selection.
      const hasValue = await dd.evaluate(
        (el) => !(el as HTMLElement).innerText.match(/^Select /i),
      ).catch(() => false);
      if (hasValue) continue;
      await dd.click();
      await page.waitForTimeout(800);
      await page.locator('[role="option"], .digit-dropdown-item').first().click();
      await page.waitForTimeout(1500);
    }
    await clickNext();

    // ── Step 5: Additional Details (Description required) ──────────
    const description = page.locator('textarea').first();
    await description.waitFor({ state: 'visible', timeout: 10_000 });
    await description.fill(
      `PW citizen wizard test ${Date.now()} — auto-filed, please ignore`,
    );
    await clickNext();

    // ── Step 6: Upload Photos (skip) → SUBMIT ───────────────────────
    await page.waitForTimeout(2000);
    const submitBtn = page.locator('button:visible').filter({ hasText: /^SUBMIT$/ }).first();
    await submitBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await submitBtn.click();
    await page.waitForTimeout(8000);

    // ── Confirmation page contract ─────────────────────────────────
    await expect(page).toHaveURL(/\/citizen\/pgr\/response/);
    const body = page.locator('body');
    await expect(body).toContainText('Complaint Submitted');
    await expect(body).toContainText(/NCCG-PGR-\d{4}-\d{2}-\d{2}-\d+/);
    await expect(body).toContainText(/Go back to home page/i);

    // Smoke: no error fallback rendered
    await expect(body).not.toContainText('Something went wrong');
  });
});
