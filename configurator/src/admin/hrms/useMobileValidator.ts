import { useMemo } from 'react';
import { useGetList, type Validator } from 'ra-core';

export interface MobileRules {
  pattern: string;
  minLength: number;
  maxLength: number;
  errorMessage: string;
  prefix?: string;
}

// Kenya default — used when MDMS `ValidationConfigs.mobileNumberValidation`
// is missing or unreadable. The canonical naipepea seed is `^[17][0-9]{8}$`
// with min=max=9, matching the local subscriber number convention.
const FALLBACK: MobileRules = {
  pattern: '^[17][0-9]{8}$',
  minLength: 9,
  maxLength: 9,
  prefix: '+254',
  errorMessage:
    'Please enter a valid Kenyan mobile number (9 digits starting with 1 or 7)',
};

function parseRules(record: Record<string, unknown> | undefined): MobileRules {
  if (!record) return FALLBACK;
  const raw = record.rules as Record<string, unknown> | undefined;
  if (!raw) return FALLBACK;
  return {
    pattern: typeof raw.pattern === 'string' ? raw.pattern : FALLBACK.pattern,
    minLength: typeof raw.minLength === 'number' ? raw.minLength : FALLBACK.minLength,
    maxLength: typeof raw.maxLength === 'number' ? raw.maxLength : FALLBACK.maxLength,
    prefix: typeof raw.prefix === 'string' ? raw.prefix : FALLBACK.prefix,
    errorMessage:
      typeof raw.errorMessage === 'string' && raw.errorMessage
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
