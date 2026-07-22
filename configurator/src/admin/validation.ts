/**
 * Form validators with human-readable error messages.
 *
 * ra-core's built-in validators default to i18n keys like 'ra.validation.required'
 * which render literally without React Admin's TranslationProvider.
 * These wrappers use plain English messages instead.
 *
 * Usage:
 *   import { v } from '@/admin/validation';
 *   <DigitFormInput source="name" validate={[v.required, v.name]} />
 */
import {
  required as raRequired,
  minLength as raMinLength,
  maxLength as raMaxLength,
  minValue as raMinValue,
  maxValue as raMaxValue,
  regex as raRegex,
  email as raEmail,
  number as raNumber,
  composeValidators,
} from 'ra-core';

// --- Atomic validators ---

export const required = raRequired('This field is required');

export const email = raEmail('Enter a valid email address');

export const number = raNumber('Must be a number');

export const phone = raRegex(
  /^[6-9]\d{9}$/,
  'Enter a valid 10-digit mobile number',
);

/**
 * Postal code validator — country-configurable.
 *
 * Per @vinothrallapalli-eGov review on PR #690: don't hardcode the
 * length / starting-digit constraints, because each country has its
 * own postal-code rule. The canonical source is the
 * `common-masters.MobileNumberValidation` MDMS master — same master used for
 * mobile validation — for postal code, use a separate MDMS entry or
 * globalConfigs.CORE_POSTAL_CONFIGS.
 *
 * Read order (matches `useMobileValidation`):
 *   1. `window.__DIGIT_USER_VALIDATION.postalCode` — populated by the
 *      `useMobileValidation` hook from the MDMS master.
 *   2. `globalConfigs.CORE_POSTAL_CONFIGS` — build-time fallback rendered
 *      by the ansible playbook from host_vars `core_postal_configs`
 *      (legacy `CORE_POSTAL_CODE_CONFIGS` key also honoured).
 *   3. Last-resort default only when no config is present. This is NOT a
 *      country pin — any deployment MUST set `core_postal_configs` in its
 *      host_vars so the served globalConfigs supplies the real rule.
 *
 * `postalCode` is a function-valued validator so the resolution runs
 * at validation time (every keystroke), not at module-import time.
 * That way a tenant switch mid-session picks up the latest rule.
 *
 * There is no separate "error message" config field to keep in sync with
 * the pattern (CCRS#722 — a hand-set message drifted from the pattern's
 * actual digit count on more than one tenant). The message is always
 * derived from the pattern itself: the digit count when it's a plain
 * `^[0-9]{N}$` shape, otherwise a generic message. The MDMS master may
 * still supply its own `errorMessage` alongside its `pattern` — that's a
 * genuinely different, per-tenant-authored rule, not a config knob that
 * can drift from this validator's own pattern.
 *
 * Form usage: `<DigitFormInput validate={v.postalCode} ... />` — the
 * old `postalCodeKE` alias still works as a backward-compat shim
 * pointing at the same dynamic validator.
 */
const DEFAULT_POSTAL_PATTERN = /^[0-9]{5}$/;
const GENERIC_POSTAL_MESSAGE = 'Enter a valid postal code';

function deriveMessage(patternStr: string): string {
  const m = patternStr.match(/\{\s*(\d+)\s*\}/); // ^[0-9]{5}$ -> "5"
  return m ? `Enter a valid ${m[1]}-digit postal code` : GENERIC_POSTAL_MESSAGE;
}

function resolvePostalRule(): { pattern: RegExp; message: string } {
  const userValidation =
    typeof window !== 'undefined'
      ? (window as unknown as Record<string, unknown>).__DIGIT_USER_VALIDATION
      : undefined;
  const mdmsRule = (userValidation as Record<string, Record<string, unknown>> | undefined)?.postalCode;
  const getConfig =
    typeof window !== 'undefined'
      ? (window as unknown as Record<string, { getConfig?: (key: string) => Record<string, unknown> }>)
          .globalConfigs?.getConfig
      : undefined;
  // Ansible templates this as CORE_POSTAL_CONFIGS (from host_vars
  // `core_postal_configs`); fall back to the legacy CORE_POSTAL_CODE_CONFIGS key.
  const globalRule =
    getConfig?.('CORE_POSTAL_CONFIGS') ?? getConfig?.('CORE_POSTAL_CODE_CONFIGS');

  const patternStr =
    (mdmsRule?.pattern as string | undefined) ||
    (globalRule?.postalCodePattern as string | undefined);
  const mdmsMessage = mdmsRule?.errorMessage as string | undefined;

  if (patternStr) {
    try {
      return { pattern: new RegExp(patternStr), message: mdmsMessage || deriveMessage(patternStr) };
    } catch {
      // Bad pattern in MDMS — fall through to the default rather than
      // throwing during validation.
    }
  }
  return { pattern: DEFAULT_POSTAL_PATTERN, message: mdmsMessage || deriveMessage(DEFAULT_POSTAL_PATTERN.source) };
}

export const postalCode = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;
  const { pattern, message } = resolvePostalRule();
  return pattern.test(String(value)) ? undefined : message;
};

/** Backward-compat alias for existing callers. Same dynamic validator. */
export const postalCodeKE = postalCode;

export const code = raRegex(
  /^[A-Za-z0-9][A-Za-z0-9_.\-/]*$/,
  'Use letters, numbers, underscores, dots, hyphens, or slashes',
);

export const minLength = (min: number) =>
  raMinLength(min, `Must be at least ${min} characters`);

export const maxLength = (max: number) =>
  raMaxLength(max, `Must be at most ${max} characters`);

export const minValue = (min: number) =>
  raMinValue(min, `Must be at least ${min}`);

export const maxValue = (max: number) =>
  raMaxValue(max, `Must be at most ${max}`);

export const regex = (pattern: RegExp, message: string) =>
  raRegex(pattern, message);

// --- Composed validators (common field patterns) ---

/** Name field: required, 2-100 chars */
export const name = composeValidators(
  required,
  minLength(2),
  maxLength(100),
);

/** Mobile number: required, 10-digit Indian format */
export const mobileRequired = composeValidators(required, phone);

/** Mobile number: optional, but if filled must be valid */
export const mobile = phone;

/** Email: optional, but if filled must be valid */
export const emailOptional = email;

/** Email: required and valid */
export const emailRequired = composeValidators(required, email);

/** Code field: required, uppercase alphanumeric */
export const codeRequired = composeValidators(required, code);

/** Positive integer: required, >= 1 */
export const positiveInt = composeValidators(required, number, minValue(1));

/** SLA hours: required, 1-8760 (max 1 year) */
export const slaHours = composeValidators(
  required,
  number,
  minValue(1),
  maxValue(8760),
);

/**
 * Date strictly in the past — used for Date of Birth where today's date
 * is nonsensical. Accepts ISO strings from `<input type="date">` (e.g.
 * "2026-05-12"), epoch numbers, and Date instances. Empty values pass
 * (compose with `required` to also require a value).
 *
 * Closes the "DOB accepts today" point on egovernments/CCRS#484.
 */
export const dateInPast = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;
  let ms: number;
  if (typeof value === 'number') {
    ms = value;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'string') {
    // `<input type="date">` ships "YYYY-MM-DD". `new Date("YYYY-MM-DD")` parses
    // as UTC midnight, while our comparison anchor (`todayStart` below) is
    // local midnight — in negative-UTC-offset tenants that mismatch lets
    // today's date sneak through as "before today". Parse the date-only form
    // as local-midnight so the comparison stays apples-to-apples regardless
    // of TZ. Fall back to native parsing for fully-qualified strings
    // (timestamps with a Z / ±HH:MM offset, RFC2822, etc.).
    const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (isoDateOnly) {
      const [, y, m, d] = isoDateOnly;
      ms = new Date(Number(y), Number(m) - 1, Number(d)).getTime();
    } else {
      ms = new Date(value).getTime();
    }
  } else {
    return 'Enter a valid date';
  }
  if (Number.isNaN(ms)) return 'Enter a valid date';
  const now = new Date();
  // Strict comparison at day granularity — today's midnight onward is rejected.
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= todayStart) return 'Date must be in the past';
  return undefined;
};

/** Date of Birth — required and strictly before today. */
export const dobRequired = composeValidators(required, dateInPast);

// Re-export composeValidators for custom combos
export { composeValidators };

// ra-core's `composeValidators` reduces multiple validators into a single
// function that does NOT carry `.isRequired`, so `useInput.isRequired` returns
// false and DigitFormInput skips the visible "*" mark even when one of the
// composed validators is `required`. Mark the composed result so the form
// surfaces the asterisk (closes egovernments/CCRS#462).
const flagRequired = (fn: ReturnType<typeof composeValidators>) => {
  (fn as unknown as { isRequired?: boolean }).isRequired = true;
  return fn;
};

flagRequired(name);
flagRequired(mobileRequired);
flagRequired(emailRequired);
flagRequired(codeRequired);
flagRequired(positiveInt);
flagRequired(slaHours);
flagRequired(dobRequired);
