/**
 * Unit tests for utils/mobile.ts — tenant-aware test mobile numbers.
 *
 * egov-user enforces the tenant's UserValidation mobile rule even on
 * _createnovalidate (ethiopia: ^[17][0-9]{8}$ → INVALID_MOBILE_FORMAT
 * for the old hardcoded 10-digit numbers), so the generators must
 * follow CITIZEN_MOBILE_LENGTH / CITIZEN_MOBILE_PREFIX and default to
 * the pg/India shape.
 */
import { mobileRules, uniqueMobile, fixedMobile } from '../utils/mobile';

const ENV_KEYS = ['CITIZEN_MOBILE_LENGTH', 'CITIZEN_MOBILE_PREFIX'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('mobileRules', () => {
  test('defaults to the pg/India shape (10 digits starting 9)', () => {
    expect(mobileRules()).toEqual({ length: 10, prefix: '9' });
  });

  test('reads env overrides lazily (set after import, e.g. by global-setup)', () => {
    process.env.CITIZEN_MOBILE_LENGTH = '9';
    process.env.CITIZEN_MOBILE_PREFIX = '1';
    expect(mobileRules()).toEqual({ length: 9, prefix: '1' });
  });
});

describe('uniqueMobile', () => {
  test('matches the ethiopia rule when env says so', () => {
    process.env.CITIZEN_MOBILE_LENGTH = '9';
    process.env.CITIZEN_MOBILE_PREFIX = '7';
    expect(uniqueMobile()).toMatch(/^[17][0-9]{8}$/);
  });

  test('matches the pg rule by default', () => {
    expect(uniqueMobile()).toMatch(/^9[0-9]{9}$/);
  });

  test('offset yields distinct numbers within the same millisecond', () => {
    expect(uniqueMobile(0)).not.toBe(uniqueMobile(1));
  });
});

describe('fixedMobile', () => {
  test('zero-pads short seeds to the configured length', () => {
    process.env.CITIZEN_MOBILE_LENGTH = '9';
    process.env.CITIZEN_MOBILE_PREFIX = '7';
    expect(fixedMobile(42)).toBe('700000042');
  });

  test('truncates seeds longer than the body instead of overflowing', () => {
    process.env.CITIZEN_MOBILE_LENGTH = '9';
    process.env.CITIZEN_MOBILE_PREFIX = '7';
    expect(fixedMobile(888888888)).toBe('788888888');
    expect(fixedMobile(888888888)).toHaveLength(9);
  });

  test('reproduces the legacy pg numbers under defaults', () => {
    expect(fixedMobile(999900001)).toBe('9999900001');
    expect(fixedMobile(888888888)).toBe('9888888888');
  });

  test('is deterministic across calls', () => {
    expect(fixedMobile(7)).toBe(fixedMobile(7));
  });
});
