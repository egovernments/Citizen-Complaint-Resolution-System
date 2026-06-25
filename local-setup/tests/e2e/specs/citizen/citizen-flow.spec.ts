import { test, expect } from '@playwright/test';
import { CitizenLandingPage } from '../../pages/citizen-landing.page';

test.describe('Citizen landing dispatch', () => {
  // Start each test from a clean storage state so per-deployment defaults
  // (tenant from globalConfigs, single-language auto-skip) drive the
  // landing — not session leftovers from earlier tests.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('smoke: lands on a usable citizen page', async ({ page }) => {
    const landing = new CitizenLandingPage(page);
    await landing.goto();
    const mode = await landing.detectLanding();
    test.info().annotations.push({ type: 'landing-mode', description: mode });
    expect(mode).not.toBe('unknown');
  });

  test('language-selection: shows Choose Language and Continue navigates onward', async ({ page }) => {
    const landing = new CitizenLandingPage(page);
    await landing.goto();
    const mode = await landing.detectLanding();
    test.skip(
      mode !== 'language-selection',
      `LanguageSelection page not rendered on this deployment (mode=${mode}). Auto-skip happens when tenantId is pre-resolved by globalConfigs OR stateInfo.languages.length === 1.`,
    );

    await expect(landing.chooseLanguageHeading.or(landing.continueButton)).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body.toUpperCase()).toContain('ENGLISH');

    await landing.continueButton.click();
    await page.waitForURL(/\/(citizen\/(login|select-city|home)|user\/login)/, { timeout: 15_000 });
  });

  test('auto-skip-home: All Services menu renders', async ({ page }) => {
    const landing = new CitizenLandingPage(page);
    await landing.goto();
    const mode = await landing.detectLanding();
    test.skip(
      mode !== 'home',
      `Home auto-skip not active on this deployment (mode=${mode}). Tenant default not pre-resolved by globalConfigs.`,
    );

    await expect(landing.allServicesMarker).toBeVisible();
    await expect(page.getByText(/File a Complaint|HOME_FILE_COMPLAINT|RAINMAKER-PGR/i).first()).toBeVisible();
  });

  test('auto-skip-login: single-language tenant lands on login', async ({ page }) => {
    const landing = new CitizenLandingPage(page);
    await landing.goto();
    const mode = await landing.detectLanding();
    test.skip(
      mode !== 'login',
      `Login auto-skip not active on this deployment (mode=${mode}). Happens when stateInfo.languages.length === 1 AND no home tenant is pre-resolved.`,
    );

    await expect(landing.loginMobileInput).toBeVisible();
  });
});
