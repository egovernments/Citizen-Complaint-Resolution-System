/**
 * Configurator auth helper — injects session into localStorage.
 *
 * The CRS Configurator uses its own auth state format in localStorage
 * under key 'crs-auth-state'. This helper acquires a DIGIT token via API
 * and injects it so we bypass the configurator login form entirely.
 */
import { expect, type Page } from '@playwright/test';
import { getDigitToken } from './auth';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from './env';

const CONFIGURATOR_BASE = process.env.CONFIGURATOR_BASE_URL || `${BASE_URL}/configurator`;

export { CONFIGURATOR_BASE };

/**
 * `form`: the legacy username / password / tenant form.
 * `hosted`: the hosted sign-in (#2107), which hands off to Keycloak through
 * identity-bff and has no credential fields of its own.
 */
export type ConfiguratorLogin = 'form' | 'hosted';

/** Opens /configurator/login and reports which login it serves. */
export async function detectConfiguratorLogin(page: Page): Promise<ConfiguratorLogin> {
  await page.goto(`${CONFIGURATOR_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const form = page.locator('#username');
  const hosted = page
    .getByRole('button', { name: /^Log in$/ })
    .or(page.getByText(/Hosted sign-in is not enabled/i));
  await expect(form.or(hosted).first()).toBeVisible({ timeout: 20_000 });
  return (await form.count()) > 0 ? 'form' : 'hosted';
}

export interface ConfiguratorCredentials {
  username?: string;
  password?: string;
  tenant?: string;
}

export async function loginConfigurator(page: Page, creds: ConfiguratorCredentials = {}): Promise<void> {
  const sessionTenant = creds.tenant || ROOT_TENANT;
  const tokenResponse = await getDigitToken({
    tenant: sessionTenant,
    username: creds.username || ADMIN_USER,
    password: creds.password || ADMIN_PASS,
  });

  const user = tokenResponse.UserRequest as Record<string, unknown> | undefined;

  // Navigate to configurator first so we can set localStorage on its origin
  await page.goto(CONFIGURATOR_BASE, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  // Inject auth state into configurator's localStorage format
  await page.evaluate(
    ({ token, userObj, baseUrl, tenant }) => {
      const roles = (userObj?.roles as Array<{ code: string }>) || [];
      localStorage.setItem(
        'crs-auth-state',
        JSON.stringify({
          isAuthenticated: true,
          user: {
            name: (userObj?.name as string) || 'Super Admin',
            email: (userObj?.emailId as string) || '',
            roles: roles.map((r) => r.code),
            id: userObj?.id,
            uuid: userObj?.uuid,
            mobileNumber: userObj?.mobileNumber,
          },
          environment: baseUrl,
          tenant,
          mode: 'management',
          currentPhase: 1,
          completedPhases: [],
          authToken: token,
        }),
      );
    },
    {
      token: tokenResponse.access_token,
      userObj: user || {},
      baseUrl: BASE_URL, // The DIGIT API base (not the configurator path)
      tenant: sessionTenant,
    },
  );

  // Reload to pick up the injected session — should land on /manage
  await page.goto(`${CONFIGURATOR_BASE}/manage`, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });
}
