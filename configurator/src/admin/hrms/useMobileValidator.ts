import { useMemo } from 'react';
import { useGetList, type Validator } from 'ra-core';

export interface MobileRules {
  mobileNumberRegex: string;
  pattern: string;        // backward-compat alias for mobileNumberRegex
  countryCode?: string;
  prefix?: string;        // backward-compat alias for countryCode
  minLength: number;
  maxLength: number;
  errorMessage: string;
}

// Kenya default — used when MDMS `common-masters.MobileNumberValidation`
// is missing or unreadable. Accept both the bare 9-digit subscriber number
// (`712345678`) AND the everyday form prefixed with a trunk `0`
// (`0712345678`) — Gurjeet's regression on #459/#471/#476 was hitting the
// strict 9-digit fallback after typing the latter (correct local format).
// Matches `phoneKE` in `src/admin/validation.ts` so all employee forms
// share one accept-set.
const FALLBACK: MobileRules = {
  mobileNumberRegex: '^0?[17][0-9]{8}$',
  pattern: '^0?[17][0-9]{8}$',
  minLength: 9,
  maxLength: 10,
  countryCode: '+254',
  prefix: '+254',
  errorMessage:
    'Please enter a valid Kenyan mobile number (9 digits starting with 1 or 7, optional leading 0)',
};

function parseRules(record: Record<string, unknown> | undefined): MobileRules {
  if (!record) return FALLBACK;
  // common-masters.MobileNumberValidation uses a flat structure:
  // { countryCode, mobileNumberRegex, default }
  const regex =
    typeof record.mobileNumberRegex === 'string' ? record.mobileNumberRegex : FALLBACK.mobileNumberRegex;
  const countryCode =
    typeof record.countryCode === 'string' ? record.countryCode : FALLBACK.countryCode;
  return {
    mobileNumberRegex: regex,
    pattern: regex,
    countryCode,
    prefix: countryCode,
    // minLength/maxLength/errorMessage are not in the new schema; keep fallback values
    minLength: FALLBACK.minLength,
    maxLength: FALLBACK.maxLength,
    errorMessage: FALLBACK.errorMessage,
  };
}

export interface UseMobileValidatorResult {
  rules: MobileRules;
  validator: Validator;
  isLoading: boolean;
}

export function useMobileValidator(): UseMobileValidatorResult {
  // Source: common-masters.MobileNumberValidation (the `user-validation` resource,
  // schema updated to MobileNumberValidation). Pick the record with default:true.
  const { data, isLoading } = useGetList('user-validation', {
    pagination: { page: 1, perPage: 50 },
    sort: { field: 'countryCode', order: 'ASC' },
  });

  const rules = useMemo<MobileRules>(() => {
    if (!data || data.length === 0) return FALLBACK;
    const activeRecords = data.filter((r) => {
      const rec = r as Record<string, unknown>;
      return rec.isActive !== false;
    });
    const preferred =
      activeRecords.find((r) => (r as Record<string, unknown>).default === true) ??
      activeRecords[0] ??
      null;
    if (!preferred) return FALLBACK;
    return parseRules(preferred as Record<string, unknown>);
  }, [data]);

  const validator = useMemo<Validator>(() => {
    let compiled: RegExp | null = null;
    try {
      compiled = new RegExp(rules.mobileNumberRegex);
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
