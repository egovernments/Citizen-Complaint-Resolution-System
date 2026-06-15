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
// is missing or unreadable. Accept both the bare 9-digit subscriber number
// (`712345678`) AND the everyday form prefixed with a trunk `0`
// (`0712345678`) — Gurjeet's regression on #459/#471/#476 was hitting the
// strict 9-digit fallback after typing the latter (correct local format).
// Matches `phoneKE` in `src/admin/validation.ts` so all employee forms
// share one accept-set.
const FALLBACK: MobileRules = {
  pattern: '^0?[17][0-9]{8}$',
  minLength: 9,
  maxLength: 10,
  prefix: '+254',
  errorMessage:
    'Please enter a valid Kenyan mobile number (9 digits starting with 1 or 7, optional leading 0)',
};

function parseRules(record: Record<string, unknown> | undefined): MobileRules {
  if (!record) return FALLBACK;
  const raw = record.rules as Record<string, unknown> | undefined;
  if (!raw) return FALLBACK;
  // common-masters.UserValidation keeps the dial-code under `attributes.prefix`
  // (ValidationConfigs.mobileNumberValidation kept it under `rules.prefix`),
  // so read attributes first and fall back to rules for the legacy shape.
  const attributes = record.attributes as Record<string, unknown> | undefined;
  const prefix =
    typeof attributes?.prefix === 'string' ? attributes.prefix
    : typeof raw.prefix === 'string' ? (raw.prefix as string)
    : FALLBACK.prefix;
  return {
    pattern: typeof raw.pattern === 'string' ? raw.pattern : FALLBACK.pattern,
    minLength: typeof raw.minLength === 'number' ? raw.minLength : FALLBACK.minLength,
    maxLength: typeof raw.maxLength === 'number' ? raw.maxLength : FALLBACK.maxLength,
    prefix,
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
  // Source: common-masters.UserValidation (the `user-validation` resource).
  // Pick the record whose fieldType === 'mobile' (preferring an active default),
  // and read its rules.
  const { data, isLoading } = useGetList('user-validation', {
    pagination: { page: 1, perPage: 50 },
    sort: { field: 'fieldType', order: 'ASC' },
  });

  const rules = useMemo<MobileRules>(() => {
    if (!data || data.length === 0) return FALLBACK;
    const mobileRecords = data.filter((r) => {
      const rec = r as Record<string, unknown>;
      return rec.fieldType === 'mobile' && rec.isActive !== false;
    });
    const preferred =
      mobileRecords.find((r) => (r as Record<string, unknown>).default === true) ??
      mobileRecords[0] ??
      null;
    if (!preferred) return FALLBACK;
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
