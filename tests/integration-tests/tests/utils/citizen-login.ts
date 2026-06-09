/**
 * Citizen OTP login helper.
 *
 * Defaults to driving the legacy /user/oauth/token API directly and
 * injecting the resulting token into localStorage — this works on every
 * DIGIT deployment, including ones with the Keycloak SSO overlay enabled
 * (bomet) where the digit-ui UI flow routes through KC and fails when KC
 * isn't fully wired up.
 *
 * The original UI-driven helper is preserved as `citizenOtpLoginViaUI`
 * for the (rare) tests that need to exercise the actual login form on
 * non-KC deployments.
 */
import type { Page } from '@playwright/test';
import { BASE_URL, FIXED_OTP, ROOT_TENANT, DEFAULT_PASSWORD } from './env';

/**
 * Citizen login via direct OAuth — same shape as `loginViaApi` for employees.
 *
 * Steps:
 *  1. Send OTP via /user-otp/v1/_send (no-op on mock-OTP deployments).
 *  2. Try /user/oauth/token with `password=FIXED_OTP` (works when the
 *     mock-OTP feature flag is on, e.g. naipepea).
 *  3. If that fails, register via /user/citizen/_create with
 *     `password=DEFAULT_PASSWORD` and retry login using both FIXED_OTP
 *     and DEFAULT_PASSWORD (covers both the mock-OTP-accepts-always and
 *     password-only deployments).
 *  4. Inject the access_token + user info into localStorage with the
 *     keys the citizen digit-ui SPA reads on bootstrap.
 *  5. Navigate to /digit-ui/citizen so the SPA picks up the auth state.
 */
/**
 * Intercept `/digit-ui/globalConfigs.js` and force `authProvider = "digit"`.
 *
 * Some deployments (e.g. bomet) ship the SPA with `authProvider = "keycloak"`
 * and `tokenExchangeUrl = "/kc"`, which makes every subsequent API call go
 * through the `/kc/*` token-exchange proxy. When the test logs in via the
 * legacy /user/oauth/token path (which works everywhere), the SPA has no
 * valid KC session — every /kc/<service>/... call returns 502 and the SPA
 * gives up and routes to /citizen/error.
 *
 * Rewriting the runtime config to `authProvider = "digit"` makes the SPA
 * call the bare service paths (/mdms-v2, /pgr-services, /boundary-service)
 * directly, which work with the legacy token. This is a TEST-ONLY override
 * for the page session.
 */
async function forceDigitAuthProvider(page: Page): Promise<void> {
  await page.route('**/digit-ui/globalConfigs.js', async (route) => {
    const resp = await route.fetch();
    let body = await resp.text();
    // Flip to digit-native auth + drop the /kc prefix.
    body = body
      .replace(/var\s+authProvider\s*=\s*"keycloak"\s*;/, 'var authProvider = "digit";')
      .replace(/(if\s*\(\s*!\s*tokenExchangeUrl\s*\)\s*\{\s*tokenExchangeUrl\s*=\s*)"\/kc"/, '$1""');
    await route.fulfill({
      status: resp.status(),
      headers: resp.headers(),
      contentType: 'application/javascript',
      body,
    });
  });
}

export async function citizenLoginViaApi(page: Page, phone: string): Promise<void> {
  page.on('pageerror', (err) => console.log(`[PAGE ERROR in login] ${err.message}`));
  await forceDigitAuthProvider(page);

  // 1. Send OTP (mock or real — both are fine).
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: phone, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  });

  const oauthLogin = async (password: string): Promise<Response> =>
    fetch(`${BASE_URL}/user/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: phone,
        password,
        tenantId: ROOT_TENANT,
        scope: 'read',
        userType: 'CITIZEN',
      }).toString(),
    });

  // 2. Try login with FIXED_OTP (works on naipepea-style mock-OTP setups).
  let resp = await oauthLogin(FIXED_OTP);

  if (!resp.ok) {
    // 3a. Citizen doesn't exist — register, then retry login.
    const citizenBody = {
      RequestInfo: { apiId: 'Rainmaker' },
      user: {
        name: `Test Citizen ${phone}`,
        userName: phone,
        mobileNumber: phone,
        password: DEFAULT_PASSWORD,
        tenantId: ROOT_TENANT,
        type: 'CITIZEN',
        roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: ROOT_TENANT }],
        otpReference: FIXED_OTP,
      },
    };
    for (const url of [`${BASE_URL}/user/citizen/_create`, `${BASE_URL}/user/users/_createnovalidate`]) {
      const cr = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(citizenBody),
      });
      if (cr.ok) break;
    }
    // 3b. Retry login — try mock-OTP password first, then the real password.
    for (const pwd of [FIXED_OTP, DEFAULT_PASSWORD]) {
      resp = await oauthLogin(pwd);
      if (resp.ok) break;
    }
  }

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`citizen OAuth login failed for ${phone}: HTTP ${resp.status} body=${body.slice(0, 300)}`);
  }
  const tok: any = await resp.json();
  if (!tok.access_token) {
    throw new Error(`citizen OAuth login OK but no access_token: ${JSON.stringify(tok).slice(0, 300)}`);
  }

  // 4. Hop onto the citizen origin so localStorage writes land on the
  //    right Origin, then inject the token + user info.
  await page.goto(`${BASE_URL}/digit-ui/citizen/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.evaluate(
    ({ token, userInfo, tenant }) => {
      // citizen-flow keys (the digit-ui SPA reads these on bootstrap)
      localStorage.setItem('Citizen.token', token);
      localStorage.setItem('Citizen.tenant-id', tenant);
      localStorage.setItem('Citizen.user-info', JSON.stringify(userInfo));
      localStorage.setItem('Citizen.locale', 'en_IN');
      // legacy generic keys some screens still read
      localStorage.setItem('token', token);
      localStorage.setItem('tenant-id', tenant);
      localStorage.setItem('user-info', JSON.stringify(userInfo));
      localStorage.setItem('locale', 'en_IN');
    },
    {
      token: tok.access_token,
      userInfo: tok.UserRequest || {},
      tenant: ROOT_TENANT,
    },
  );

  // 5. Bounce to the home so the SPA re-bootstraps with the injected auth.
  await page.goto(`${BASE_URL}/digit-ui/citizen`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  // Allow the SPA hash-router to settle into /all-services.
  await page.waitForTimeout(2000);
}

/** Default export used by every spec — uses the OAuth API path. */
export async function citizenOtpLogin(page: Page, phone: string): Promise<void> {
  return citizenLoginViaApi(page, phone);
}

/**
 * Original UI-driven OTP flow. Kept available for tests that explicitly
 * need to exercise the digit-ui login form (rare). Most consumers should
 * use {@link citizenOtpLogin} which routes through {@link citizenLoginViaApi}.
 */
export async function citizenOtpLoginViaUI(page: Page, phone: string): Promise<void> {
  page.on('pageerror', (err) => console.log(`[PAGE ERROR in login] ${err.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) console.log(`[HTTP ${response.status()}] ${response.url()}`);
  });

  await page.goto(`${BASE_URL}/digit-ui/citizen/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  // The citizen login form has gone through several DOM revisions. Match
  // any of the known shapes so the helper survives minor UI churn:
  //   - current digit-ui:  <input id="login-mobile" type="tel">
  //   - older revisions:   <input name="mobileNumber"> or input[type="tel"]
  const mobileInput = page.locator(
    'input#login-mobile, input[name="mobileNumber"], input[type="tel"]',
  ).first();
  await mobileInput.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(2000);

  // Enter phone number
  await mobileInput.click();
  await mobileInput.type(phone, { delay: 30 });
  await page.waitForTimeout(500);

  // The submit button label has shifted across digit-ui revisions:
  // "Continue" (current) vs "NEXT" / "Next" / "CS_COMMONS_NEXT" (older).
  await page.locator('button:visible').filter({ hasText: /Continue|NEXT|Next|CS_COMMONS_NEXT/ }).click();
  await page.waitForTimeout(5000);

  // Enter 6-digit OTP
  const otpInputs = page.locator('input[maxlength="1"]');
  await otpInputs.first().waitFor({ state: 'visible', timeout: 10_000 });
  for (let i = 0; i < FIXED_OTP.length; i++) {
    await otpInputs.nth(i).click();
    await otpInputs.nth(i).type(FIXED_OTP[i]);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(1000);

  // Submit OTP — current digit-ui on Kenya deployments renders this as
  // "Continue"; older revisions used NEXT / Next / CS_COMMONS_NEXT.
  await page.locator('button:visible').filter({ hasText: /Continue|NEXT|Next|CS_COMMONS_NEXT/ }).click();
  await page.waitForTimeout(5000);

  // Handle city selection page if it appears
  const url = page.url();
  if (url.includes('select-location')) {
    console.log('City selection page — picking city...');
    await page.waitForTimeout(2000);
    const cityDropdown = page.locator('input.digit-dropdown-employee-select-wrap--elipses');
    const cityRadio = page.locator('input[type="radio"]');
    if (await cityDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cityDropdown.click();
      await page.waitForTimeout(1000);
      await page.locator('.digit-dropdown-item').first().click();
      await page.waitForTimeout(500);
    } else if (await cityRadio.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await cityRadio.first().click();
      await page.waitForTimeout(500);
    }
    const submitBtn = page.locator('button:visible').filter({ hasText: /Continue|Submit|Next/i }).first();
    await submitBtn.click();
    await page.waitForTimeout(5000);
  } else {
    await page.waitForTimeout(3000);
  }
}
