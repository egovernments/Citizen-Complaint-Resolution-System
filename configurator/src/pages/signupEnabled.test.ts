import { afterEach, describe, expect, it } from 'vitest';
import { signupEnabled } from './signupEnabled';

// cfgreview F31 (#1577): no "Create an account" unless the deployment serves sign-up.
describe('signupEnabled', () => {
  afterEach(() => { delete (window as unknown as { __CONFIGURATOR_CONFIG__?: unknown }).__CONFIGURATOR_CONFIG__; });
  it('is off by default', () => {
    expect(signupEnabled()).toBe(false);
  });
  it('is on when config.js says SIGNUP_ENABLED=true', () => {
    (window as unknown as { __CONFIGURATOR_CONFIG__: Record<string, string> }).__CONFIGURATOR_CONFIG__ = { SIGNUP_ENABLED: 'true' };
    expect(signupEnabled()).toBe(true);
  });
});
