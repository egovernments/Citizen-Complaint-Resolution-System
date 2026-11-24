/**
 * #224 for citizens: a citizen's login lives in THIS browser tab only, like an
 * employee's. Reloading the tab keeps it; closing the tab ends it; a new tab
 * asks for the OTP again; and no token or personal detail is left in
 * localStorage. There is no idle sign-out for citizens.
 *
 * Logs in through the real citizen login (mobile number → fixed dev OTP), so it
 * needs a stack with CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED and a registered
 * citizen (CITIZEN_MOBILE / CITIZEN_OTP, see utils/citizen-auth.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { citizenOtpLogin } from '../../utils/citizen-auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
// A page only a signed-in citizen may open (PrivateRoute → citizen login).
const MY_COMPLAINTS = `${BASE_URL}/digit-ui/citizen/pgr/complaints`;
const CREDENTIAL_KEYS = ['token', 'Citizen.token', 'user-info', 'Citizen.user-info', 'Citizen.refresh-token', 'citizen.userRequestObject'];
const onCitizenLogin = (url: string) => /\/citizen\/login/.test(url);

const credentialsIn = (page: Page, store: 'localStorage' | 'sessionStorage') =>
  page.evaluate(
    ({ keys, store }) => keys.filter((k) => (store === 'localStorage' ? localStorage : sessionStorage).getItem(k) != null),
    { keys: CREDENTIAL_KEYS, store },
  );

async function expectStillSignedIn(page: Page) {
  await page.waitForTimeout(3000);
  expect(onCitizenLogin(page.url()), `expected to stay signed in, got ${page.url()}`).toBe(false);
}

test.describe('#224 citizen session is tab-only', () => {
  test('login: the token stays in the tab, nothing in localStorage', async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page);
    expect(await credentialsIn(page, 'sessionStorage')).toEqual(expect.arrayContaining(['Citizen.token', 'Citizen.user-info']));
    expect(await credentialsIn(page, 'localStorage')).toEqual([]);
  });

  test('reloading the same tab keeps the citizen signed in', async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page);
    await page.goto(MY_COMPLAINTS, { waitUntil: 'domcontentloaded' });
    await expectStillSignedIn(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectStillSignedIn(page);
  });

  test('a new tab does not inherit the login', async ({ context, page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page);
    const second = await context.newPage();
    await second.goto(MY_COMPLAINTS, { waitUntil: 'domcontentloaded' });
    await second.waitForURL((u) => onCitizenLogin(u.toString()), { timeout: 30_000 });
  });

  test('a citizen login an older build left in localStorage is not used, and is removed', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE_URL}/digit-ui/citizen/select-language`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const info = JSON.stringify({ uuid: 'old-build-citizen', name: 'Old Build', type: 'CITIZEN', tenantId: 'x' });
      localStorage.setItem('token', 'old-build-token');
      localStorage.setItem('Citizen.token', 'old-build-token');
      localStorage.setItem('user-info', info);
      localStorage.setItem('Citizen.user-info', info);
      localStorage.setItem('citizen.userRequestObject', info);
    });
    await page.goto(MY_COMPLAINTS, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((u) => onCitizenLogin(u.toString()), { timeout: 30_000 });
    expect(await credentialsIn(page, 'localStorage')).toEqual([]);
  });

  test('logout leaves no citizen credential in either storage', async ({ page }) => {
    test.setTimeout(120_000);
    await citizenOtpLogin(page);
    await page.evaluate(() => (window as unknown as { Digit: { UserService: { logout: () => void } } }).Digit.UserService.logout());
    await page.waitForURL((u) => onCitizenLogin(u.toString()), { timeout: 30_000 });
    await page.waitForTimeout(2000);
    expect(await credentialsIn(page, 'localStorage')).toEqual([]);
    expect(await credentialsIn(page, 'sessionStorage')).toEqual([]);
  });
});
