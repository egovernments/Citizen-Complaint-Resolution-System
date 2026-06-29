/**
 * Suite-wide citizen provisioning.
 *
 * Registers ONE fresh citizen per `npx playwright test` invocation against
 * the configured deployment, using a mobile number that satisfies the
 * deployment's MDMS ValidationConfigs.mobileNumberValidation rule (so the
 * suite stays tenant-agnostic — same code provisions an Ethiopia citizen
 * and a Kenya citizen, just by changing BASE_URL/DIGIT_TENANT).
 *
 * Flow (per user direction — "explicit OTP validation step needed"):
 *   1. MDMS lookup → mobile rule (prefix, pattern, allowedStartingDigits)
 *   2. generateValidMobile(rule) → a fresh phone that satisfies the regex
 *   3. /user-otp/v1/_send (type=register) → triggers OTP delivery
 *   4. /user/citizen/_create with the registration payload + otpReference
 *   5. /user-otp/v1/_send (type=login) → fresh login OTP
 *   6. /user/oauth/token (grant_type=password, userType=CITIZEN) → access token
 *   7. Return the identity (mobile, prefix, name, token, uuid, tenantId)
 *
 * Consumers (citizen-test specs) read the persisted identity from
 * citizen-fixture.json — written by tests/fixtures/citizen.setup.ts —
 * rather than re-provisioning. The user explicitly accepted that
 * provisioned citizens pollute the tenant (no afterAll cleanup).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE_URL, FIXED_OTP, ROOT_TENANT, TENANT, DEFAULT_PASSWORD, generateCitizenPhone } from './env';
import { getMobileValidationRule, generateValidMobile, type MobileRule } from './mdms-mobile';

export interface ProvisionedCitizen {
  mobile: string;
  prefix: string | undefined;
  name: string;
  token: string;
  uuid: string;
  tenantId: string;
}

const CITIZEN_FIXTURE_FILE = resolve('citizen-fixture.json');

/**
 * Read the citizen identity provisioned by tests/fixtures/citizen.setup.ts.
 * Returns null if the fixture is missing (citizen-setup didn't run, or
 * the spec is being executed in isolation outside the project DAG).
 */
export function readProvisionedCitizen(): ProvisionedCitizen | null {
  if (!existsSync(CITIZEN_FIXTURE_FILE)) return null;
  try {
    const raw = readFileSync(CITIZEN_FIXTURE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as ProvisionedCitizen;
    if (!parsed.mobile || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const CITIZEN_FIXTURE_PATH = CITIZEN_FIXTURE_FILE;

/**
 * Resolve the mobile-validation rule for this deployment. Tries the
 * passed tenant first, then ROOT_TENANT (where most deployments store
 * the default — Bomet ships the rule on `ke`, not `ke.etoebeta`). Falls
 * back to the FALLBACK rule built into getMobileValidationRule; the
 * register call below will refine that further by parsing the server's
 * INVALID_MOBILE_FORMAT response.
 */
async function resolveMobileRule(tenant: string): Promise<MobileRule> {
  const direct = await getMobileValidationRule(tenant);
  if (direct.pattern !== '^\\d{10}$' || tenant === ROOT_TENANT) return direct;
  // Generic 10-digit fallback returned for the city tenant — try the root.
  return getMobileValidationRule(ROOT_TENANT);
}

/**
 * Parse a regex pattern out of egov-user's INVALID_MOBILE_FORMAT error
 * message. The user-service hardcodes a per-tenant regex outside MDMS,
 * and surfaces it as plain text: "...matching ^[17][0-9]{8}$". When the
 * MDMS lookup is silent (Ethiopia), this is the only authoritative
 * source.
 */
function extractRuleFromServerError(message: string): MobileRule | null {
  const m = message.match(/matching\s+(\S+)/);
  if (!m) return null;
  const pattern = m[1];
  // Try to infer length from the pattern (best-effort — works for the
  // common `^[xy][0-9]{N}$` shape used across DIGIT tenants).
  const lenMatch = pattern.match(/\{(\d+)\}/);
  const tailLen = lenMatch ? parseInt(lenMatch[1], 10) : 0;
  const inferred = tailLen + 1;
  const startMatch = pattern.match(/^\^\[([0-9]+)\]/);
  const starters = startMatch ? startMatch[1].split('') : undefined;
  return {
    pattern,
    minLength: inferred || 10,
    maxLength: inferred || 10,
    errorMessage: message,
    allowedStartingDigits: starters,
  };
}

export async function provisionFreshCitizen(opts?: { tenant?: string }): Promise<ProvisionedCitizen> {
  const tenant = opts?.tenant ?? TENANT;
  let rule = await resolveMobileRule(tenant);
  let mobile = generateValidMobile(rule);
  const name = `E2E-Citizen-${Date.now()}`;

  // 1. Send register OTP. Failures here are tolerated — some deployments
  //    no-op this endpoint when the mock-OTP flag is on, and the create
  //    call below will still succeed using FIXED_OTP as otpReference.
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: mobile, tenantId: ROOT_TENANT, type: 'register', userType: 'CITIZEN' },
    }),
  }).catch(() => {});

  // 2. Register the citizen. Tolerate 409 (race / duplicate). On
  //    INVALID_MOBILE_FORMAT, extract the regex from the server's error
  //    message, regenerate, and retry once — this is how we discover
  //    the rule when MDMS is silent (e.g. Ethiopia).
  const attemptCreate = async (m: string): Promise<Response> =>
    fetch(`${BASE_URL}/user/citizen/_create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker' },
        user: {
          name,
          userName: m,
          mobileNumber: m,
          password: DEFAULT_PASSWORD,
          tenantId: ROOT_TENANT,
          type: 'CITIZEN',
          roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: ROOT_TENANT }],
          otpReference: FIXED_OTP,
        },
      }),
    });

  let createResp = await attemptCreate(mobile);
  if (!createResp.ok && createResp.status !== 409) {
    const body = await createResp.text();
    // Retry path 1: server surfaces the regex in its error message
    // (egov-user does this on Ethiopia: "...matching ^[17][0-9]{8}$").
    const errorMatch = /INVALID_MOBILE_(?:FORMAT|LENGTH).*?(?:matching\s+\S+)/i.exec(body);
    if (errorMatch) {
      const discovered = extractRuleFromServerError(errorMatch[0]);
      if (discovered) {
        rule = discovered;
        mobile = generateValidMobile(discovered);
        createResp = await attemptCreate(mobile);
      }
    }
    // Retry path 2: server returns a localized error key with no regex
    // (Bomet returns CORE_COMMON_MOBILE_ERROR). Fall back to the
    // CITIZEN_PHONE_PREFIX heuristic — same generator lifecycle.setup
    // uses, which is empirically accepted by user-service on tenants
    // whose MDMS rule disagrees with their server-side regex.
    if (!createResp.ok && createResp.status !== 409 && /CORE_COMMON_MOBILE_ERROR|INVALID_MOBILE/i.test(body)) {
      mobile = generateCitizenPhone();
      createResp = await attemptCreate(mobile);
    }
    if (!createResp.ok && createResp.status !== 409) {
      throw new Error(`citizen _create failed (${createResp.status}): ${body.slice(0, 300)}`);
    }
  }

  // 3. Send login OTP — explicit step per user direction.
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: mobile, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  }).catch(() => {});

  // 4. Exchange OTP for an access token. Try FIXED_OTP first (mock-OTP
  //    deployments), then DEFAULT_PASSWORD (password-only deployments).
  const tokenExchange = async (password: string): Promise<Response> =>
    fetch(`${BASE_URL}/user/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: mobile,
        password,
        tenantId: ROOT_TENANT,
        scope: 'read',
        userType: 'CITIZEN',
      }).toString(),
    });

  let tokenResp = await tokenExchange(FIXED_OTP);
  if (!tokenResp.ok) {
    tokenResp = await tokenExchange(DEFAULT_PASSWORD);
  }
  if (!tokenResp.ok) {
    const body = await tokenResp.text();
    throw new Error(`citizen token exchange failed (${tokenResp.status}): ${body.slice(0, 300)}`);
  }

  const tokenJson = (await tokenResp.json()) as {
    access_token?: string;
    UserRequest?: { uuid?: string };
  };
  if (!tokenJson.access_token) {
    throw new Error(`citizen token exchange returned no access_token: ${JSON.stringify(tokenJson).slice(0, 300)}`);
  }
  const uuid = tokenJson.UserRequest?.uuid;
  if (!uuid) {
    throw new Error(`citizen token exchange returned no uuid: ${JSON.stringify(tokenJson).slice(0, 300)}`);
  }

  return {
    mobile,
    prefix: rule.prefix,
    name,
    token: tokenJson.access_token,
    uuid,
    tenantId: ROOT_TENANT,
  };
}
