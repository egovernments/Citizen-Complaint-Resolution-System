import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { EmployeeHomePage } from '../pages/employee-home.page';
import { getKcToken } from '../utils/auth';

const BASE_URL = process.env.BASE_URL || 'http://localhost:18080';

test.describe('Employee Login — API', () => {
  test('KC ROPC endpoint accepts valid credentials', async () => {
    const tokenResponse = await getKcToken({
      baseURL: BASE_URL,
      tenant: 'pg.citya',
      username: 'ADMIN',
      password: 'eGov@123',
    });

    expect(tokenResponse.access_token).toBeTruthy();
    expect(tokenResponse.access_token.split('.')).toHaveLength(3);
  });

  test('KC ROPC rejects bad credentials', async () => {
    await expect(
      getKcToken({
        baseURL: BASE_URL,
        tenant: 'pg.citya',
        username: 'ADMIN',
        password: 'wrong-password',
      }),
    ).rejects.toThrow(/KC ROPC failed/);
  });
});

test.describe('Employee Login — Form', () => {
  test('renders unified login form', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.waitForReady();

    await expect(login.usernameInput).toBeVisible();
    await expect(login.passwordInput).toBeVisible();
    await expect(login.submitButton).toBeVisible();
  });

  test('logs in as ADMIN and redirects to /employee', async ({ page }) => {
    const login = new LoginPage(page);
    await login.login('pg.citya', 'ADMIN', 'eGov@123');

    const home = new EmployeeHomePage(page);
    await home.waitForLoad();
    expect(page.url()).toContain('/employee');
  });

  test('populates session storage after login', async ({ page }) => {
    const login = new LoginPage(page);
    await login.login('pg.citya', 'ADMIN', 'eGov@123');

    const home = new EmployeeHomePage(page);
    await home.waitForLoad();

    const session = await home.getSessionData();
    expect(session.employeeToken).toBeTruthy();
    expect(session.employeeTenantId).toBe('pg.citya');
    expect(session.employeeUserInfo).toBeTruthy();
  });
});
