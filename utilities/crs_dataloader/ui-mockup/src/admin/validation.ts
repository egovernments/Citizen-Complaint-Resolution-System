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

// Re-export composeValidators for custom combos
export { composeValidators };
