import { type Page, type Locator } from '@playwright/test';

export type CitizenLanding = 'language-selection' | 'home' | 'login' | 'unknown';

/**
 * Dispatch on /digit-ui/citizen depends on tenant default + stateInfo.languages
 * length. See digit-ui-esbuild/.../citizen/Home/index.js (redirect to
 * /citizen/select-language when no tenantId) and .../LanguageSelection/index.js
 * (auto-skip to login when languages.length === 1).
 *
 * detectLanding() races over the three possible landing surfaces (DOM markers
 * + URL patterns) so the spec can self-skip mode-specific assertions when the
 * deployment renders a different surface than expected.
 */
export class CitizenLandingPage {
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
    await this.page.goto('/digit-ui/citizen', { waitUntil: 'domcontentloaded' });
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
