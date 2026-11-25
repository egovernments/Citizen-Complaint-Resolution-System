/** New citizen by BFF phone OTP -> BFF citizen context -> direct DIGIT service calls.
 * v2.20 citizens sign in only with their phone and a one-time code: the
 * digit-ui-citizen client offers no password method by default, and citizen
 * `_select` only trusts a phone the BFF proved. The code comes from
 * IDENTITY_TEST_OTP_CODE (configuredOtp), as for every citizen fixture.
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { BASE_URL, TENANT, SERVICE_CODE, LOCALITY_CODE } from '../utils/env';
import { getMobileValidationRule, generateValidMobile } from '../utils/mdms-mobile';
import { citizenSignIn, type DigitContext } from '../utils/identity-bff';
import { tryGetProfile } from '../utils/profile';

test.describe('New citizen BFF provisioning', () => {
  let browserContext: BrowserContext;
  let context: DigitContext;
  let phone: string;
  test.beforeAll(async ({ browser }) => {
    phone = generateValidMobile(await getMobileValidationRule(TENANT));
    browserContext = await browser.newContext();
    context = await citizenSignIn(browserContext.request, BASE_URL, phone);
    expect(context.UserRequest.type).toBe('CITIZEN');
    expect(Boolean(context.access_token)).toBe(true);
  });

  test.afterAll(async () => {
    await browserContext?.close();
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
    // tenantId/locale/module are QUERY params on this service; in the body they are
    // absent and it 400s "Required request parameter 'locale'" (see proxy-coverage.spec.ts).
    const response = await request.post(
      `${BASE_URL}/localization/messages/v1/_search?tenantId=${TENANT}&locale=en_IN&module=rainmaker-common`,
      { data: { RequestInfo: info() } },
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).messages).toBeInstanceOf(Array);
  });

  test('access control works for new citizen through BFF-selected context', { tag: ['@local-only', '@persona:citizen'] }, async ({ request }) => {
    const response = await request.post(`${BASE_URL}/access/v1/actions/mdms/_get`, {
      // roleCodes is a list of strings (not `rolesCodes` objects) and actionMaster is
      // required, or it 400s "Atleast One Role is Required" (see proxy-coverage.spec.ts).
      data: { RequestInfo: info(), tenantId: TENANT, roleCodes: ['CITIZEN'], actionMaster: 'actions-test', enabled: true },
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty('actions');
  });

  test('PGR complaint creation works for new citizen through BFF-selected context', { tag: ['@local-only', '@persona:citizen'] }, async ({ request }) => {
    test.skip(
      !SERVICE_CODE || !LOCALITY_CODE,
      `no seed plan (service/locality): ${tryGetProfile()?.personas.unresolvedDiagnostics['pgr.seedPlan'] ?? 'no deployment profile'}`,
    );
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
