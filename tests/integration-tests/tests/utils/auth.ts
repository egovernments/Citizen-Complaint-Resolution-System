/**
 * DIGIT auth utilities — token acquisition and session injection.
 */
import { BASE_URL } from './env';
import { chromium, type Page } from '@playwright/test';
import { hostedSignIn, selectContext, surfacePath } from './identity-bff';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  UserRequest?: Record<string, unknown>;
}

export interface AuthConfig {
  baseURL?: string;
  tenant: string;
  /** Explicit context tenant override retained for existing fixture callers; no parent is derived. */
  authTenant?: string;
  username: string;
  password: string;
  userType?: 'EMPLOYEE' | 'CITIZEN';
}

/** Acquire a DIGIT token through hosted sign-in and the BFF context exchange. */
export async function getDigitToken(config: AuthConfig): Promise<TokenResponse> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    return await staffContext(page, config, 'configurator');
  } finally {
    await browser.close();
  }
}

export async function staffContext(page: Page, config: AuthConfig, surface: 'configurator' | 'employee') {
  if (config.userType === 'CITIZEN') throw new Error('Use citizenSignIn for citizen phone possession');
  const baseURL = config.baseURL || BASE_URL;
  await hostedSignIn(page, { baseURL, surface, username: config.username, password: config.password });
  return selectContext(page.request, baseURL, surface, config.authTenant || config.tenant);
}

/** Keep the caller's BFF cookie and install the selected DIGIT token for business API tests. */
export async function loginViaApi(
  page: import('@playwright/test').Page,
  config: AuthConfig,
): Promise<TokenResponse> {
  const baseURL = config.baseURL || BASE_URL;
  const tokenResponse = await staffContext(page, config, 'employee');

  await page.goto(`${baseURL}${surfacePath('employee', 'user/login')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  await page.evaluate(
    ({ token, userInfo, tenant }) => {
      localStorage.setItem('Employee.token', token);
      localStorage.setItem('Employee.tenant-id', tenant);
      localStorage.setItem('Employee.user-info', JSON.stringify(userInfo));
      localStorage.setItem('Employee.locale', 'en_IN');
      localStorage.setItem('token', token);
      localStorage.setItem('tenant-id', tenant);
      localStorage.setItem('user-info', JSON.stringify(userInfo));
    },
    {
      token: tokenResponse.access_token,
      userInfo: tokenResponse.UserRequest || {},
      tenant: config.tenant,
    },
  );

  await page.goto(`${baseURL}${surfacePath('employee')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  return tokenResponse;
}
