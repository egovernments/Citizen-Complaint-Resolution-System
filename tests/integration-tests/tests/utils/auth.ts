/**
 * DIGIT auth utilities — token acquisition and session injection.
 */
import { BASE_URL } from './env';

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
  /** Override the tenant used for OAuth (defaults to root derived from tenant). */
  authTenant?: string;
  username: string;
  password: string;
  userType?: 'EMPLOYEE' | 'CITIZEN';
}

/** Acquire a DIGIT access token via /user/oauth/token (ROPC grant). */
export async function getDigitToken(config: AuthConfig): Promise<TokenResponse> {
  const baseURL = config.baseURL || BASE_URL;
  const resp = await fetch(`${baseURL}/user/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
    },
    body: new URLSearchParams({
      grant_type: 'password',
      username: config.username,
      password: config.password,
      tenantId: config.tenant,
      scope: 'read',
      userType: config.userType || 'EMPLOYEE',
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Auth failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<TokenResponse>;
}

/** Login via API token injection — bypasses the UI login form. */
export async function loginViaApi(
  page: import('@playwright/test').Page,
  config: AuthConfig,
): Promise<TokenResponse> {
  const baseURL = config.baseURL || BASE_URL;
  // Auth against root tenant (ADMIN lives at root), but inject city tenant into UI
  const rootTenant = config.authTenant || (config.tenant.includes('.') ? config.tenant.split('.')[0] : config.tenant);
  const tokenResponse = await getDigitToken({ ...config, tenant: rootTenant });

  await page.goto(`${baseURL}/digit-ui/employee/user/login`, {
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

  await page.goto(`${baseURL}/digit-ui/employee`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  return tokenResponse;
}
