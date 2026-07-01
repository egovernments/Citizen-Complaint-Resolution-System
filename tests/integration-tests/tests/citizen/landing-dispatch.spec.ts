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
    // NOTE: continueButton alone is NOT enough to detect language-selection —
    // the login page also has a button labelled "Continue".  Only the URL
    // match or the dedicated "Choose Language" heading reliably identify
    // the select-language surface.
    return Promise.race<CitizenLanding>([
      this.page
        .waitForURL(/\/citizen\/select-language/, { timeout })
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

  test('smoke: lands on a usable citizen page', {
    annotation: {
      type: 'description',
      description: `Smoke check that the citizen landing page loads without fatal errors, regardless of deployment mode (language-selection, home, or login). Catches crashes in the dispatch logic.

Steps:
1. Navigate to /digit-ui/citizen with clean storage.
2. Wait up to 15s for one of: language-selection page, home page, or login page.
3. Assert that mode is not 'unknown' (i.e., the page loaded).

Pairs with language-selection, auto-skip-home, and auto-skip-login tests that validate specific dispatch branches.`,
    },
    tag: ['@area:pgr', '@kind:smoke', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    const landing = new CitizenLandingPage(page);
    await landing.goto();
    const mode = await landing.detectLanding();
    test.info().annotations.push({ type: 'landing-mode', description: mode });
    expect(mode).not.toBe('unknown');
  });

  test('language-selection: shows Choose Language and Continue navigates onward', {
    annotation: {
      type: 'description',
      description: `Validates the language-selection dispatch branch — shown when tenant is not pre-resolved by globalConfigs AND stateInfo.languages.length > 1. Asserts the heading + button render and language selection advances to the next step (login, city select, or home).

Steps:
1. Navigate to /digit-ui/citizen with clean storage.
2. Detect dispatch mode; skip if not 'language-selection'.
3. Assert 'Choose Language' heading or Continue button is visible.
4. Assert body contains 'ENGLISH' (the default language).
5. Click Continue; assert URL changes to /citizen/login, /citizen/select-city, /citizen/home, or /user/login.

Skips on deployments with single language or pre-resolved tenant — safe to run anywhere.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
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
    // After choosing a language the SPA may route to login, city-select,
    // all-services (single-language tenants), or stay on select-language
    // while loading the next surface.  Accept any citizen sub-path except
    // the bare language-selection page itself.
    await page.waitForURL(
      /\/(citizen\/(login|select-city|home|all-services)|user\/login)/,
      { timeout: 15_000 },
    );
  });

  test('auto-skip-home: All Services menu renders', {
    annotation: {
      type: 'description',
      description: `Validates the auto-skip-home dispatch branch — shown when tenantId is pre-resolved by globalConfigs. Asserts the All Services page renders with the File a Complaint action available.

Steps:
1. Navigate to /digit-ui/citizen with clean storage.
2. Detect dispatch mode; skip if not 'home'.
3. Assert 'All Services' marker is visible.
4. Assert 'File a Complaint' (or localized equivalent) is visible.

Skips on deployments without a pre-configured tenant default — safe to run anywhere.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
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

  test('auto-skip-login: single-language tenant lands on login', {
    annotation: {
      type: 'description',
      description: `Validates the auto-skip-login dispatch branch — shown when stateInfo.languages.length === 1 AND no home tenant is pre-resolved by globalConfigs. Asserts the login page renders with the mobile number input visible.

Steps:
1. Navigate to /digit-ui/citizen with clean storage.
2. Detect dispatch mode; skip if not 'login'.
3. Assert mobile number input is visible.

Skips on deployments with multiple languages or a pre-configured tenant default — safe to run anywhere.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
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
