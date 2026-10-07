import type { ReadOtp } from '../utils/identity-bff';

export const dependencyKeys = ['IDENTITY_E2E_BASE_URL', 'KEYCLOAK_URL', 'DIGIT_USER_URL', 'EGOV_OTP_URL', 'IDENTITY_TEST_TENANT_SLUG', 'IDENTITY_E2E_TENANT_ID'] as const;
export const otpKeys = ['IDENTITY_E2E_PHONE', 'IDENTITY_E2E_PHONE_E164', 'IDENTITY_E2E_OTP_INBOX_URL'] as const;
export function missingConfig(keys: readonly string[] = []) {
  return [...dependencyKeys, ...keys].filter(key => !process.env[key]);
}
export const baseURL = () => process.env.IDENTITY_E2E_BASE_URL!.replace(/\/$/, '');

/** Fresh receipt by phone + request window; only BFF verifies challenge binding. */
export const deliveredOtp: ReadOtp = async challenge => {
  const inbox = process.env.IDENTITY_E2E_OTP_INBOX_URL;
  const phone = process.env.IDENTITY_E2E_PHONE_E164;
  if (!inbox || !phone || !/^\+\d{5,15}$/.test(phone) || !phone.endsWith(challenge.mobileNumber)) {
    throw new Error('Real OTP gate requires its inbox URL and matching E.164 test phone');
  }
  const url = new URL('/codes', inbox);
  url.search = new URLSearchParams({ phone, challengeId: challenge.challengeId,
    since: String(challenge.requestedAt), tenantId: challenge.tenantId, purpose: 'signin' }).toString();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (response.ok) {
      const receipt = await response.json();
      if (typeof receipt.code !== 'string' || !/^\d{6}$/.test(receipt.code) ||
          receipt.receivedAt < challenge.requestedAt || receipt.expiresAt <= Date.now()) {
        throw new Error('OTP inbox returned an invalid or expired delivery');
      }
      return receipt.code;
    }
    if (response.status !== 404) throw new Error(`OTP inbox unavailable: HTTP ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('No fresh OTP delivery arrived within the test window');
};
