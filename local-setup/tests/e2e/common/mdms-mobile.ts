/**
 * Mobile-number validation rule, sourced from MDMS.
 *
 * Reads the rule under MDMS schema `common-masters.MobileNumberValidation`
 * for the active tenant — the same rule the citizen + employee login forms
 * use. Lets specs stay tenant-agnostic: the same test passes against an
 * Ethiopia tenant (9-digit starting with 1/7), a Kenya tenant (9-digit),
 * and a 10-digit Indian deployment without per-tenant constants.
 *
 * Public API (keep stable across ports — see memory feedback_mdms_mobile_helper):
 *   getMobileValidationRule(tenant, opts) -> Promise<MobileRule>
 *   generateValidMobile(rule)            -> string
 *   generateInvalidMobile(rule, kind)    -> string
 *
 * If the MDMS lookup fails (auth, schema missing, network), falls back to
 * a 10-digit numeric default — the same shape the configurator's UI uses
 * for new tenants that haven't seeded a rule yet.
 */
import { getDigitToken } from '../utils/auth';

export interface MobileRule {
  prefix?: string;
  pattern: string;
  minLength: number;
  maxLength: number;
  errorMessage: string;
  allowedStartingDigits?: string[];
}

const FALLBACK: MobileRule = {
  pattern: '^\\d{10}$',
  minLength: 10,
  maxLength: 10,
  errorMessage: 'Please enter a valid 10-digit mobile number',
};

export interface MobileRuleOptions {
  baseURL?: string;
  rootTenant?: string;
  adminUser?: string;
  adminPassword?: string;
}

/**
 * Derive min/max digit counts from a mobile-number regex.
 * Tries every (lead, fill) digit combo at lengths 5–15 and records which
 * lengths produce a match. Falls back to {min:10, max:10} if the regex
 * is invalid or no length matches.
 */
function deriveMobileLengths(regex: string): { min: number; max: number } {
  let re: RegExp | null = null;
  try { re = new RegExp(regex); } catch { return { min: 10, max: 10 }; }
  let min = 16, max = 0;
  for (const f of '0123456789') {
    for (const d of '0123456789') {
      for (let len = 5; len <= 15; len++) {
        if (re.test(f + d.repeat(len - 1))) {
          if (len < min) min = len;
          if (len > max) max = len;
        }
      }
    }
  }
  return max > 0 ? { min, max } : { min: 10, max: 10 };
}

/**
 * Fetch the live mobile-validation rule for `tenant` from MDMS.
 *
 * Authenticates against `rootTenant` (defaults to env ROOT_TENANT or the
 * supplied tenant) with admin credentials, then queries MDMS v2 for the
 * `common-masters.MobileNumberValidation` schema scoped to `tenant`.
 * Returns the record whose `data.default === true` if present, otherwise
 * the first record. Falls back to a 10-digit numeric rule on any failure.
 */
export async function getMobileValidationRule(
  tenant: string,
  opts: MobileRuleOptions = {},
): Promise<MobileRule> {
  const baseURL = opts.baseURL ?? process.env.BASE_URL ?? 'http://localhost:18080';
  const rootTenant = opts.rootTenant ?? process.env.ROOT_TENANT ?? tenant;
  const adminUser = opts.adminUser ?? process.env.ADMIN_USER ?? process.env.DIGIT_EMPLOYEE_USER ?? 'ADMIN';
  const adminPassword =
    opts.adminPassword ?? process.env.ADMIN_PASSWORD ?? process.env.DIGIT_EMPLOYEE_PASSWORD ?? 'eGov@123';

  try {
    const token = await getDigitToken({
      baseURL,
      tenant: rootTenant,
      username: adminUser,
      password: adminPassword,
      userType: 'EMPLOYEE',
    });
    const ri = {
      apiId: 'Rainmaker',
      ver: '1.0',
      ts: Date.now(),
      msgId: `${Date.now()}|en_IN`,
      authToken: token.access_token,
    };
    const resp = await fetch(`${baseURL}/mdms-v2/v2/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: ri,
        MdmsCriteria: {
          tenantId: tenant,
          schemaCode: 'common-masters.MobileNumberValidation',
        },
      }),
    });
    if (!resp.ok) return FALLBACK;
    const json = (await resp.json()) as {
      mdms?: Array<{ data?: { countryCode?: string; mobileNumberRegex?: string; default?: boolean } }>;
    };
    const records = json.mdms ?? [];
    const preferred = records.find((r) => r.data?.default === true) ?? records[0];
    const data = preferred?.data;
    if (!data?.mobileNumberRegex) return FALLBACK;
    const lengths = deriveMobileLengths(data.mobileNumberRegex);
    return {
      prefix: typeof data.countryCode === 'string' ? data.countryCode : undefined,
      pattern: data.mobileNumberRegex,
      minLength: lengths.min,
      maxLength: lengths.max,
      errorMessage: `Please enter a valid ${lengths.max}-digit mobile number`,
      allowedStartingDigits: derivedStartingDigits(data.mobileNumberRegex) ?? undefined,
    };
  } catch {
    return FALLBACK;
  }
}

function randomDigit(): string {
  return Math.floor(Math.random() * 10).toString();
}

/**
 * Build a phone string that satisfies the supplied rule. Uses
 * `allowedStartingDigits` (if present) plus random digits to reach
 * `minLength`. Verifies against the rule's regex before returning;
 * regenerates up to 50 times in the rare case randomness produces a
 * non-matching number.
 */
export function generateValidMobile(rule: MobileRule): string {
  const len = rule.minLength;
  const starters =
    rule.allowedStartingDigits && rule.allowedStartingDigits.length > 0
      ? rule.allowedStartingDigits
      : derivedStartingDigits(rule.pattern) ?? ['5', '6', '7', '8', '9'];
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(rule.pattern);
  } catch {
    compiled = null;
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const head = starters[Math.floor(Math.random() * starters.length)];
    let body = '';
    for (let i = 1; i < len; i++) body += randomDigit();
    const candidate = head + body;
    if (!compiled || compiled.test(candidate)) return candidate;
  }
  return (starters[0] || '0').padEnd(len, '0');
}

/**
 * Build a phone string that fails the supplied rule.
 *   'short'       — half the min length; never satisfies length checks.
 *   'wrong-start' — first digit is one the allowed-starters set forbids.
 */
export function generateInvalidMobile(
  rule: MobileRule,
  kind: 'short' | 'wrong-start' = 'short',
): string {
  const starters =
    rule.allowedStartingDigits && rule.allowedStartingDigits.length > 0
      ? rule.allowedStartingDigits
      : derivedStartingDigits(rule.pattern) ?? [];
  if (kind === 'wrong-start' && starters.length > 0) {
    const forbidden = '0123456789'.split('').find((d) => !starters.includes(d));
    const head = forbidden ?? '0';
    let body = '';
    for (let i = 1; i < rule.minLength; i++) body += randomDigit();
    return head + body;
  }
  const target = Math.max(1, Math.floor(rule.minLength / 2));
  let out = '';
  for (let i = 0; i < target; i++) out += randomDigit();
  return out;
}

/**
 * If the rule's regex starts with a character class like `^[17]` or
 * `^[6-9]`, extract the allowed starting digits from it. Lets
 * generateValidMobile do the right thing even when MDMS only ships
 * the regex (without `allowedStartingDigits`).
 */
function derivedStartingDigits(pattern: string): string[] | null {
  const m = pattern.match(/^\^?\[([0-9\-]+)\]/);
  if (!m) return null;
  const body = m[1];
  const set = new Set<string>();
  let i = 0;
  while (i < body.length) {
    if (i + 2 < body.length && body[i + 1] === '-') {
      const start = parseInt(body[i], 10);
      const end = parseInt(body[i + 2], 10);
      if (Number.isInteger(start) && Number.isInteger(end)) {
        for (let c = start; c <= end; c++) set.add(String(c));
      }
      i += 3;
    } else {
      set.add(body[i]);
      i++;
    }
  }
  return [...set];
}
