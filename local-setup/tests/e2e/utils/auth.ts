/**
 * Employee auth for the e2e specs. Staff sign in through Keycloak and the
 * Identity BFF (the egov-user password form is gone), so `username` and
 * `password` are the persona's Keycloak login, as in tests/integration-tests.
 */
import { expect, request, type BrowserContext, type Page } from '@playwright/test';
import { hostedSignIn, passwordSignIn, resolveTenant, selectContext, surfacePath, tenantSlug, type DigitContext } from './identity';

/** `/<slug>/digit-ui`, the app base every UI navigation goes through. */
export function appBase(slug = tenantSlug()): string {
  return `/${slug}/digit-ui`;
}

export interface AuthConfig {
  baseURL: string;
  /** DIGIT_TENANT: the root tenant IDENTITY_TEST_TENANT_SLUG resolves to. */
  tenant: string;
  username: string;
  password: string;
}

/** The DIGIT session the employee app stored after its own sign-in. */
export type EmployeeSession = Pick<DigitContext, 'access_token' | 'UserRequest'>;

const contexts = new Map<string, Promise<DigitContext>>();

/** An employee DIGIT token for API calls: a browserless hosted sign-in, then the BFF context exchange. */
export function getDigitToken(config: AuthConfig): Promise<DigitContext> {
  const key = JSON.stringify([config.baseURL, config.tenant, config.username, config.password]);
  if (!contexts.has(key)) {
    contexts.set(key, (async () => {
      const cookies = await passwordSignIn({ baseURL: config.baseURL, surface: 'employee', username: config.username, password: config.password });
      const api = await request.newContext({ storageState: { cookies, origins: [] } });
      try {
        return await selectContext(api, config.baseURL, 'employee', config.tenant);
      } finally {
        await api.dispose();
      }
    })().catch((error) => {
      contexts.delete(key);
      throw error;
    }));
  }
  return contexts.get(key)!;
}

/** Employee BFF sessions this worker signed in, per persona. */
const staffSessions = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>();

/**
 * Sign an employee in and land on the employee home. Fails unless the home
 * actually rendered with a session for the route tenant: a session for any
 * other tenant is wiped on load (clearAuthFromAnotherTenant), which used to
 * leave specs passing against the sign-in page.
 *
 * The first call per persona in a worker goes through the hosted Keycloak
 * form; later calls reuse that BFF session while it is live, as citizen
 * sign-in does. `fresh` always uses the form.
 */
export async function loginViaApi(page: Page, config: AuthConfig, opts: { fresh?: boolean } = {}): Promise<EmployeeSession> {
  const tenant = await resolveTenant(page.request, config.baseURL);
  if (tenant.tenantId !== config.tenant) {
    throw new Error(`IDENTITY_TEST_TENANT_SLUG resolves to ${tenant.tenantId}, not DIGIT_TENANT=${config.tenant}; the suite runs on one root workspace`);
  }
  const key = JSON.stringify([config.baseURL, config.username]);
  const saved = opts.fresh ? undefined : staffSessions.get(key);
  if (saved) await page.context().addCookies(saved);
  const live = saved && await page.request.get(`${config.baseURL}/identity/v1/session?surface=employee`)
    .then(async r => r.ok() && (await r.json()).authenticated === true).catch(() => false);
  if (live) {
    // The sign-in route exchanges the live BFF session for the app's own DIGIT session.
    await page.goto(`${config.baseURL}${surfacePath('employee', 'user/login')}`, { waitUntil: 'domcontentloaded' });
  } else {
    await page.context().clearCookies();
    await hostedSignIn(page, { baseURL: config.baseURL, surface: 'employee', username: config.username, password: config.password });
  }
  // The landing app selects the context, stores Employee.* and moves to the
  // employee home itself; navigating here would abort that write.
  await expect.poll(() => new URL(page.url()).pathname, { message: 'the employee app did not leave its sign-in route', timeout: 30_000 })
    .not.toMatch(/\/user\/(login|language-selection)/);
  const session = await expectEmployeeHome(page, tenant.tenantId);
  staffSessions.set(key, await page.context().cookies());
  return session;
}

export async function expectEmployeeHome(page: Page, tenantId: string): Promise<EmployeeSession> {
  await expect(page.locator('.employee-app-wrapper'), `employee home did not render (at ${page.url()})`)
    .toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).pathname).not.toMatch(/\/user\/(login|language-selection)/);
  const stored = await page.evaluate(() => ({
    token: localStorage.getItem('Employee.token'),
    info: JSON.parse(localStorage.getItem('Employee.user-info') || '{}'),
  }));
  expect(stored.token, 'employee session missing from storage').toBeTruthy();
  expect(stored.info.tenantId, 'employee session belongs to another tenant').toBe(tenantId);
  return { access_token: stored.token!, UserRequest: stored.info };
}
