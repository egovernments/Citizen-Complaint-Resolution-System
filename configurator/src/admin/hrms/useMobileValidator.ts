import { useMemo } from 'react';
import { useGetList, type Validator } from 'ra-core';

export interface MobileRules {
  mobileNumberRegex: string;
  pattern: string;
  countryCode?: string;
  prefix?: string;
  maxLength: number;
  errorMessage: string;
}

const FALLBACK_REGEX = '^0?[17][0-9]{8}$';
const FALLBACK_COUNTRY_CODE = '+254';

// ── regex analysers ──────────────────────────────────────────────────────────
// Parse a regex string to derive min/max digit length and the first mandatory
// character class — both used to build a human-readable error message.

function computeRegexLengths(pattern: string): { min: number; max: number } {
  const s = pattern.replace(/^\^/, '').replace(/\$$/, '');
  let min = 0, max = 0, i = 0;

  while (i < s.length) {
    // Determine where this atom ends
    let atomEnd = i;
    if (s[i] === '[') {
      const end = s.indexOf(']', i + 1);
      atomEnd = end === -1 ? i + 1 : end + 1;
    } else if (s[i] === '\\') {
      atomEnd = i + 2;
    } else if (s[i] === '(') {
      let depth = 1;
      atomEnd = i + 1;
      while (atomEnd < s.length && depth > 0) {
        if (s[atomEnd] === '(') depth++;
        else if (s[atomEnd] === ')') depth--;
        atomEnd++;
      }
    } else {
      atomEnd = i + 1;
    }

    // Determine quantifier contribution
    let atomMin = 1, atomMax = 1, qi = atomEnd;
    if (qi < s.length) {
      if (s[qi] === '?') { atomMin = 0; atomMax = 1; qi++; }
      else if (s[qi] === '*') { atomMin = 0; atomMax = 999; qi++; }
      else if (s[qi] === '+') { atomMin = 1; atomMax = 999; qi++; }
      else if (s[qi] === '{') {
        const end = s.indexOf('}', qi);
        if (end !== -1) {
          const parts = s.slice(qi + 1, end).split(',');
          atomMin = parseInt(parts[0], 10) || 0;
          atomMax = parts.length > 1
            ? (parts[1].trim() ? parseInt(parts[1], 10) : 999)
            : atomMin;
          qi = end + 1;
        }
      }
    }
    min += atomMin;
    max += atomMax;
    i = qi;
  }

  return { min, max: max > 900 ? -1 : max };
}

function extractFirstMandatoryClass(pattern: string): string | null {
  const s = pattern.replace(/^\^/, '').replace(/\$$/, '');
  let i = 0;
  while (i < s.length) {
    let content: string | null = null;
    let atomEnd: number;
    if (s[i] === '[') {
      const end = s.indexOf(']', i + 1);
      if (end === -1) break;
      content = s.slice(i + 1, end);
      atomEnd = end + 1;
    } else if (s[i] === '\\') {
      // \d treated as any digit class
      content = s[i + 1] === 'd' ? '0-9' : null;
      atomEnd = i + 2;
    } else {
      content = s[i]; // literal character
      atomEnd = i + 1;
    }
    // Skip optional atoms
    if (atomEnd < s.length && s[atomEnd] === '?') { i = atomEnd + 1; continue; }
    return content;
  }
  return null;
}

function describeCharClass(cls: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < cls.length) {
    if (i + 2 < cls.length && cls[i + 1] === '-') {
      parts.push(`${cls[i]}-${cls[i + 2]}`);
      i += 3;
    } else {
      parts.push(cls[i]);
      i++;
    }
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} or ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1]}`;
}

// Build a human-readable validation hint from the regex alone.
// Examples:
//   ^0?[17][0-9]{8}$  →  "Please enter a valid mobile number (9-10 digits, starting with 1 or 7)"
//   ^[6-9][0-9]{9}$   →  "Please enter a valid mobile number (10 digits, starting with 6-9)"
function buildErrorMessage(regex: string): string {
  const { min, max } = computeRegexLengths(regex);
  const firstClass = extractFirstMandatoryClass(regex);

  const isGeneric =
    !firstClass || firstClass === '0-9' || firstClass === 'd' || firstClass === '\\d';
  const startPart = !isGeneric
    ? `, starting with ${describeCharClass(firstClass!)}`
    : '';

  const lenPart =
    min === max ? `${min} digits` :
    max === -1  ? `at least ${min} digits` :
    `${min}-${max} digits`;

  return `Please enter a valid mobile number (${lenPart}${startPart})`;
}

// ── globalConfigs fallback ───────────────────────────────────────────────────
// Read CORE_MOBILE_CONFIGS from globalConfigs.js (injected by Ansible/nginx).
// Fields: countryCode (E.164 prefix) + mobileNumberRegex.

function readGlobalMobileConfig(): { mobileNumberRegex: string; countryCode: string } | null {
  if (typeof window === 'undefined') return null;
  const gc = (
    window as unknown as Record<string, { getConfig?: (key: string) => Record<string, unknown> | undefined }>
  ).globalConfigs?.getConfig?.('CORE_MOBILE_CONFIGS');
  if (!gc) return null;
  const regex = (gc.mobileNumberRegex as string | undefined);
  if (!regex) return null;
  const countryCode = (gc.countryCode as string | undefined) ?? '';
  return { mobileNumberRegex: regex, countryCode };
}

// ── rule builder ─────────────────────────────────────────────────────────────
// Convert an MDMS record or globalConfigs object into MobileRules.
// min/max lengths are derived from the regex; error message is built dynamically.

function parseRules(record: Record<string, unknown>): MobileRules {
  const regex =
    typeof record.mobileNumberRegex === 'string' ? record.mobileNumberRegex :
    typeof record.mobileNumberPattern === 'string' ? record.mobileNumberPattern :
    FALLBACK_REGEX;
  const countryCode =
    typeof record.countryCode === 'string' ? record.countryCode :
    FALLBACK_COUNTRY_CODE;

  const { max } = computeRegexLengths(regex);
  return {
    mobileNumberRegex: regex,
    pattern: regex,
    countryCode,
    prefix: countryCode,
    maxLength: max === -1 ? 15 : max,
    errorMessage: buildErrorMessage(regex),
  };
}

export interface UseMobileValidatorResult {
  rules: MobileRules;
  validator: Validator;
  isLoading: boolean;
}

export function useMobileValidator(): UseMobileValidatorResult {
  // Source priority:
  //   1. MDMS common-masters.MobileNumberValidation (operator-managed, per-tenant)
  //   2. globalConfigs.CORE_MOBILE_CONFIGS (Ansible-injected, per-deployment)
  //   3. Hardcoded fallback (Kenya defaults — keeps the app functional on bare dev boxes)
  const { data, isLoading } = useGetList('mobile-number-validation', {
    pagination: { page: 1, perPage: 50 },
    sort: { field: 'countryCode', order: 'ASC' },
  });

  const rules = useMemo<MobileRules>(() => {
    // 1. MDMS
    if (data && data.length > 0) {
      const active = data.filter((r) => (r as Record<string, unknown>).isActive !== false);
      const preferred =
        active.find((r) => (r as Record<string, unknown>).default === true) ??
        active[0] ??
        null;
      if (preferred) return parseRules(preferred as Record<string, unknown>);
    }
    // 2. globalConfigs
    const gc = readGlobalMobileConfig();
    if (gc) return parseRules(gc);
    // 3. Hard fallback
    return parseRules({ mobileNumberRegex: FALLBACK_REGEX, countryCode: FALLBACK_COUNTRY_CODE });
  }, [data]);

  const validator = useMemo<Validator>(() => {
    let compiled: RegExp | null = null;
    try {
      compiled = new RegExp(rules.mobileNumberRegex);
    } catch {
      compiled = null;
    }
    const fn: Validator = (value: unknown) => {
      if (value === undefined || value === null || value === '') return 'Required';
      const s = String(value);
      if (compiled && !compiled.test(s)) return rules.errorMessage;
      return undefined;
    };
    // ra-core reads isRequired from the validator function to decide whether to
    // render the "*" required marker on the field label.
    (fn as unknown as { isRequired?: boolean }).isRequired = true;
    return fn;
  }, [rules]);

  return { rules, validator, isLoading };
}
