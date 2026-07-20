import { useMemo } from 'react';
import { useGetList, useTranslate, type Validator } from 'ra-core';

export interface MobileRules {
  mobileNumberRegex: string;
  pattern: string;
  countryCode?: string;
  prefix?: string;
  maxLength: number;
  errorMessage: string;
}

// Last-resort fallback used only when BOTH the MDMS `mobile-number-validation`
// master AND globalConfigs are unavailable. Deliberately country-neutral: a
// permissive 7–15 digit rule (E.164 subscriber range) with no dialling-prefix
// assumption, so an unseeded tenant can still create/edit citizen users instead
// of being bricked by a rule shaped for a different country. MDMS/globalConfigs
// remain authoritative when present.
const FALLBACK_REGEX = '^[0-9]{7,15}$';
const FALLBACK_COUNTRY_CODE = '';

// ── regex analysers ──────────────────────────────────────────────────────────
// Parse a regex string to derive min/max digit length and the first mandatory
// character class — both used to build a human-readable error message.

function _splitAlternation(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[') { const e = s.indexOf(']', i + 1); if (e !== -1) i = e; }
    else if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === '|' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts;
}

function _computeFragmentLengths(s: string): { min: number; max: number } {
  let min = 0, max = 0, i = 0;
  while (i < s.length) {
    let atomEnd = i;
    let baseMin = 1, baseMax = 1;
    if (s[i] === '[') {
      const end = s.indexOf(']', i + 1);
      atomEnd = end === -1 ? i + 1 : end + 1;
    } else if (s[i] === '\\') {
      atomEnd = i + 2;
    } else if (s[i] === '(') {
      let depth = 1; atomEnd = i + 1;
      while (atomEnd < s.length && depth > 0) {
        if (s[atomEnd] === '(') depth++;
        else if (s[atomEnd] === ')') depth--;
        atomEnd++;
      }
      let inner = s.slice(i + 1, atomEnd - 1);
      if (/^\?[=!]/.test(inner) || /^\?<[=!]/.test(inner)) {
        baseMin = 0; baseMax = 0;
      } else {
        if (inner.startsWith('?:')) inner = inner.slice(2);
        else if (inner.startsWith('?')) inner = inner.slice(1);
        const alts = _splitAlternation(inner);
        if (alts.length > 1) {
          const lens = alts.map(_computeFragmentLengths);
          baseMin = Math.min(...lens.map(l => l.min));
          const maxes = lens.map(l => l.max);
          baseMax = maxes.includes(-1) ? Infinity : Math.max(...maxes);
        } else {
          const g = _computeFragmentLengths(inner);
          baseMin = g.min;
          baseMax = g.max === -1 ? Infinity : g.max;
        }
      }
    } else {
      atomEnd = i + 1;
    }
    let repMin = 1, repMax = 1, qi = atomEnd;
    if (qi < s.length) {
      if (s[qi] === '?') { repMin = 0; repMax = 1; qi++; }
      else if (s[qi] === '*') { repMin = 0; repMax = Infinity; qi++; }
      else if (s[qi] === '+') { repMin = 1; repMax = Infinity; qi++; }
      else if (s[qi] === '{') {
        const end = s.indexOf('}', qi);
        if (end !== -1) {
          const parts = s.slice(qi + 1, end).split(',');
          repMin = parseInt(parts[0], 10) || 0;
          repMax = parts.length > 1 ? (parts[1].trim() ? parseInt(parts[1], 10) : Infinity) : repMin;
          qi = end + 1;
        }
      }
    }
    min += baseMin * repMin;
    max += (baseMax === Infinity || repMax === Infinity) ? Infinity : baseMax * repMax;
    i = qi;
  }
  return { min, max: isFinite(max) ? max : -1 };
}

function computeRegexLengths(pattern: string): { min: number; max: number } {
  const s = pattern.replace(/^\^/, '').replace(/\$$/, '');
  return _computeFragmentLengths(s);
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
      content = s[i + 1] === 'd' ? '0-9' : null;
      atomEnd = i + 2;
    } else {
      content = s[i];
      atomEnd = i + 1;
    }
    if (atomEnd < s.length && s[atomEnd] === '?') { i = atomEnd + 1; continue; }
    return content;
  }
  return null;
}

type TranslateFn = (key: string, fallback: string) => string;

function describeCharClass(cls: string, or: string): string {
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
  if (parts.length === 2) return `${parts[0]} ${or} ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, ${or} ${parts[parts.length - 1]}`;
}

// Localization keys (module: configurator-ui):
//   ERR_INVALID_MOBILE_NUMBER, MOBILE_VALIDATION_DIGITS, MOBILE_VALIDATION_AT_LEAST,
//   MOBILE_VALIDATION_STARTING_WITH, MOBILE_VALIDATION_OR
function buildErrorMessage(regex: string, t: TranslateFn = (_, fb) => fb): string {
  const base    = t('ERR_INVALID_MOBILE_NUMBER',       'Please enter a valid mobile number');
  const digits  = t('MOBILE_VALIDATION_DIGITS',        'digits');
  const atLeast = t('MOBILE_VALIDATION_AT_LEAST',      'at least');
  const sw      = t('MOBILE_VALIDATION_STARTING_WITH', 'starting with');
  const or      = t('MOBILE_VALIDATION_OR',            'or');

  const { min, max } = computeRegexLengths(regex);
  const firstClass = extractFirstMandatoryClass(regex);
  const isGeneric = !firstClass || firstClass === '0-9' || firstClass === 'd' || firstClass === '\\d';

  const lenPart =
    min === max ? `${min} ${digits}` :
    max === -1  ? `${atLeast} ${min} ${digits}` :
    `${min}-${max} ${digits}`;

  const startPart = !isGeneric ? `, ${sw} ${describeCharClass(firstClass!, or)}` : '';

  return `${base} (${lenPart}${startPart})`;
}

// ── globalConfigs fallback ───────────────────────────────────────────────────
// Read CORE_MOBILE_CONFIGS from globalConfigs.js (injected by Ansible/nginx).

function readGlobalMobileConfig(): { mobileNumberRegex: string; countryCode: string } | null {
  if (typeof window === 'undefined') return null;
  const gc = (
    window as unknown as Record<string, { getConfig?: (key: string) => Record<string, unknown> | undefined }>
  ).globalConfigs?.getConfig?.('CORE_MOBILE_CONFIGS');
  if (!gc) return null;
  // The ansible playbook renders CORE_MOBILE_CONFIGS from host_vars
  // `core_mobile_configs`, whose keys are `mobileNumberPattern` / `mobilePrefix`.
  // Accept those alongside the `mobileNumberRegex` / `countryCode` aliases so
  // the globalConfigs fallback actually resolves the deployment's rule when
  // MDMS `mobile-number-validation` isn't seeded.
  const regex =
    (gc.mobileNumberRegex as string | undefined) ??
    (gc.mobileNumberPattern as string | undefined);
  if (!regex) return null;
  const countryCode =
    (gc.countryCode as string | undefined) ??
    (gc.mobilePrefix as string | undefined) ??
    '';
  return { mobileNumberRegex: regex, countryCode };
}

// ── rule builder ─────────────────────────────────────────────────────────────

function parseRules(record: Record<string, unknown>, t: TranslateFn = (_, fb) => fb): MobileRules {
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
    errorMessage: buildErrorMessage(regex, t),
  };
}

export interface UseMobileValidatorResult {
  rules: MobileRules;
  validator: Validator;
  isLoading: boolean;
}

export function useMobileValidator(): UseMobileValidatorResult {
  const raTranslate = useTranslate();

  const { data, isLoading } = useGetList('mobile-number-validation', {
    pagination: { page: 1, perPage: 50 },
    sort: { field: 'countryCode', order: 'ASC' },
  });

  const rules = useMemo<MobileRules>(() => {
    const t: TranslateFn = (key, fallback) => raTranslate(key, { _: fallback });

    // 1. MDMS
    if (data && data.length > 0) {
      const active = data.filter((r) => (r as Record<string, unknown>).isActive !== false);
      const preferred =
        active.find((r) => (r as Record<string, unknown>).default === true) ??
        active[0] ??
        null;
      if (preferred) return parseRules(preferred as Record<string, unknown>, t);
    }
    // 2. globalConfigs
    const gc = readGlobalMobileConfig();
    if (gc) return parseRules(gc, t);
    // 3. Hard fallback
    return parseRules({ mobileNumberRegex: FALLBACK_REGEX, countryCode: FALLBACK_COUNTRY_CODE }, t);
  }, [data, raTranslate]);

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
    (fn as unknown as { isRequired?: boolean }).isRequired = true;
    return fn;
  }, [rules]);

  return { rules, validator, isLoading };
}
