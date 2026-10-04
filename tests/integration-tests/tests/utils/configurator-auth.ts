/**
 * Configurator auth helper — injects session into localStorage.
 *
 * The CRS Configurator uses its own auth state format in localStorage
 * under key 'crs-auth-state'. This helper completes hosted BFF sign-in, then
 * installs its selected context for management tests.
 */
import { expect, type Page } from '@playwright/test';
import { staffContext } from './auth';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from './env';

const CONFIGURATOR_BASE = process.env.CONFIGURATOR_BASE_URL || `${BASE_URL}/configurator`;

export { CONFIGURATOR_BASE };

/**
 * `form`: the legacy username / password / tenant form.
 * `hosted`: the hosted sign-in (#2107), which hands off to Keycloak through
 * identity-bff and has no credential fields of its own.
 */
export type ConfiguratorLogin = 'form' | 'hosted';

/**
 * Opens /configurator/login (relative to the project's baseURL, like every spec)
 * and reports which login it serves, leaving the page there. Only a positive
 * marker counts: the form's #username, or hosted sign-in's "Log in" button or
 * (already signed in) workspace chooser. "Hosted sign-in is not enabled" means identity-bff's
 * session / auth-methods call failed (or offers no password method), so it fails
 * loudly instead of passing for a hosted build.
 */
export async function detectConfiguratorLogin(page: Page): Promise<ConfiguratorLogin> {
  await page.goto('/configurator/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const form = page.locator('#username');
  const hosted = page
    .getByRole('button', { name: /^Log in$/ })
    // already signed in through identity-bff: the workspace chooser (`tenants` phase)
    .or(page.getByRole('heading', { name: /^(Choose a workspace|No workspace access yet)$/ }));
  const disabled = page.getByText(/Hosted sign-in is not enabled/i);
  await expect(form.or(hosted).or(disabled).first()).toBeVisible({ timeout: 20_000 });
  if (await form.count()) return 'form';
  if (await hosted.count()) return 'hosted';
  throw new Error(
    'configurator login says "Hosted sign-in is not enabled on this environment": identity-bff ' +
      '(/identity/v1/session or /identity/v1/auth-methods) failed or offers no password method',
  );
}

/**
 * Seeds the configurator session the way configurator/src/lib/session.ts
 * installDigitContext() does after hosted sign-in — keep the two in step — with the
 * DIGIT context selected after hosted sign-in, then opens /manage.
 */
export async function loginConfigurator(page: Page): Promise<void> {
  const tokenResponse = await staffContext(page, {
    tenant: ROOT_TENANT,
    username: ADMIN_USER,
    password: ADMIN_PASS,
  }, 'configurator');

  const user = tokenResponse.UserRequest as Record<string, unknown> | undefined;

  // Navigate to configurator first so we can set localStorage on its origin
  await page.goto(CONFIGURATOR_BASE, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  await page.evaluate(
    ({ token, userObj, apiOrigin }) => {
      const roles = (userObj?.roles as Array<{ code: string }>) || [];
      const tenant = userObj?.tenantId as string;
      localStorage.setItem(
        'crs-auth-state',
        JSON.stringify({
          isAuthenticated: true,
          user: {
            name: (userObj?.name as string) || (userObj?.userName as string),
            email: (userObj?.emailId as string) || '',
            roles: roles.map((r) => r.code),
            uuid: userObj?.uuid,
            id: userObj?.id,
            mobileNumber: userObj?.mobileNumber,
          },
          environment: apiOrigin,
          tenant,
          targetTenant: tenant,
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
      apiOrigin: new URL(BASE_URL).origin, // installDigitContext: API_ORIGIN || window.location.origin
    },
  );

  // Reload to pick up the injected session — should land on /manage
  await page.goto(`${CONFIGURATOR_BASE}/manage`, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });
}
