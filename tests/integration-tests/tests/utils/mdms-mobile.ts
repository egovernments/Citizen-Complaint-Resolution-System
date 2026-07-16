/**
 * Mobile-number validation rule, sourced from MDMS.
 *
 * The citizen + employee login forms validate against the rule stored
 * under MDMS schema `common-masters.MobileNumberValidation` for the
 * active tenant. The rule controls:
 *   - prefix     (country code shown to the user, e.g. "+254")
 *   - pattern    (mobileNumberRegex applied to the entered number)
 *   - minLength / maxLength (derived from the regex)
 *
 * Reading the rule here lets specs stay tenant-agnostic — the same test
 * passes against ke.nairobi (9-digit starting with 1/7) and a 10-digit
 * Indian deployment without per-tenant constants. Per CLAUDE.md this is
 * a setup helper, not test logic; the body of a test still drives the
 * UI.
 */
import { getDigitToken } from './auth';
import { BASE_URL } from './env';

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

const ROOT = process.env.ROOT_TENANT || 'ke';
const ADMIN_USER = process.env.ADMIN_USER || 'ADMIN';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'eGov@123';

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
 * If the rule's regex starts with a character class like `^[17]` or
 * `^[6-9]`, extract the allowed starting digits from it.
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

/**
 * Fetch the live mobile-validation rule for `tenant` from MDMS. Falls
 * back to a 10-digit-numeric default if the schema search fails — this
 * is the same shape the configurator's UI uses for new tenants that
 * haven't seeded a rule yet.
 */
export async function getMobileValidationRule(tenant: string): Promise<MobileRule> {
  try {
    const token = await getDigitToken({ tenant: ROOT, username: ADMIN_USER, password: ADMIN_PASS });
    const ri = {
      apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
      msgId: `${Date.now()}|en_IN`, authToken: token.access_token,
    };
    const resp = await fetch(`${BASE_URL}/mdms-v2/v2/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: ri,
        MdmsCriteria: { tenantId: tenant, schemaCode: 'common-masters.MobileNumberValidation' },
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
  const starters = rule.allowedStartingDigits && rule.allowedStartingDigits.length > 0
    ? rule.allowedStartingDigits
    : ['5', '6', '7', '8', '9'];
  let compiled: RegExp | null = null;
  try { compiled = new RegExp(rule.pattern); } catch { compiled = null; }
  for (let attempt = 0; attempt < 50; attempt++) {
    const head = starters[Math.floor(Math.random() * starters.length)];
    let body = '';
    for (let i = 1; i < len; i++) body += randomDigit();
    const candidate = head + body;
    if (!compiled || compiled.test(candidate)) return candidate;
  }
  // Fallback if randomness keeps missing the regex — just pad zeros.
  return (starters[0] || '0').padEnd(len, '0');
}

/**
 * Build a phone string that fails the supplied rule. Half the
 * `minLength` is always shorter and therefore invalid under
 * minLength/maxLength + a length-locked regex.
 */
export function generateInvalidMobile(rule: MobileRule, kind: 'short' | 'wrong-start' = 'short'): string {
  if (kind === 'wrong-start' && rule.allowedStartingDigits && rule.allowedStartingDigits.length > 0) {
    const forbidden = '0123456789'.split('').find((d) => !rule.allowedStartingDigits!.includes(d));
    const head = forbidden ?? '0';
    let body = '';
    for (let i = 1; i < rule.minLength; i++) body += randomDigit();
    return head + body;
  }
  // 'short' — half the min length, never satisfies minLength.
  const target = Math.max(1, Math.floor(rule.minLength / 2));
  let out = '';
  for (let i = 0; i < target; i++) out += randomDigit();
  return out;
}
