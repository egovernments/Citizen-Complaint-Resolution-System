/**
 * DIGIT standard auth utility (username/password via /user/oauth/token).
 */

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  UserRequest?: {
    uuid: string;
    name: string;
    roles: Array<{ code: string; tenantId: string }>;
  };
}

export interface AuthConfig {
  baseURL: string;
  tenant: string;
  username: string;
  password: string;
  userType?: 'EMPLOYEE' | 'CITIZEN';
}

/**
 * Acquire a DIGIT access token via /user/oauth/token (ROPC grant).
 */
export async function getDigitToken(config: AuthConfig): Promise<TokenResponse> {
  const tokenUrl = `${config.baseURL}/user/oauth/token`;

  const body = new URLSearchParams({
    grant_type: 'password',
    username: config.username,
    password: config.password,
    tenantId: config.tenant,
    scope: 'read',
    userType: config.userType || 'EMPLOYEE',
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`KC ROPC failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<TokenResponse>;
}

/**
 * Puts an employee session into the CURRENT TAB the way the login screens do
 * (#224): token and identity in sessionStorage, plus the Digit.User session
 * record the app reads; only non-secret preferences go to localStorage. The
 * page must already be on the app's origin. A new tab/page starts signed out.
 */
export async function injectEmployeeSession(
  page: import('@playwright/test').Page,
  { token, userInfo, tenant }: { token: string; userInfo: Record<string, unknown>; tenant: string },
): Promise<void> {
  await page.evaluate(
    ({ token, userInfo, tenant }) => {
      // Digit.SessionStorage wraps values as { value, ttl, expiry }.
      const wrap = (value: unknown) => JSON.stringify({ value, ttl: 86400, expiry: Date.now() + 86400 * 1000 });
      sessionStorage.setItem('Employee.token', token);
      sessionStorage.setItem('Employee.user-info', JSON.stringify(userInfo));
      sessionStorage.setItem('token', token);
      sessionStorage.setItem('user-info', JSON.stringify(userInfo));
      sessionStorage.setItem('Digit.User', wrap({ token, access_token: token, info: userInfo }));
      sessionStorage.setItem('Digit.userType', wrap('employee'));
      sessionStorage.setItem('Digit.user_type', wrap('employee'));
      sessionStorage.setItem('Digit.Employee.tenantId', wrap(tenant));
      localStorage.setItem('Employee.tenant-id', tenant);
      localStorage.setItem('tenant-id', tenant);
      localStorage.setItem('Employee.locale', 'en_IN');
    },
    { token, userInfo, tenant },
  );
}

/**
 * Puts a citizen session into the CURRENT TAB the way the citizen login screen
 * does (#224): token and identity in sessionStorage, plus the Digit.User session
 * record the app reads; only non-secret preferences go to localStorage. The page
 * must already be on the app's origin. A new tab/page starts signed out.
 */
export async function injectCitizenSession(
  page: import('@playwright/test').Page,
  { token, userInfo, tenant }: { token: string; userInfo: Record<string, unknown>; tenant: string },
): Promise<void> {
  await page.evaluate(
    ({ token, userInfo, tenant }) => {
      const wrap = (value: unknown) => JSON.stringify({ value, ttl: 86400, expiry: Date.now() + 86400 * 1000 });
      sessionStorage.setItem('Citizen.token', token);
      sessionStorage.setItem('Citizen.user-info', JSON.stringify(userInfo));
      sessionStorage.setItem('token', token);
      sessionStorage.setItem('user-info', JSON.stringify(userInfo));
      sessionStorage.setItem('Digit.User', wrap({ token, access_token: token, info: userInfo }));
      sessionStorage.setItem('Digit.userType', wrap('citizen'));
      sessionStorage.setItem('Digit.user_type', wrap('citizen'));
      sessionStorage.setItem('Digit.Citizen.tenantId', wrap(tenant));
      localStorage.setItem('Citizen.tenant-id', tenant);
      localStorage.setItem('tenant-id', tenant);
      localStorage.setItem('Citizen.locale', 'en_IN');
    },
    { token, userInfo, tenant },
  );
}

/**
 * Login via API token injection — bypasses the UI login form.
 * Gets a token via ROPC grant, then puts it into this tab's session.
 * Use this when login is a prerequisite, not the thing being tested.
 */
export async function loginViaApi(
  page: import('@playwright/test').Page,
  config: AuthConfig,
): Promise<TokenResponse> {
  const tokenResponse = await getDigitToken(config);

  // Navigate to set the origin (browser storage is origin-scoped)
  await page.goto(`${config.baseURL}/digit-ui/employee/user/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  await injectEmployeeSession(page, {
    token: tokenResponse.access_token,
    userInfo: (tokenResponse.UserRequest || {}) as Record<string, unknown>,
    tenant: config.tenant,
  });

  // Navigate to the employee home page
  await page.goto(`${config.baseURL}/digit-ui/employee`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  return tokenResponse;
}
