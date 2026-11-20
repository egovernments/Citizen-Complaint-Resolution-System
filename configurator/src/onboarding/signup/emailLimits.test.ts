import { describe, expect, it } from 'vitest';
import { OnboardingError } from '@/api/onboarding';
import { describeEmailLimit } from './emailLimits';
import { describeSignupError } from './signupErrors';

const limited = (code: string, retryAfter?: unknown) =>
  new OnboardingError(429, code, 'Too many requests. Try again later.', retryAfter === undefined ? { code } : { code, retryAfter });

describe('describeEmailLimit (#2805)', () => {
  it('names the network and the wait in whole minutes, rounded up', () => {
    expect(describeEmailLimit(limited('NETWORK_RATE_LIMITED', 841))).toBe('Too many requests from this network. Try again in 15 minutes.');
  });

  it('names the address when the address is over its limit', () => {
    expect(describeEmailLimit(limited('EMAIL_RATE_LIMITED', 1800))).toBe(
      'Too many emails were requested for this address. Try again in 30 minutes.',
    );
  });

  it('says "1 minute", not "1 minutes", for a wait under a minute or a missing retryAfter', () => {
    expect(describeEmailLimit(limited('NETWORK_RATE_LIMITED', 20))).toBe('Too many requests from this network. Try again in 1 minute.');
    expect(describeEmailLimit(limited('EMAIL_RATE_LIMITED'))).toBe('Too many emails were requested for this address. Try again in 1 minute.');
  });

  it('leaves every other error to its own handling', () => {
    expect(describeEmailLimit(new OnboardingError(429, 'OTP_RATE_LIMITED', 'x', { retryAfter: 60 }))).toBeNull();
    expect(describeEmailLimit(new OnboardingError(503, 'SIGNUP_UNAVAILABLE', 'x'))).toBeNull();
    expect(describeEmailLimit(new Error('x'))).toBeNull();
  });

  it('is what the sign-up page shows for a refused sign-up link', () => {
    expect(describeSignupError(limited('NETWORK_RATE_LIMITED', 1800), undefined, { magicLink: true })).toEqual({
      message: 'Too many requests from this network. Try again in 30 minutes.',
    });
  });
});
