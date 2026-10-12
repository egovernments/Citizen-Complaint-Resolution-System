import { englishT, type OnboardingT } from '../i18n';

/**
 * The mobile-number rule a founder's number must pass, per base country.
 *
 * This is a copy of pgr-services' platform baseline (`countryMobileRules` in
 * onboarding/platform-baseline-v1.json). Provisioning writes that rule as the new
 * tenant's `common-masters.MobileNumberValidation`, and egov-user enforces it when it
 * creates the founder at FOUNDER_HRMS. The signup can't read it from MDMS, because
 * the tenant doesn't exist yet, so mobileRules.test.ts reads the seed and fails if
 * this copy drifts from it.
 *
 * `example` is a number that passes the rule, shown as the field's placeholder.
 */
export interface MobileRule {
  dialCode: string;
  pattern: string;
  example: string;
}

export const MOBILE_RULES: Record<string, MobileRule> = {
  KE: { dialCode: '+254', pattern: '^[17][0-9]{8}$', example: '712345678' },
  IN: { dialCode: '+91', pattern: '^[6-9][0-9]{9}$', example: '9876543210' },
  ET: { dialCode: '+251', pattern: '^9[0-9]{8}$', example: '911234567' },
  MZ: { dialCode: '+258', pattern: '^8[2-7][0-9]{7}$', example: '841234567' },
};

const ALL_DIGITS = '0123456789';
const MAX_PREFIXES = 12;

/** The digits a character class allows, e.g. `[2-7]` or `[17]`; null for anything but digits and ranges. */
function classDigits(body: string): string | null {
  let digits = '';
  for (let i = 0; i < body.length; i++) {
    const from = body[i];
    if (!/\d/.test(from)) return null;
    if (body[i + 1] === '-' && /\d/.test(body[i + 2] ?? '')) {
      for (let d = Number(from); d <= Number(body[i + 2]); d++) digits += String(d);
      i += 2;
    } else {
      digits += from;
    }
  }
  return digits;
}

/**
 * A rule's pattern read as words: how many digits it takes, and which digits the
 * number starts with. Only the shape every baseline rule has is read: fixed
 * positions, each a digit, a digit class or any digit, constrained ones first.
 * Anything else (alternation, a variable length) is null, and the hint falls back
 * to the dial code alone rather than describing a rule it can't read.
 */
export function ruleShape(pattern: string): { length: number; prefixes: string[] } | null {
  const body = pattern.replace(/^\^/, '').replace(/\$$/, '');
  const positions: string[] = [];
  let i = 0;
  while (i < body.length) {
    let digits: string | null;
    if (body.startsWith('\\d', i)) {
      digits = ALL_DIGITS;
      i += 2;
    } else if (body[i] === '[') {
      const end = body.indexOf(']', i);
      if (end < 0) return null;
      digits = classDigits(body.slice(i + 1, end));
      i = end + 1;
    } else if (/\d/.test(body[i])) {
      digits = body[i];
      i += 1;
    } else {
      return null;
    }
    if (!digits) return null;
    let count = 1;
    const quantifier = /^\{(\d+)\}/.exec(body.slice(i));
    if (quantifier) {
      count = Number(quantifier[1]);
      i += quantifier[0].length;
    }
    for (let n = 0; n < count; n++) positions.push(digits);
  }
  if (positions.length === 0) return null;

  const leading = positions.findIndex((digits) => digits === ALL_DIGITS);
  const constrained = leading < 0 ? positions : positions.slice(0, leading);
  // A constrained digit after a free one can't be put as "starts with".
  if (positions.slice(constrained.length).some((digits) => digits !== ALL_DIGITS)) return null;

  let prefixes = [''];
  for (const digits of constrained) {
    prefixes = prefixes.flatMap((prefix) => [...digits].map((d) => prefix + d));
    if (prefixes.length > MAX_PREFIXES) return null;
  }
  return { length: positions.length, prefixes: prefixes[0] === '' ? [] : prefixes };
}

/** "1 or 7", "6 to 9", "82 to 87": runs of three or more consecutive prefixes read as a range. */
function listPrefixes(prefixes: string[], t: OnboardingT): string {
  const sorted = [...prefixes].sort((a, b) => Number(a) - Number(b));
  const runs: string[][] = [];
  for (const prefix of sorted) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last.length === prefix.length && Number(prefix) === Number(last) + 1) run.push(prefix);
    else runs.push([prefix]);
  }
  const parts = runs.flatMap((run) =>
    run.length >= 3 ? [t('signup.mobile_rule_range', '%{from} to %{to}', { from: run[0], to: run[run.length - 1] })] : run,
  );
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} ${t('signup.mobile_rule_or', 'or')} ${parts[parts.length - 1]}`;
}

/**
 * The one-liner under the mobile field: what a valid number looks like in the
 * selected country, read from the same rule the backend enforces.
 */
export function mobileHint(countryName: string, rule: MobileRule, t: OnboardingT = englishT): string {
  const shape = ruleShape(rule.pattern);
  if (!shape) {
    // Fallback for a rule this reader can't describe: the dial code is still certain.
    return t('signup.mobile_rule_unknown', 'Enter the number without the %{dial} prefix.', { dial: rule.dialCode });
  }
  if (shape.prefixes.length === 0) {
    return t('signup.mobile_rule_digits', 'Mobile numbers in %{country} have %{digits} digits, for example %{example}.', {
      country: countryName,
      digits: shape.length,
      example: rule.example,
    });
  }
  return t(
    'signup.mobile_rule',
    'Mobile numbers in %{country} have %{digits} digits and start with %{prefixes}, for example %{example}.',
    { country: countryName, digits: shape.length, prefixes: listPrefixes(shape.prefixes, t), example: rule.example },
  );
}

/**
 * The national number in what was typed, or null when it doesn't pass the rule.
 *
 * Accepts what the backend's parser accepts on the way in: spaces, dashes and
 * brackets, the dial code with or without its "+", and a leading trunk 0. What
 * comes back is the bare national number egov-user checks against the rule.
 */
export function nationalMobile(input: string, rule: MobileRule): string | null {
  const matches = new RegExp(rule.pattern);
  const dial = rule.dialCode.replace(/^\+/, '');
  let digits = input.replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) {
    if (!digits.startsWith(`+${dial}`)) return null;
    digits = digits.slice(dial.length + 1);
  }
  if (!/^\d+$/.test(digits)) return null;
  const candidates = [digits];
  if (digits.startsWith(dial)) candidates.push(digits.slice(dial.length));
  if (digits.startsWith('0')) candidates.push(digits.slice(1));
  return candidates.find((candidate) => matches.test(candidate)) ?? null;
}
