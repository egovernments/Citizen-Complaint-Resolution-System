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
 * Kenya citizen mobile: 9 digits starting with 7 or 1, optionally
 * prefixed with 0. Matches MDMS `ValidationConfigs.mobileNumberValidation`
 * at tenant `ke`. NOT clamped to the HRMS 10-digit floor — citizens have
 * no HRMS-side @Pattern constraint.
 */
export const phoneKE = raRegex(
  /^0?[17][0-9]{8}$/,
  'Enter a valid Kenyan mobile starting with 7 or 1 (e.g. 712345678)',
);

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

/** Kenya citizen mobile: required, 9-or-10-digit Kenyan format */
export const mobileKERequired = composeValidators(required, phoneKE);

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
flagRequired(mobileKERequired);
flagRequired(emailRequired);
flagRequired(codeRequired);
flagRequired(positiveInt);
flagRequired(slaHours);
flagRequired(dobRequired);
