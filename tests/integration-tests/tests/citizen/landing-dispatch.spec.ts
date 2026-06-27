/**
 * Citizen landing-page dispatch — ported from local-setup/tests/e2e/specs/citizen/citizen-flow.spec.ts
 *
 * Tests the dispatch logic that drives the citizen landing page:
 *   - language-selection: shown when tenant is not pre-resolved and >1 language configured
 *   - auto-skip-home:     shown when tenantId is pre-resolved by globalConfigs
 *   - auto-skip-login:    shown when stateInfo.languages.length === 1
 *
 * Each test self-skips when the current deployment renders a different surface
 * than the one under test — making this spec safe to run on any DIGIT deployment.
 *
 * No @local-only tag — this logic is environment-agnostic.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { BASE_URL } from '../utils/env';

// ── Inline page object ────────────────────────────────────────────────────────
// The legacy suite keeps this in local-setup/tests/e2e/pages/citizen-landing.page.ts.
// Integration tests carry no shared pages/ directory, so we inline the class here.

type CitizenLanding = 'language-selection' | 'home' | 'login' | 'unknown';

class CitizenLandingPage {
  readonly page: Page;
  readonly continueButton: Locator;
  readonly chooseLanguageHeading: Locator;
  readonly allServicesMarker: Locator;
  readonly loginMobileInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.continueButton = page
      .locator('button:has-text("Continue"), button:has-text("CONTINUE"), button:has-text("CORE_COMMON_CONTINUE")')
      .first();
    this.chooseLanguageHeading = page
      .getByText(/Choose language|CS_COMMON_CHOOSE_LANGUAGE/i)
      .first();
    this.allServicesMarker = page
      .getByText(/All Services|ACTION_TEST_ALL_SERVICES_HEADER/i)
      .first();
    this.loginMobileInput = page.locator('input[name="mobileNumber"]').first();
  }

  async goto() {
    await this.page.goto(`${BASE_URL}/digit-ui/citizen`, { waitUntil: 'domcontentloaded' });
  }

  async detectLanding(timeout = 15_000): Promise<CitizenLanding> {
    return Promise.race<CitizenLanding>([
      this.page
        .waitForURL(/\/citizen\/select-language/, { timeout })
        .then(() => 'language-selection' as const),
      this.continueButton
        .waitFor({ state: 'visible', timeout })
        .then(() => 'language-selection' as const),
      this.chooseLanguageHeading
        .waitFor({ state: 'visible', timeout })
        .then(() => 'language-selection' as const),
      this.page
        .waitForURL(/\/citizen\/login/, { timeout })
        .then(() => 'login' as const),
      this.loginMobileInput
        .waitFor({ state: 'visible', timeout })
        .then(() => 'login' as const),
      this.allServicesMarker
        .waitFor({ state: 'visible', timeout })
        .then(() => 'home' as const),
    ]).catch(() => 'unknown' as const);
  }
}

// ── Spec ─────────────────────────────────────────────────────────────────────

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
