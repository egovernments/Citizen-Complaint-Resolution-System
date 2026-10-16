/** New Keycloak person -> BFF citizen context -> direct DIGIT service calls.
 * The fixture creates a credentialed person with a verified phone. It does not
 * claim to execute Google consent; sso-config covers the provider hand-off.
 */
import { randomUUID } from 'node:crypto';
import { test, expect, type BrowserContext } from '@playwright/test';
import { BASE_URL, TENANT, KC_REALM, SERVICE_CODE, LOCALITY_CODE } from '../utils/env';
import { getMobileValidationRule, generateValidMobile } from '../utils/mdms-mobile';
import { hostedSignIn, selectContext, type DigitContext } from '../utils/identity-bff';
import { keycloakAdmin } from '../utils/keycloak-admin';

test.describe('New Keycloak citizen BFF provisioning', () => {
  let browserContext: BrowserContext;
  let context: DigitContext;
  let userUrl: string | undefined;
  let phone: string;
  test.beforeAll(async ({ browser, request }) => {
    const admin = keycloakAdmin();
    const rule = await getMobileValidationRule(TENANT);
    phone = generateValidMobile(rule);
    if (!rule.prefix) throw new Error('New citizen fixture needs the tenant country calling code');
    const username = `e2e-citizen-${randomUUID()}`;
    const password = `Test@${randomUUID()}`;
    const created = await request.post(`${admin.base}/admin/realms/${KC_REALM}/users`, {
      headers: { Authorization: `Bearer ${admin.token}` },
      data: { username, email: `${username}@example.test`, enabled: true, emailVerified: true,
        firstName: 'E2E', lastName: 'Citizen',
        attributes: { phoneNumber: [`+${rule.prefix.replace(/^\+/, '')}${phone}`], phoneNumberVerified: ['true'] },
        credentials: [{ type: 'password', value: password, temporary: false }] },
    });
    expect(created.status()).toBe(201);
    userUrl = created.headers().location;
    expect(Boolean(userUrl)).toBe(true);
    browserContext = await browser.newContext();
    const page = await browserContext.newPage();
    await hostedSignIn(page, { baseURL: BASE_URL, surface: 'citizen', username, password });
    context = await selectContext(page.request, BASE_URL, 'citizen', TENANT);
    expect(context.UserRequest.type).toBe('CITIZEN');
    expect(Boolean(context.access_token)).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await browserContext?.close();
    if (userUrl) {
      const admin = keycloakAdmin();
      expect((await request.delete(userUrl, { headers: { Authorization: `Bearer ${admin.token}` } })).status()).toBe(204);
    }
  });

  const info = () => ({ apiId: 'identity-new-citizen-test', authToken: context.access_token });
  test('MDMS search works for new citizen through BFF-selected context', { tag: ['@local-only', '@persona:citizen'] }, async ({ request }) => {
    const response = await request.post(`${BASE_URL}/mdms-v2/v1/_search`, {
      data: { RequestInfo: info(), MdmsCriteria: { tenantId: TENANT,
        moduleDetails: [{ moduleName: 'tenant', masterDetails: [{ name: 'tenants' }] }] } },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('MdmsRes');
  });

  test('localization search works for new citizen through BFF-selected context', { tag: ['@local-only', '@persona:citizen'] }, async ({ request }) => {
    const response = await request.post(`${BASE_URL}/localization/messages/v1/_search`, {
      data: { RequestInfo: info(), tenantId: TENANT, locale: 'en_IN', module: 'rainmaker-common' },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).messages).toBeInstanceOf(Array);
  });

  test('access control works for new citizen through BFF-selected context', { tag: ['@local-only', '@persona:citizen'] }, async ({ request }) => {
    const response = await request.post(`${BASE_URL}/access/v1/actions/mdms/_get`, {
      data: { RequestInfo: info(), tenantId: TENANT, rolesCodes: [{ code: 'CITIZEN' }] },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('actions');
  });

  test('PGR complaint creation works for new citizen through BFF-selected context', { tag: ['@local-only', '@persona:citizen'] }, async ({ request }) => {
    const response = await request.post(`${BASE_URL}/pgr-services/v2/request/_create`, {
      data: { RequestInfo: info(), service: { tenantId: TENANT, serviceCode: SERVICE_CODE,
        description: 'E2E new BFF citizen complaint', source: 'web',
        address: { city: TENANT, locality: { code: LOCALITY_CODE } },
        citizen: { name: 'E2E Citizen', mobileNumber: phone, tenantId: TENANT } }, workflow: { action: 'APPLY' } },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ServiceWrappers?.[0]?.service?.serviceRequestId).toBeTruthy();
  });
});
