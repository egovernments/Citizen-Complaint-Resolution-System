import { test, expect } from '@playwright/test';

test.describe('Login page localization', () => {
  test('loads localization messages and renders translated labels', async ({ page }) => {
    // Collect localization API responses as they arrive
    const localizationRequests: { url: string; response: any }[] = [];

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/localization/messages/v1/_search')) {
        try {
          const body = await response.json();
          localizationRequests.push({ url, response: body });
        } catch {
          // ignore non-JSON responses
        }
      }
    });

    // Navigate to the login page — don't wait for networkidle since
    // the DIGIT SPA shows a spinner while React boots and fetches data
    await page.goto('/digit-ui/employee/user/login');

    // Wait for the login form to render — this means the React app has
    // booted, fetched MDMS config, fetched localization, and rendered
    const loginForm = page.locator('form, [class*="login"], [class*="Login"]');
    await expect(loginForm.first()).toBeVisible({ timeout: 60_000 });

    // Give a moment for any in-flight localization responses to settle
    await page.waitForTimeout(2_000);

    // 1. At least one localization API call was made
    expect(
      localizationRequests.length,
      'Expected at least one localization API call — the DIGIT UI should fetch translations on page load',
    ).toBeGreaterThan(0);

    // 2. CRITICAL: The locale parameter must be "en_IN", NOT "en_IN_IN".
    //    When globalConfigs.localeDefault is wrongly set to "en_IN",
    //    the UI constructs "en_IN" + "_" + "IN" = "en_IN_IN" which has no data.
    //    The fix: localeDefault = "en" → locale becomes "en" + "_" + "IN" = "en_IN".
    const allUrls = localizationRequests.map((r) => r.url);
    const hasBrokenLocale = allUrls.some((u) => u.includes('locale=en_IN_IN'));
    const hasCorrectLocale = allUrls.some((u) =>
      /locale=en_IN(?!_)/.test(u),
    );

    expect(
      hasBrokenLocale,
      'Detected locale=en_IN_IN — globalConfigs.localeDefault is likely "en_IN" instead of "en"',
    ).toBe(false);
    expect(
      hasCorrectLocale,
      'Expected locale=en_IN in localization requests',
    ).toBe(true);

    // 3. Check if any response has non-empty messages (data availability).
    //    In the CI environment, the local-setup seeds localization data under
    //    tenantId=pg, so this will pass. On other environments, the data may
    //    live under a different tenant — use a soft assertion.
    const totalMessages = localizationRequests.reduce(
      (sum, r) => sum + (r.response?.messages?.length ?? 0),
      0,
    );
    test.info().annotations.push({
      type: 'localization-messages',
      description: `Total messages received: ${totalMessages}`,
    });
    expect.soft(
      totalMessages,
      'Localization API returned no messages — check seed data for tenantId=pg',
    ).toBeGreaterThan(0);

    // 4. The core login labels must NOT appear as raw keys.
    //    When the locale is broken (en_IN_IN), ALL labels show as raw keys
    //    like "CORE_COMMON_LOGIN" instead of "Login". Check the login-critical
    //    keys specifically — these are the direct symptom of the locale bug.
    const bodyText = await page.locator('body').innerText();
    const loginRawKeys = ['CORE_COMMON_LOGIN', 'CORE_LOGIN_USERNAME', 'CORE_LOGIN_PASSWORD'];
    for (const rawKey of loginRawKeys) {
      expect(
        bodyText,
        `Raw key "${rawKey}" visible on page — localization is broken`,
      ).not.toContain(rawKey);
    }

    // 5. A translated login-related label is visible (submit button rendered)
    const loginButton = page.locator('button[type="submit"], input[type="submit"]');
    await expect(loginButton.first()).toBeVisible({ timeout: 10_000 });
  });

  test('city dropdown shows translated tenant names', async ({ page }) => {
    await page.goto('/digit-ui/employee/user/login');

    // Wait for login form to render
    const loginForm = page.locator('form, [class*="login"], [class*="Login"]');
    await expect(loginForm.first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2_000);

    // DIGIT UI uses a custom dropdown component — find and open it.
    // The city dropdown is typically a div with "dropdown" in its class,
    // or a react-select-like component near the "City" label.
    const dropdownTrigger = page.locator(
      '[class*="dropdown"] [class*="option"], [class*="Dropdown"] [class*="option"], ' +
      '[class*="select"] [class*="placeholder"], [class*="Select"] [class*="placeholder"], ' +
      '[class*="dropdown"], [class*="Dropdown"]'
    ).first();
    await expect(dropdownTrigger).toBeVisible({ timeout: 10_000 });
    await dropdownTrigger.click();

    // Wait for dropdown options to appear
    await page.waitForTimeout(1_000);

    // Collect all visible dropdown option texts — DIGIT renders options as
    // divs within a dropdown menu container
    const optionTexts = await page.locator(
      '[class*="option"], [class*="Option"], [class*="menu"] div[id*="option"], ' +
      '[class*="MenuList"] div, [class*="menu-list"] div'
    ).allInnerTexts();

    // Filter out empty strings
    const nonEmptyOptions = optionTexts.filter((t) => t.trim().length > 0);

    test.info().annotations.push({
      type: 'dropdown-options',
      description: `Dropdown options: ${nonEmptyOptions.join(', ')}`,
    });

    // No option should show a raw TENANT_TENANTS_* key
    const rawKeyPattern = /^TENANT_TENANTS_/;
    for (const optionText of nonEmptyOptions) {
      expect(
        optionText,
        `Dropdown option shows raw key "${optionText}" — tenant localization missing`,
      ).not.toMatch(rawKeyPattern);
    }

    // At least one known city name should be present
    const knownCityNames = ['City A', 'City B', 'Demo', 'State A', 'CI Test', 'My Tenant'];
    const hasKnownCity = nonEmptyOptions.some((opt) =>
      knownCityNames.some((city) => opt.includes(city)),
    );
    expect(
      hasKnownCity,
      `Expected at least one known city name in dropdown options: ${nonEmptyOptions.join(', ')}`,
    ).toBe(true);
  });

  test('login and verify internal page localization', async ({ page }) => {
    await page.goto('/digit-ui/employee/user/login');

    // Wait for login form to render
    const loginForm = page.locator('form, [class*="login"], [class*="Login"]');
    await expect(loginForm.first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2_000);

    // Step 1: Fill login credentials using role-based locators
    // The field is labeled "Mobile Number" but DIGIT login uses the username field.
    // The ADMIN user has username "ADMIN" (not the mobile number).
    await page.getByRole('textbox', { name: 'Mobile Number' }).fill('ADMIN');
    await page.getByRole('textbox', { name: 'Password' }).fill('eGov@123');

    // Step 2: Select city — DIGIT's React form may clear the city dropdown
    // during re-renders, so we explicitly select it after filling credentials.
    // The ADMIN user is seeded under tenant pg (city "Demo").
    const cityInput = page.getByRole('textbox', { name: 'City' });
    await cityInput.click();
    await page.waitForTimeout(500);
    await page.locator('[class*="option"], [class*="Option"]')
      .filter({ hasText: 'Demo' }).first().click({ timeout: 5_000 });
    await page.waitForTimeout(500);

    // Step 3: Accept Privacy Policy checkbox (required before login)
    await page.getByRole('checkbox').first().check();

    // Step 4: Click login — verify the button is enabled first
    const loginBtn = page.getByRole('button', { name: 'Login' });
    await expect(loginBtn).toBeEnabled({ timeout: 5_000 });
    await loginBtn.click();

    // Step 5: Wait for redirect away from login page
    // After successful login, the URL changes away from /user/login
    await page.waitForURL((url) => !url.pathname.includes('/user/login'), {
      timeout: 30_000,
    });

    // Wait for post-login page to stabilize (localization loads async)
    await page.waitForTimeout(3_000);

    const postLoginUrl = page.url();
    test.info().annotations.push({
      type: 'post-login-url',
      description: `Redirected to: ${postLoginUrl}`,
    });

    // Step 5: Check that the page doesn't show raw localization keys
    const bodyText = await page.locator('body').innerText();

    // Navigation/sidebar elements should not show raw keys.
    // Raw keys follow patterns like CORE_COMMON_*, ACTION_TEST_*, CS_*, etc.
    // Use soft assertions since not every key may be seeded yet.
    const criticalRawKeys = [
      'CORE_COMMON_HOME',
      'ACTION_TEST_COMPLAINTS',
      'CS_HEADER_COMPLAINT',
      'CS_HOME_HEADER',
      'ACTION_TEST_SEARCH_COMPLAINT',
      'ACTION_TEST_HRMS',
      'TOTAL_EMPLOYEES',
      'ACTIVE_EMPLOYEES',
      'HR_HOME_SEARCH_RESULTS_HEADING',
      'HR_COMMON_CREATE_EMPLOYEE_HEADER',
      'CONFIGURE_MASTER',
      'ACTION_TEST_WORKBENCH',
      'ACTION_TEST_MDMS',
      'ACTION_TEST_LOCALISATION',
    ];
    for (const rawKey of criticalRawKeys) {
      expect.soft(
        bodyText,
        `Raw key "${rawKey}" visible on post-login page — localization may be missing`,
      ).not.toContain(rawKey);
    }

    // General check: look for clusters of uppercase-underscore patterns
    // that suggest untranslated keys (5+ chars, all uppercase with underscores)
    const rawKeyMatches = bodyText.match(/\b[A-Z][A-Z0-9_]{7,}\b/g) || [];
    // Filter to only keys that look like localization keys (contain at least one underscore)
    const localizationKeyLike = rawKeyMatches.filter((k) => k.includes('_'));

    test.info().annotations.push({
      type: 'raw-keys-found',
      description: `Potential raw keys on post-login page: ${localizationKeyLike.length} (${localizationKeyLike.slice(0, 10).join(', ')}${localizationKeyLike.length > 10 ? '...' : ''})`,
    });

    // Soft assertion: with all major modules seeded (rainmaker-common, pgr,
    // hrms, hr, workbench), very few raw keys should remain. Threshold of 5
    // catches regressions while allowing for edge cases.
    expect.soft(
      localizationKeyLike.length,
      `Found ${localizationKeyLike.length} potential raw localization keys on post-login page`,
    ).toBeLessThan(5);
  });
});
