import { test, expect } from '@playwright/test';
import { citizenSignIn, hostedSignIn, identityJson, selectContext, type Surface } from '../utils/identity-bff';
import { baseURL, deliveredOtp, missingConfig, otpKeys } from './fixtures';

test.skip(missingConfig().length > 0, 'Pending root real gate: dependency configuration is unset');

const personas: Array<{ name: string; key: string; surface: Surface; phone?: boolean }> = [
  { name: 'configurator founder', key: 'FOUNDER', surface: 'configurator' },
  { name: 'configurator admin', key: 'ADMIN', surface: 'configurator' },
  { name: 'employee', key: 'EMPLOYEE', surface: 'employee' },
  { name: 'Keycloak citizen', key: 'CITIZEN', surface: 'citizen' },
  { name: 'phone-only citizen', key: 'PHONE', surface: 'citizen', phone: true },
];

for (const persona of personas) {
  test(`${persona.name}: sign-in, tenant context, account metadata and logout`, async ({ page }) => {
    const required = persona.phone
      ? [...otpKeys]
      : [`IDENTITY_E2E_${persona.key}_USERNAME`, `IDENTITY_E2E_${persona.key}_PASSWORD`];
    const missing = missingConfig(required);
    test.skip(missing.length > 0, `Pending root real gate; unset: ${missing.join(', ')}`);
    const base = baseURL();
    const tenantId = process.env.IDENTITY_E2E_TENANT_ID!;
    const context = persona.phone
      ? await citizenSignIn(page.request, base, process.env.IDENTITY_E2E_PHONE!, deliveredOtp)
      : await (async () => {
        await hostedSignIn(page, { baseURL: base, surface: persona.surface,
          username: process.env[`IDENTITY_E2E_${persona.key}_USERNAME`]!, password: process.env[`IDENTITY_E2E_${persona.key}_PASSWORD`]! });
        return selectContext(page.request, base, persona.surface, tenantId);
      })();
    expect(context.UserRequest.tenantId).toBe(tenantId);
    const account = await identityJson<{ account: { actions: string[]; credentials: unknown[]; providers: unknown[] }; sessions: Array<{ current: boolean; surface: string }> }>(
      await page.request.get(`${base}/identity/v1/session?surface=${persona.surface}&include=account`),
    );
    expect(account.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ current: true, surface: persona.surface })]));
    if (persona.phone) expect(account.account).toEqual({ actions: [], credentials: [], providers: [] });
    else expect(account.account.actions).toContain('UPDATE_PASSWORD');
    // Direct business traffic must accept the selected token without the BFF proxy.
    const self = await page.request.post(`${process.env.DIGIT_USER_URL}/user/_search`, {
      data: { RequestInfo: { authToken: context.access_token }, tenantId, uuid: [context.UserRequest.uuid] },
    });
    expect(self.status()).toBe(200);
    expect((await self.json()).user).toEqual(expect.arrayContaining([expect.objectContaining({ uuid: context.UserRequest.uuid })]));
    const logout = await page.request.post(`${base}/identity/v1/logout`, {
      headers: { Origin: new URL(base).origin }, data: { surface: persona.surface, scope: 'current' },
    });
    expect(logout.status()).toBe(204);
    expect((await page.request.get(`${base}/identity/v1/session?surface=${persona.surface}`)).status()).toBe(401);
  });
}

test('one person lists sessions, signs out others, then signs out everywhere', async ({ browser }) => {
  const missing = missingConfig(['IDENTITY_E2E_ADMIN_USERNAME', 'IDENTITY_E2E_ADMIN_PASSWORD']);
  test.skip(missing.length > 0, `Pending root real gate; unset: ${missing.join(', ')}`);
  const base = baseURL();
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    for (const context of [first, second]) await hostedSignIn(await context.newPage(), { baseURL: base, surface: 'configurator',
      username: process.env.IDENTITY_E2E_ADMIN_USERNAME!, password: process.env.IDENTITY_E2E_ADMIN_PASSWORD! });
    const before = await identityJson<{ sessions: Array<{ id: string; current: boolean }> }>(await first.request.get(`${base}/identity/v1/session?include=account`));
    expect(before.sessions.filter(session => session.current)).toHaveLength(1);
    expect(before.sessions.length).toBeGreaterThanOrEqual(2);
    const post = (scope: string) => first.request.post(`${base}/identity/v1/logout`, { headers: { Origin: new URL(base).origin }, data: { surface: 'configurator', scope } });
    expect((await post('others')).status()).toBe(204);
    expect((await second.request.get(`${base}/identity/v1/session`)).status()).toBe(401);
    expect((await first.request.get(`${base}/identity/v1/session`)).status()).toBe(200);
    expect((await post('all')).status()).toBe(204);
    expect((await first.request.get(`${base}/identity/v1/session`)).status()).toBe(401);
  } finally { await first.close(); await second.close(); }
});
