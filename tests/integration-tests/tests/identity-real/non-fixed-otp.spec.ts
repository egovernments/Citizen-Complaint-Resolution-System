import { test, expect } from '@playwright/test';
import { citizenSignIn, identityJson } from '../utils/identity-bff';
import { baseURL, deliveredOtp, missingConfig, otpKeys } from './fixtures';

test('O2: real non-fixed egov-otp code mints a citizen token accepted by egov-user', async ({ request }) => {
  const missing = missingConfig([...otpKeys, 'IDENTITY_E2E_NON_FIXED_OTP_EVIDENCE']);
  test.skip(missing.length > 0, `Pending root O2 gate; unset: ${missing.join(', ')}`);
  // The evidence ref pins root's deployment settings: real egov-user/egov-otp,
  // OTP validation enabled and fixed-value mode disabled. Never an env dump.
  test.info().annotations.push({ type: 'deployment-evidence', description: process.env.IDENTITY_E2E_NON_FIXED_OTP_EVIDENCE! });
  const context = await citizenSignIn(request, baseURL(), process.env.IDENTITY_E2E_PHONE!, deliveredOtp);
  expect(typeof context.UserRequest.userName).toBe('string');
  expect(context.UserRequest.name).toBeTruthy();
  const tenantId = context.UserRequest.tenantId;
  const create = async () => {
    const response = await request.post(`${process.env.EGOV_OTP_URL}/otp/v1/_create`, {
      data: { RequestInfo: { apiId: 'identity-o2-gate' }, otp: { identity: process.env.IDENTITY_E2E_PHONE!, tenantId } },
    });
    expect([200, 201]).toContain(response.status());
    const body = await identityJson<{ otp: { otp: string } }>(response, response.status());
    expect(typeof body.otp?.otp === 'string' && /^\d+$/.test(body.otp.otp), 'egov-otp returned a usable code').toBe(true);
    return body.otp.otp;
  };
  // Two independent codes distinguish a random OTP service from a fixed stub.
  const first = await create();
  const second = await create();
  expect(first !== second, 'independent egov-otp creates must not return a fixed code').toBe(true);
  const wrong = `${second[0] === '0' ? '1' : '0'}${second.slice(1)}`;
  const mint = (code: string) => request.post(`${process.env.DIGIT_USER_URL}/user/oauth/token`, {
    headers: { Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=' },
    form: { grant_type: 'password', username: String(context.UserRequest.userName), password: code,
      tenantId, scope: 'read', userType: 'CITIZEN' },
  });
  // This direct call is an explicit egov-otp protocol probe, never a login fallback.
  const rejected = await mint(wrong);
  expect([400, 401]).toContain(rejected.status());
  const accepted = await identityJson<{ access_token: string; UserRequest: { uuid: string } }>(await mint(second));
  expect(Boolean(accepted.access_token)).toBe(true);
  expect(accepted.UserRequest.uuid).toBe(context.UserRequest.uuid);
  const self = await request.post(`${process.env.DIGIT_USER_URL}/user/_search`, {
    data: { RequestInfo: { authToken: accepted.access_token }, tenantId, uuid: [accepted.UserRequest.uuid] },
  });
  expect(self.status()).toBe(200);
  expect((await self.json()).user).toEqual(expect.arrayContaining([expect.objectContaining({ uuid: accepted.UserRequest.uuid })]));
});
