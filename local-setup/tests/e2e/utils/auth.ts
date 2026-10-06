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

/**
 * The tenant route the UI specs run on. Since D26 the app is served only
 * under /<tenant-slug>/digit-ui/; the tenantless /digit-ui/... app routes 404
 * (or redirect to a deployment default). The slug must belong to the tenant
 * the spec signs in to.
 */
export function tenantSlug(): string {
  const slug = process.env.E2E_TENANT_SLUG || process.env.IDENTITY_TEST_TENANT_SLUG || '';
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new Error('Set E2E_TENANT_SLUG to the seeded tenant route slug (/<slug>/digit-ui/)');
  }
  return slug;
}

/** `/<slug>/digit-ui`, the app base every UI navigation goes through. */
export function appBase(slug = tenantSlug()): string {
  return `/${slug}/digit-ui`;
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
 * Login via API token injection — bypasses the UI login form.
 * Gets a token via ROPC grant, then injects it into localStorage.
 * Use this when login is a prerequisite, not the thing being tested.
 */
export async function loginViaApi(
  page: import('@playwright/test').Page,
  config: AuthConfig,
): Promise<TokenResponse> {
  const tokenResponse = await getDigitToken(config);

  // Set the origin (localStorage is origin-scoped) on a static file, so no
  // login page starts an Identity BFF sign-in before the session is injected.
  await page.goto(`${config.baseURL}/digit-ui/globalConfigs.js`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  // Inject session into localStorage (same keys the Login component sets)
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

  // Navigate to the employee home page
  await page.goto(`${config.baseURL}${appBase()}/employee`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  return tokenResponse;
}
