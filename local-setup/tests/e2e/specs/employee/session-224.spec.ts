/**
 * #224 (VAPT "Insecure Session Management"): an employee's login lives in the
 * browser tab only, and an idle employee is logged out.
 *
 *  - no token or personal data in localStorage after login
 *  - reloading the tab keeps the login; a new tab / a closed-and-reopened tab
 *    does not (it asks for login)
 *  - a token an older build left in localStorage is neither used nor kept
 *  - 15 minutes with no activity logs the employee out; activity resets it;
 *    coming back after the limit logs out even if the user moves the mouse
 *  - an invalid token goes to the login page, not to an error screen
 *  - logout leaves no employee credential behind
 *
 * Idle cases use Playwright's clock, so they run in seconds.
 */
import { test, expect, type Page } from '@playwright/test';
import { getDigitToken, injectCitizenSession, injectEmployeeSession, loginViaApi } from '../../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const TENANT = process.env.DIGIT_TENANT || 'uitest.citya';
const USER = process.env.DIGIT_USERNAME || 'ADMIN';
const PASS = process.env.DIGIT_PASSWORD || 'eGov@123';
const CFG = { baseURL: BASE_URL, tenant: TENANT, username: USER, password: PASS };

const CREDENTIAL_KEYS = ['Employee.token', 'token', 'Employee.user-info', 'user-info', 'Employee.refresh-token', 'citizen.userRequestObject'];

/** On the employee login / language screen (where a signed-out employee lands). */
const onSignInScreen = (url: string) => /\/employee\/user\/(login|language-selection)/.test(url);

async function storage(page: Page) {
  return page.evaluate((keys) => {
    const pick = (s: Storage) => Object.fromEntries(keys.map((k) => [k, s.getItem(k)]));
    return { local: pick(localStorage), session: pick(sessionStorage), digitUser: sessionStorage.getItem('Digit.User') };
  }, CREDENTIAL_KEYS);
}

async function expectNoCredentialInLocalStorage(page: Page) {
  const { local } = await storage(page);
  for (const k of CREDENTIAL_KEYS) expect(local[k], `localStorage["${k}"]`).toBeNull();
}

/** Signed in: on an employee page that is not the login/language screen. */
async function expectSignedIn(page: Page) {
  await page.waitForTimeout(3000);
  expect(page.url()).toContain('/employee');
  expect(onSignInScreen(page.url()), `expected to stay signed in, got ${page.url()}`).toBe(false);
}

async function expectSentToSignIn(page: Page, timeout = 30_000) {
  await page.waitForURL((u) => onSignInScreen(u.toString()), { timeout });
}

/**
 * Signs in through the real v2 login card, so the APP decides where the session
 * is stored (the API helper would bypass exactly what these tests check).
 * LoginPage's input[name="username"] selectors predate the v2 card.
 */
async function loginViaForm(page: Page) {
  await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'User Name' }).fill(USER, { timeout: 45_000 });
  await page.getByRole('textbox', { name: 'Password' }).fill(PASS);
  // Privacy consent is a custom-drawn checkbox: click it like a user does.
  const consent = page.getByRole('checkbox').first();
  if (await consent.count()) {
    await consent.click({ force: true });
    if (!(await consent.isChecked())) await page.getByText(/I agree/i).first().click();
  }
  const loginButton = page.getByRole('button', { name: 'Login', exact: true });
  await expect(loginButton).toBeEnabled({ timeout: 10_000 });
  await loginButton.click();
  await page.waitForURL((u) => u.toString().includes('/employee') && !onSignInScreen(u.toString()), { timeout: 60_000 });
}

test.describe('#224 employee session is tab-only', () => {
  test('login form: credentials stay in the tab, nothing in localStorage', async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaForm(page);

    const s = await storage(page);
    expect(s.session['Employee.token']).toBeTruthy();
    expect(JSON.parse(s.session['Employee.user-info'] as string).userName).toBeTruthy();
    await expectNoCredentialInLocalStorage(page);
  });

  test('reloading the same tab keeps the employee signed in', async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaForm(page);
    await expectSignedIn(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectSignedIn(page);
  });

  test('a new tab does not inherit the login', async ({ context, page }) => {
    test.setTimeout(120_000);
    await loginViaForm(page);
    await expectSignedIn(page);

    const second = await context.newPage();
    await second.goto(`${BASE_URL}/digit-ui/employee`, { waitUntil: 'domcontentloaded' });
    await expectSentToSignIn(second);
    await expectNoCredentialInLocalStorage(second);
  });

  test('closing the tab ends the login (reopening the site asks for login)', async ({ context, page }) => {
    test.setTimeout(120_000);
    await loginViaForm(page);
    await expectSignedIn(page);
    await page.close();

    const reopened = await context.newPage();
    await reopened.goto(`${BASE_URL}/digit-ui/employee`, { waitUntil: 'domcontentloaded' });
    await expectSentToSignIn(reopened);
  });

  test('a token an older build left in localStorage is not used, and is removed', async ({ page }) => {
    const { access_token: token, UserRequest } = await getDigitToken(CFG);
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ token, info, tenant }) => {
      // Exactly what the pre-#224 login wrote.
      localStorage.setItem('Employee.token', token);
      localStorage.setItem('Employee.user-info', JSON.stringify(info));
      localStorage.setItem('token', token);
      localStorage.setItem('user-info', JSON.stringify(info));
      localStorage.setItem('Employee.tenant-id', tenant);
    }, { token, info: UserRequest || {}, tenant: TENANT });

    await page.goto(`${BASE_URL}/digit-ui/employee`, { waitUntil: 'domcontentloaded' });
    await expectSentToSignIn(page);
    await expectNoCredentialInLocalStorage(page);
  });
});

test.describe('#224 idle logout', () => {
  test('15 minutes with no activity logs the employee out, and keeps a citizen in another tab and drafts', async ({ context, page }) => {
    test.setTimeout(120_000);
    await page.clock.install();
    // A citizen signed in on the same browser, in another tab (a citizen's login
    // is tab-only too), + a saved complaint draft: idle logout must end ONLY the
    // employee's tab login (no localStorage.clear()).
    const citizenTab = await context.newPage();
    await citizenTab.goto(`${BASE_URL}/digit-ui/citizen/select-language`, { waitUntil: 'domcontentloaded' });
    await injectCitizenSession(citizenTab, {
      token: 'citizen-224',
      userInfo: { uuid: 'citizen-224', name: 'Citizen 224', type: 'CITIZEN', tenantId: TENANT },
      tenant: TENANT,
    });
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('Digit.PGR_CREATE_CITIZEN_DRAFT', JSON.stringify({ value: { note: 'draft-224' } }));
    });
    const { access_token: employeeToken } = await loginViaApi(page, CFG);
    await expectSignedIn(page);

    await page.clock.fastForward('14:00');
    await expectSignedIn(page);
    await page.clock.fastForward('01:30');
    await expectSentToSignIn(page);
    const s = await storage(page);
    expect(s.session['Employee.token']).toBeNull();
    // After the redirect the app writes a blank session record; it must no
    // longer hold the EMPLOYEE's token.
    const sessionToken = s.digitUser ? JSON.parse(s.digitUser).value?.access_token ?? null : null;
    expect(sessionToken).not.toBe(employeeToken);
    const draft = await page.evaluate(() => localStorage.getItem('Digit.PGR_CREATE_CITIZEN_DRAFT'));
    expect(draft).toContain('draft-224');
    expect(await citizenTab.evaluate(() => sessionStorage.getItem('Citizen.token'))).toBe('citizen-224');
  });

  test('activity within the limit keeps the session', async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install();
    await loginViaApi(page, CFG);
    await expectSignedIn(page);

    for (let i = 0; i < 3; i += 1) {
      await page.clock.fastForward('10:00');
      await page.mouse.move(50 + i * 10, 50);
      await page.keyboard.press('Shift');
    }
    await expectSignedIn(page); // 30 minutes in, never 15 idle
  });

  test('coming back after the limit logs out, even if the first thing is a mouse move', async ({ page }) => {
    test.setTimeout(120_000);
    await page.clock.install();
    await loginViaApi(page, CFG);
    await expectSignedIn(page);

    // Time jumps 20 minutes WITHOUT firing any timer (tab asleep / laptop shut),
    // so nothing has logged out yet; the user's first mouse move must.
    const now = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(now + 20 * 60 * 1000);
    expect(onSignInScreen(page.url()), 'no timer may have fired yet').toBe(false);
    await page.mouse.move(200, 200);
    await expectSentToSignIn(page);
  });

  test('a restored tab whose last activity is older than the limit is logged out on load', async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaForm(page);
    await expectSignedIn(page);
    // As if the tab was closed 20 minutes ago and brought back (Ctrl+Shift+T):
    // the browser restores the tab's sessionStorage, but the shared last-activity
    // time is 20 minutes old.
    await page.evaluate(() => localStorage.setItem('Digit.EmployeeLastActivity', String(Date.now() - 20 * 60 * 1000)));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectSentToSignIn(page);
  });

  test('a reload within the limit keeps the session', async ({ page }) => {
    test.setTimeout(120_000);
    await loginViaForm(page);
    await expectSignedIn(page);
    await page.evaluate(() => localStorage.setItem('Digit.EmployeeLastActivity', String(Date.now() - 5 * 60 * 1000)));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectSignedIn(page);
  });
});

test.describe('#224 expired login and logout', () => {
  test('an invalid token goes to the login page, not an error screen', async ({ page }) => {
    const { UserRequest } = await getDigitToken(CFG);
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded' });
    await injectEmployeeSession(page, { token: 'invalid-token-224', userInfo: (UserRequest || {}) as Record<string, unknown>, tenant: TENANT });
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/inbox-v2`, { waitUntil: 'domcontentloaded' });
    await expectSentToSignIn(page, 45_000);
    expect(page.url()).not.toContain('/error');
  });

  test('logout leaves no employee credential in either storage', async ({ page }) => {
    await loginViaApi(page, CFG);
    await expectSignedIn(page);
    await page.evaluate(() => (window as unknown as { Digit: { UserService: { logout: () => void } } }).Digit.UserService.logout());
    await expectSentToSignIn(page);
    const s = await storage(page);
    for (const k of CREDENTIAL_KEYS) {
      expect(s.local[k], `localStorage["${k}"]`).toBeNull();
      expect(s.session[k], `sessionStorage["${k}"]`).toBeNull();
    }
  });
});
