import { useMemo } from 'react';
import { useGetList, type Validator } from 'ra-core';

export interface MobileRules {
  pattern: string;
  minLength: number;
  maxLength: number;
  errorMessage: string;
  prefix?: string;
}

// HRMS-side hard minimum. Its DTO has a @Pattern that requires exactly 10
// digits regardless of what MDMS's ValidationConfigs.mobileNumberValidation
// permits. Clamp the effective rules so the form never accepts 9-digit input
// that HRMS will reject downstream.
const HRMS_MIN_LENGTH = 10;

// Kenya default — matches MDMS `ValidationConfigs.mobileNumberValidation`
// at tenant `ke`, tightened to HRMS's 10-digit floor.
const FALLBACK: MobileRules = {
  pattern: '^0?[17][0-9]{8}$',
  minLength: HRMS_MIN_LENGTH,
  maxLength: 10,
  prefix: '+254',
  errorMessage:
    'Enter a 10-digit Kenyan mobile starting with 07 or 01 (e.g. 0712345678)',
};

function parseRules(record: Record<string, unknown> | undefined): MobileRules {
  if (!record) return FALLBACK;
  const raw = record.rules as Record<string, unknown> | undefined;
  if (!raw) return FALLBACK;
  const mdmsMin = typeof raw.minLength === 'number' ? raw.minLength : FALLBACK.minLength;
  const minLength = Math.max(mdmsMin, HRMS_MIN_LENGTH);
  const clamped = minLength > mdmsMin;
  return {
    pattern: typeof raw.pattern === 'string' ? raw.pattern : FALLBACK.pattern,
    minLength,
    maxLength:
      typeof raw.maxLength === 'number' ? raw.maxLength : FALLBACK.maxLength,
    prefix: typeof raw.prefix === 'string' ? raw.prefix : FALLBACK.prefix,
    // HRMS rejects 9-digit input even if MDMS allows it, so when the MDMS
    // rule was looser than HRMS's 10-digit floor we replace the message
    // rather than mislead operators with MDMS's "9 or 10 digits" phrasing.
    errorMessage: clamped
      ? FALLBACK.errorMessage
      : typeof raw.errorMessage === 'string' && raw.errorMessage
      ? raw.errorMessage
      : FALLBACK.errorMessage,
  };
}

export interface UseMobileValidatorResult {
  rules: MobileRules;
  validator: Validator;
  isLoading: boolean;
}

export function useMobileValidator(): UseMobileValidatorResult {
  const { data, isLoading } = useGetList('mobile-validation', {
    pagination: { page: 1, perPage: 20 },
    sort: { field: 'validationName', order: 'ASC' },
  });

  const rules = useMemo<MobileRules>(() => {
    if (!data || data.length === 0) return FALLBACK;
    const preferred =
      data.find(
        (r) =>
          (r as Record<string, unknown>).validationName ===
          'defaultMobileValidation',
      ) ?? data[0];
    return parseRules(preferred as Record<string, unknown>);
  }, [data]);

  const validator = useMemo<Validator>(() => {
    let compiled: RegExp | null = null;
    try {
      compiled = new RegExp(rules.pattern);
    } catch {
      compiled = null;
    }
    const fn: Validator = (value: unknown) => {
      if (value === undefined || value === null || value === '') {
        return 'Required';
      }
      const s = String(value);
      if (s.length < rules.minLength || s.length > rules.maxLength) {
        return rules.errorMessage;
      }
      if (compiled && !compiled.test(s)) {
        return rules.errorMessage;
      }
      return undefined;
    };
    // ra-core `useInput` exposes `isRequired` based on a flag on the
    // validator function — without it the field gets no "*" mark in
    // DigitFormInput. The mobile validator is built dynamically (rules
    // come from MDMS) so we can't compose with `required` upfront via
    // validation.ts's flagRequired; tag the dynamic result here instead.
    // Closes the missing-asterisk point on egovernments/CCRS#484.
    (fn as unknown as { isRequired?: boolean }).isRequired = true;
    return fn;
  }, [rules]);

  return { rules, validator, isLoading };
}
