/**
 * Mobile-number validation rule, sourced from MDMS.
 *
 * The citizen + employee login forms validate against the rule stored
 * under MDMS schema `ValidationConfigs.mobileNumberValidation` for the
 * active tenant. The rule controls:
 *   - prefix     (country code shown to the user, e.g. "+254")
 *   - pattern    (regex applied to the entered number)
 *   - minLength / maxLength
 *   - errorMessage  (the human-readable string the UI surfaces inline)
 *   - allowedStartingDigits
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
        MdmsCriteria: { tenantId: tenant, schemaCode: 'ValidationConfigs.mobileNumberValidation' },
      }),
    });
    if (!resp.ok) return FALLBACK;
    const json = (await resp.json()) as {
      mdms?: Array<{ uniqueIdentifier?: string; data?: { rules?: Partial<MobileRule> } }>;
    };
    const records = json.mdms ?? [];
    const preferred =
      records.find((r) => r.uniqueIdentifier === 'defaultMobileValidation') ?? records[0];
    const rules = preferred?.data?.rules;
    if (!rules) return FALLBACK;
    return {
      prefix: typeof rules.prefix === 'string' ? rules.prefix : undefined,
      pattern: typeof rules.pattern === 'string' ? rules.pattern : FALLBACK.pattern,
      minLength: typeof rules.minLength === 'number' ? rules.minLength : FALLBACK.minLength,
      maxLength: typeof rules.maxLength === 'number' ? rules.maxLength : FALLBACK.maxLength,
      errorMessage: typeof rules.errorMessage === 'string' ? rules.errorMessage : FALLBACK.errorMessage,
      allowedStartingDigits: Array.isArray(rules.allowedStartingDigits)
        ? (rules.allowedStartingDigits as string[])
        : undefined,
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
