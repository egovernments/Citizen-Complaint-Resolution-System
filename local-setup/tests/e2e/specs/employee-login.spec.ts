import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { EmployeeHomePage } from '../pages/employee-home.page';
import { getDigitToken } from '../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';
const TENANT = process.env.DIGIT_TENANT || 'uitest.citya';
const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';

test.describe('Employee Login — API', () => {
  test('DIGIT /user/oauth/token accepts valid credentials', async () => {
    const tokenResponse = await getDigitToken({
      baseURL: BASE_URL,
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });

    expect(tokenResponse.access_token).toBeTruthy();
  });

  test('DIGIT /user/oauth/token rejects bad credentials', async () => {
    await expect(
      getDigitToken({
        baseURL: BASE_URL,
        tenant: TENANT,
        username: ADMIN_USER,
        password: 'wrong-password',
      }),
    ).rejects.toThrow();
  });
});

// Form login requires React's FormComposer onSubmit handler to fire.
// Playwright's click on <button type="submit"> triggers native form submission
// (page reload) instead of React's e.preventDefault() + ROPC API call.
test.describe.skip('Employee Login — Form', () => {
  test('renders login form', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.waitForReady();

    // At minimum, some form of input should be visible
    const inputs = page.locator('input');
    expect(await inputs.count()).toBeGreaterThan(0);
  });

  test('logs in as ADMIN and redirects to /employee', async ({ page }) => {
    const login = new LoginPage(page);
    await login.login(TENANT, ADMIN_USER, ADMIN_PASS);

    const home = new EmployeeHomePage(page);
    await home.waitForLoad();
    expect(page.url()).toContain('/employee');
  });

  test('populates session storage after login', async ({ page }) => {
    const login = new LoginPage(page);
    await login.login(TENANT, ADMIN_USER, ADMIN_PASS);

    const home = new EmployeeHomePage(page);
    await home.waitForLoad();

    const session = await home.getSessionData();
    expect(session.employeeToken).toBeTruthy();
    expect(session.employeeUserInfo).toBeTruthy();
  });
});
