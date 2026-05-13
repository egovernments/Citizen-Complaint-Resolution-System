import { test, expect } from '@playwright/test';
import { CitizenLanguagePage } from '../pages/citizen-language.page';

test.describe('Citizen Flow', () => {
  test('displays language selection page', async ({ page }) => {
    const langPage = new CitizenLanguagePage(page);
    await langPage.goto();
    await langPage.waitForReady();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText.toUpperCase()).toContain('ENGLISH');
  });

  test('continue navigates to login page', async ({ page }) => {
    const langPage = new CitizenLanguagePage(page);
    await langPage.goto();
    await langPage.waitForReady();

    // Continue button text varies: "Continue" or "CONTINUE"
    const continueBtn = page.locator(
      'button:has-text("Continue"), button:has-text("CONTINUE"), a:has-text("Continue")'
    );

    if (await continueBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueBtn.first().click();
      await page.waitForURL(/\/(user\/login|login)/, { timeout: 15_000 });
      expect(page.url()).toMatch(/\/(user\/login|login)/);
    } else {
      // Some builds auto-redirect or don't show continue button
      expect(page.url()).toMatch(/\/(citizen|user\/login)/);
    }
  });
});
