import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityHttpError, identityJson, OtpRateLimitedError } from '../utils/identity-bff';

const refusal = (status: number, body: unknown) => ({ status: () => status, json: async () => body });

test('an OTP send refused for rate reports as a rate limit, still as an identity failure', async () => {
  const err = await identityJson(refusal(429, { code: 'OTP_RATE_LIMITED', retryAfter: 1200, error: 'secret-must-not-leak' }), 202)
    .then(() => assert.fail('a 429 must throw'), (e: unknown) => e);
  assert(err instanceof OtpRateLimitedError);
  assert(err instanceof IdentityHttpError);
  assert.equal(err.status, 429);
  assert.equal(err.code, 'OTP_RATE_LIMITED');
  assert.equal(err.retryAfter, 1200);
  assert.match(err.message, /^Identity request failed: HTTP 429 \(OTP_RATE_LIMITED\): OTP SEND RATE LIMIT, not an app failure/);
  assert.match(err.message, /frees in 1200s/);
  assert.doesNotMatch(err.message, /secret-must-not-leak/);
});

test('other 429s keep the plain identity error', async () => {
  const err = await identityJson(refusal(429, { code: 'OTP_RESEND_TOO_SOON', retryAfter: 30 }), 202).then(() => null, (e: unknown) => e);
  assert(err instanceof IdentityHttpError);
  assert(!(err instanceof OtpRateLimitedError));
  assert.equal((err as Error).message, 'Identity request failed: HTTP 429 (OTP_RESEND_TOO_SOON)');
});
