/**
 * Citizen landing-page dispatch — ported from local-setup/tests/e2e/specs/citizen/citizen-flow.spec.ts
 *
 * The citizen entry point has exactly TWO outcomes on load
 * (digit-ui-esbuild/packages/modules/core/src/pages/citizen/Home/index.js:48-55):
 *
 *   if (!tenantId)        -> push /citizen/select-language   (language-selection)
 *   else if (redirectURL) -> push /citizen/{redirectURL}     (home)
 *
 * `tenantId` is ULBService.getCitizenCurrentTenant(), which with no session
 * city falls through to getStateId() — globalConfigs' STATE_LEVEL_TENANT_ID.
 * Discovery records that value as `profile.globalConfigs.stateTenantId`, so
 * the branch is a pure function of the deployment profile. This spec computes
 * the expected branch and ASSERTS it, rather than skipping whichever branch it
 * did not happen to get: a deployment that lost its STATE_LEVEL_TENANT_ID
 * would silently drop every citizen onto select-language, and a self-skipping
 * spec would stay green through it.
 *
 * There is deliberately no third "auto-skip-login" branch. The
 * `stateInfo.languages.length === 1` short-circuit that would produce one is
 * EMPLOYEE-only (core/src/pages/employee/LanguageSelection/index.js:32,47);
 * the citizen LanguageSelection (core/src/pages/citizen/Home/LanguageSelection.js)
 * has no length check, always renders the radio list, and only reaches
 * /citizen/login from its own Continue button. A test for that branch could
 * not run on any deployment, so it is not written.
 *
 * No @local-only tag — this logic is environment-agnostic.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { BASE_URL } from '../utils/env';
import { getProfile } from '../utils/profile';

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
  readonly languageOptions: Locator;

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
    // RadioButtons renders one `input.radio-btn[type=radio]` per configured
    // language (react-components/src/atoms/RadioButtons.js).
    this.languageOptions = page.locator('input[type="radio"]');
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

/**
 * The branch THIS deployment's own boot config selects.
 *
 * Read lazily (not at module scope) so a `--list` / lint pass with no
 * deployment-profile.json on disk still collects the file.
 */
function expectedLanding(): { branch: 'home' | 'language-selection'; why: string } {
  const stateTenantId = getProfile().globalConfigs.stateTenantId;
  return stateTenantId
    ? {
        branch: 'home',
        why: `globalConfigs.stateTenantId='${stateTenantId}' resolves a citizen tenant on load, so Home/index.js takes the redirectURL branch`,
      }
    : {
        branch: 'language-selection',
        why: 'globalConfigs carries no STATE_LEVEL_TENANT_ID, so Home/index.js resolves no tenant and pushes /citizen/select-language',
      };
}

// ── Spec ─────────────────────────────────────────────────────────────────────

test.describe('Citizen landing dispatch', () => {
  // Start each test from a clean storage state so per-deployment defaults
  // (tenant from globalConfigs) drive the landing — not session leftovers
  // from earlier tests.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('smoke: lands on a usable citizen page', {
    annotation: {
      type: 'description',
      description: `Smoke check that the citizen landing page loads without fatal errors, regardless of dispatch branch (language-selection or home). Catches crashes in the dispatch logic itself, independent of which branch this deployment is configured for.

Steps:
1. Navigate to /digit-ui/citizen with clean storage.
2. Wait up to 15s for one of: language-selection page, home page, or login page.
3. Assert that mode is not 'unknown' (i.e., the page loaded).

Pairs with the dispatch-correctness test below, which asserts WHICH branch fired.`,
    },
    tag: ['@area:pgr', '@kind:smoke', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    const landing = new CitizenLandingPage(page);
    await landing.goto();
    const mode = await landing.detectLanding();
    test.info().annotations.push({ type: 'landing-mode', description: mode });
    expect(mode).not.toBe('unknown');
  });

  test('dispatch: lands on the branch globalConfigs selects, and that branch works', {
    annotation: {
      type: 'description',
      description: `Asserts the citizen landing dispatch took the branch this deployment's own boot config selects, then exercises that branch. The expectation is derived from deployment-profile.json (globalConfigs.stateTenantId) rather than from whatever rendered, so a deployment that lost its STATE_LEVEL_TENANT_ID fails here instead of quietly serving select-language to every citizen.

Steps:
1. Compute expected branch: stateTenantId present -> 'home', absent -> 'language-selection' (Home/index.js:48-55).
2. Navigate to /digit-ui/citizen with clean storage; detect the landing surface.
3. Assert detected === expected. No skip: both branches are testable.
4a. 'home': assert the All Services marker and the File-a-Complaint entry are visible.
4b. 'language-selection': assert the Choose Language heading / Continue button renders, assert at least one language radio option is rendered (count comes from stateInfo.languages — no language name is pinned), then click Continue and assert it routes onward to login / city-select / home.

Never skips — the branch is a function of the profile, and both branches have assertions.`,
    },
    tag: ['@area:pgr', '@kind:regression', '@layer:ui', '@persona:citizen'] }, async ({ page }) => {
    const { branch, why } = expectedLanding();
    test.info().annotations.push({ type: 'expected-landing', description: `${branch} — ${why}` });

    const landing = new CitizenLandingPage(page);
    await landing.goto();
    const mode = await landing.detectLanding();

    expect(
      mode,
      `citizen landing dispatched to '${mode}' but this deployment is configured for '${branch}': ${why}`,
    ).toBe(branch);

    if (branch === 'home') {
      await expect(landing.allServicesMarker).toBeVisible();
      await expect(page.getByText(/File a Complaint|HOME_FILE_COMPLAINT|RAINMAKER-PGR/i).first()).toBeVisible();
      return;
    }

    await expect(landing.chooseLanguageHeading.or(landing.continueButton)).toBeVisible();
    // The radio list is built from stateInfo.languages. Assert it is non-empty
    // rather than pinning a language name — 'ENGLISH' is one deployment's data,
    // not the contract.
    expect(
      await landing.languageOptions.count(),
      'select-language rendered no language options — stateInfo.languages is empty',
    ).toBeGreaterThan(0);

    await landing.continueButton.click();
    // Citizen LanguageSelection.onSubmit pushes /citizen/login. Older/compact
    // builds may land on city-select or all-services instead; accept any
    // citizen sub-path except the bare language-selection page itself.
    await page.waitForURL(
      /\/(citizen\/(login|select-city|home|all-services)|user\/login)/,
      { timeout: 15_000 },
    );
  });
});
