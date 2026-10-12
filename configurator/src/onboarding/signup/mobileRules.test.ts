import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOBILE_RULES, mobileHint, nationalMobile, ruleShape } from './mobileRules';

const SEED = path.resolve(__dirname, '../../../../backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json');

describe('the mobile rules match what provisioning seeds (no drift)', () => {
  const seeded = (JSON.parse(readFileSync(SEED, 'utf8')) as {
    countryMobileRules: Record<string, { countryCode: string; mobileNumberRegex: string }>;
  }).countryMobileRules;

  it('covers exactly the countries the backend supports', () => {
    expect(Object.keys(MOBILE_RULES).sort()).toEqual(Object.keys(seeded).sort());
  });

  it.each(Object.keys(MOBILE_RULES))('%s has the seeded dial code and pattern, and an example that passes it', (country) => {
    const rule = MOBILE_RULES[country];
    expect(rule.dialCode).toBe(seeded[country].countryCode);
    expect(rule.pattern).toBe(seeded[country].mobileNumberRegex);
    expect(new RegExp(rule.pattern).test(rule.example)).toBe(true);
  });

  it('can describe every seeded rule, so no country falls back to the bare hint', () => {
    for (const rule of Object.values(seeded)) expect(ruleShape(rule.mobileNumberRegex)).not.toBeNull();
  });
});

describe('ruleShape', () => {
  it('reads length and leading digits', () => {
    expect(ruleShape('^[17][0-9]{8}$')).toEqual({ length: 9, prefixes: ['1', '7'] });
    expect(ruleShape('^8[2-7][0-9]{7}$')).toEqual({ length: 9, prefixes: ['82', '83', '84', '85', '86', '87'] });
    expect(ruleShape('^\\d{10}$')).toEqual({ length: 10, prefixes: [] });
  });

  it('gives up on shapes it cannot put in words', () => {
    expect(ruleShape('^0?[17][0-9]{8}$')).toBeNull();
    expect(ruleShape('^[0-9]{8,9}$')).toBeNull();
    expect(ruleShape('^(7|1)[0-9]{8}$')).toBeNull();
    expect(ruleShape('^[0-9]{2}[5-9][0-9]{6}$')).toBeNull();
  });
});

describe('mobileHint', () => {
  it('says the length, the leading digits and an example', () => {
    expect(mobileHint('Kenya', MOBILE_RULES.KE)).toBe(
      'Mobile numbers in Kenya have 9 digits and start with 1 or 7, for example 712345678.',
    );
    expect(mobileHint('India', MOBILE_RULES.IN)).toBe(
      'Mobile numbers in India have 10 digits and start with 6 to 9, for example 9876543210.',
    );
    expect(mobileHint('Mozambique', MOBILE_RULES.MZ)).toBe(
      'Mobile numbers in Mozambique have 9 digits and start with 82 to 87, for example 841234567.',
    );
  });

  it('falls back to the dial code for a rule it cannot read', () => {
    expect(mobileHint('Kenya', { dialCode: '+254', pattern: '^0?[17][0-9]{8}$', example: '712345678' })).toBe(
      'Enter the number without the +254 prefix.',
    );
  });
});

describe('nationalMobile', () => {
  it('takes the national number in any form the backend parses', () => {
    for (const typed of ['712345678', '0712345678', '+254712345678', '254712345678', '+254 712 345 678', '(0712) 345-678']) {
      expect(nationalMobile(typed, MOBILE_RULES.KE)).toBe('712345678');
    }
  });

  it('refuses numbers the rule refuses', () => {
    // The number in #2353's report.
    expect(nationalMobile('77777777777', MOBILE_RULES.MZ)).toBeNull();
    expect(nationalMobile('812345678', MOBILE_RULES.MZ)).toBeNull();
    expect(nationalMobile('5123456789', MOBILE_RULES.IN)).toBeNull();
    expect(nationalMobile('+91 9876543210', MOBILE_RULES.KE)).toBeNull();
    expect(nationalMobile('7123x5678', MOBILE_RULES.KE)).toBeNull();
  });
});
