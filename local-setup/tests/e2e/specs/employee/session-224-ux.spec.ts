/**
 * #224 follow-up: making the tab-only employee login easier to live with,
 * without weakening it.
 *
 *  1. a warning a minute before the idle sign-out, with "Stay signed in"
 *  2. after signing in again, back to the page the employee was on
 *  3. the login page says why the employee was signed out
 *  4. the inbox's "Open in new tab" opens the complaint already signed in
 *  5. logging out in one tab signs the employee out of the others
 *
 * Plus guards that the #224 protections still hold: a tab the employee opens
 * by themselves still asks for login, and the return path cannot leave the app.
 * Idle cases use Playwright's clock, as in session-224.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { getDigitToken, injectEmployeeSession, loginViaApi } from '../../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const TENANT = process.env.DIGIT_TENANT || 'uitest.citya';
const USER = process.env.DIGIT_USERNAME || 'ADMIN';
const PASS = process.env.DIGIT_PASSWORD || 'eGov@123';
const CFG = { baseURL: BASE_URL, tenant: TENANT, username: USER, password: PASS };

const onSignInScreen = (url: string) => /\/employee\/user\/(login|language-selection)/.test(url);

async function expectSignedIn(page: Page) {
  await page.waitForTimeout(3000);
  expect(page.url()).toContain('/employee');
  expect(onSignInScreen(page.url()), `expected to stay signed in, got ${page.url()}`).toBe(false);
}

async function expectSentToSignIn(page: Page, timeout = 30_000) {
  await page.waitForURL((u) => onSignInScreen(u.toString()), { timeout });
}

const warningDialog = (page: Page) => page.getByText('Are you still there?');

/** Fills the login card on the page we are already on (keeps its ?reason&from). */
async function signInHere(page: Page) {
  await page.getByRole('textbox', { name: 'User Name' }).fill(USER, { timeout: 45_000 });
  await page.getByRole('textbox', { name: 'Password' }).fill(PASS);
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

test.describe('#224 follow-up: idle warning', () => {
  test('a warning appears before the idle sign-out, and "Stay signed in" keeps the session', async ({ page }) => {
    test.setTimeout(150_000);
    await page.clock.install();
    await loginViaApi(page, CFG);
    await expectSignedIn(page);

    await page.clock.fastForward('13:30');
    await expect(warningDialog(page)).toHaveCount(0);
    await page.clock.fastForward('00:45'); // 14:15 — inside the last minute
    await expect(warningDialog(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Signing out in/)).toBeVisible();

    await page.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(warningDialog(page)).toHaveCount(0, { timeout: 10_000 });

    await page.clock.fastForward('10:00'); // a fresh 15 minutes from the click
    await expectSignedIn(page);
    await expect(warningDialog(page)).toHaveCount(0);
  });

  test('moving the mouse does not close the warning, and "Sign out now" signs out', async ({ page }) => {
    test.setTimeout(150_000);
    await page.clock.install();
    await loginViaApi(page, CFG);
    await expectSignedIn(page);

    await page.clock.fastForward('14:15');
    await expect(warningDialog(page)).toBeVisible({ timeout: 10_000 });
    await page.mouse.move(10, 10);
    await page.mouse.move(400, 300);
    await expect(warningDialog(page)).toBeVisible();

    await page.getByRole('button', { name: 'Sign out now' }).click();
    await expectSentToSignIn(page);
  });

  test('ignoring the warning still signs out at 15 minutes', async ({ page }) => {
    test.setTimeout(150_000);
    await page.clock.install();
    await loginViaApi(page, CFG);
    await expectSignedIn(page);
    await page.clock.fastForward('14:15');
    await expect(warningDialog(page)).toBeVisible({ timeout: 10_000 });
    await page.clock.fastForward('01:00');
    await expectSentToSignIn(page);
  });
});

test.describe('#224 follow-up: login page after a sign-out', () => {
  test('an idle sign-out says why, and signing in again returns to the same page', async ({ page }) => {
    test.setTimeout(180_000);
    await page.clock.install();
    await loginViaApi(page, CFG);
    await expectSignedIn(page);
    const workPage = `${BASE_URL}/digit-ui/employee/pgr/inbox-v2`;
    await page.goto(workPage, { waitUntil: 'domcontentloaded' });
    await expectSignedIn(page);
    const before = new URL(page.url()).pathname;

    await page.clock.fastForward('15:30');
    await expectSentToSignIn(page);
    expect(page.url()).toContain('reason=idle');
    await expect(page.getByRole('status').filter({ hasText: 'had not used CMS' })).toBeVisible({ timeout: 20_000 });

    await page.clock.runFor(1000);
    await signInHere(page);
    await page.waitForURL((u) => new URL(u.toString()).pathname === before, { timeout: 30_000 });
  });

  test('a return path outside the app is ignored after signing in', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto(`${BASE_URL}/digit-ui/employee/user/login?from=${encodeURIComponent('https://example.org/phish')}`, { waitUntil: 'domcontentloaded' });
    await signInHere(page);
    await expectSignedIn(page);
    expect(new URL(page.url()).origin).toBe(new URL(BASE_URL).origin);
    expect(page.url()).not.toContain('example.org');
  });
});

test.describe('#224 follow-up: several tabs', () => {
  test('logging out in one tab signs the employee out of the other, with the reason', async ({ context, page }) => {
    test.setTimeout(150_000);
    await loginViaApi(page, CFG);
    await expectSignedIn(page);
    const second = await context.newPage();
    await loginViaApi(second, CFG);
    await expectSignedIn(second);

    await page.evaluate(() => (window as unknown as { Digit: { UserService: { logout: () => void } } }).Digit.UserService.logout());
    await expectSentToSignIn(page);
    await expectSentToSignIn(second);
    expect(second.url()).toContain('reason=signed-out-elsewhere');
    await expect(second.getByRole('status').filter({ hasText: 'signed out in another tab' })).toBeVisible({ timeout: 20_000 });
  });

  test('a DIFFERENT employee signed in in another tab stays signed in', async ({ context, page }) => {
    test.setTimeout(150_000);
    await loginViaApi(page, CFG);
    await expectSignedIn(page);
    // Tab B: a different employee (same browser, e.g. a shared desk). A real
    // token, but a different identity, is enough for the tab to count as
    // another employee's session.
    const { access_token: token, UserRequest } = await getDigitToken(CFG);
    const second = await context.newPage();
    await second.goto(`${BASE_URL}/digit-ui/employee/user/login`, { waitUntil: 'domcontentloaded' });
    await injectEmployeeSession(second, {
      token,
      userInfo: { ...(UserRequest || {}), uuid: 'another-employee-uuid', name: 'Other Employee' } as Record<string, unknown>,
      tenant: TENANT,
    });
    await second.goto(`${BASE_URL}/digit-ui/employee`, { waitUntil: 'domcontentloaded' });
    await expectSignedIn(second);

    await page.evaluate(() => (window as unknown as { Digit: { UserService: { logout: () => void } } }).Digit.UserService.logout());
    await expectSentToSignIn(page);
    await second.waitForTimeout(5000);
    expect(onSignInScreen(second.url()), `the other employee's tab must stay signed in, got ${second.url()}`).toBe(false);
  });

  test('"Open in new tab" in the inbox opens the complaint already signed in', async ({ context, page }) => {
    test.setTimeout(150_000);
    await loginViaApi(page, CFG);
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/inbox-v2`, { waitUntil: 'domcontentloaded' });
    const button = page.locator('button.pgr-open-new-tab').first();
    const hasRows = await button.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true, () => false);
    test.skip(!hasRows, 'no complaint in this inbox to open');

    const [opened] = await Promise.all([context.waitForEvent('page'), button.click()]);
    await opened.waitForLoadState('domcontentloaded');
    await opened.waitForURL(/\/employee\/pgr\/complaint-details\//, { timeout: 30_000 });
    await expectSignedIn(opened);
  });

  test('a tab opened by the employee (Ctrl+click on the complaint link) still asks for login', async ({ context, page }) => {
    test.setTimeout(150_000);
    await loginViaApi(page, CFG);
    await page.goto(`${BASE_URL}/digit-ui/employee/pgr/inbox-v2`, { waitUntil: 'domcontentloaded' });
    const link = page.locator('a[href*="/employee/pgr/complaint-details/"]').first();
    const hasRows = await link.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true, () => false);
    test.skip(!hasRows, 'no complaint in this inbox');

    const [opened] = await Promise.all([context.waitForEvent('page'), link.click({ modifiers: ['ControlOrMeta'] })]);
    await opened.waitForLoadState('domcontentloaded');
    await expectSentToSignIn(opened);
  });
});
