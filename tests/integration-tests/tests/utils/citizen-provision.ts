/** One new citizen per run, created by BFF phone possession and _select. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE_URL, ROOT_TENANT, TENANT } from './env';
import { getMobileValidationRule, generateValidMobile, derivedStartingDigits, type MobileRule } from './mdms-mobile';
import { getPgrIdPrefix } from './pgr-idgen';
import { tryGetProfile } from './profile';
import { request as playwrightRequest } from '@playwright/test';
import { citizenSignIn } from './identity-bff';

export interface ProvisionedCitizen {
  mobile: string;
  prefix: string | undefined;
  name: string;
  /** The DIGIT account's userName, as the citizen's token carries it. */
  userName: string;
  token: string;
  uuid: string;
  tenantId: string;
  /** PGR service-request ID prefix discovered via egov-idgen. Deployment-specific. */
  pgrIdPrefix: string;
  /**
   * The citizen's BFF session cookies, so UI specs can reuse this sign-in
   * (citizen-login.ts): each OTP send counts against the BFF's per-phone (5/h)
   * and per-IP (20/h) limits.
   */
  sessionCookies?: Awaited<ReturnType<import('@playwright/test').APIRequestContext['storageState']>>['cookies'];
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
 * Resolve the mobile-validation rule for this deployment.
 *
 * Profile-first: `profile.mobile` is read straight off the SPA's own boot
 * config (globalConfigs.js — see profile.ts), which is the same rule the
 * citizen wizard's phone field validates against and doesn't depend on a
 * tenant having populated the MDMS schema at all. Falls back to the old
 * MDMS lookup (tries the passed tenant first, then ROOT_TENANT — Bomet
 * ships the rule on `ke`, not `ke.etoebeta`) only when no profile was
 * discovered, e.g. a `--no-deps` single-spec run without PROFILE_INLINE=1.
 * The BFF validates the selected number against its own tenant rule; failure
 * is reported without bypassing that validation.
 */
async function resolveMobileRule(tenant: string): Promise<MobileRule> {
  const profileMobile = tryGetProfile()?.mobile;
  if (profileMobile?.pattern) {
    return {
      prefix: profileMobile.countryCode ?? undefined,
      pattern: profileMobile.pattern,
      minLength: profileMobile.length?.min ?? 10,
      maxLength: profileMobile.length?.max ?? 10,
      errorMessage: `Please enter a valid mobile number matching ${profileMobile.pattern}`,
      allowedStartingDigits: derivedStartingDigits(profileMobile.pattern) ?? undefined,
    };
  }
  const direct = await getMobileValidationRule(tenant);
  if (direct.pattern !== '^\\d{10}$' || tenant === ROOT_TENANT) return direct;
  // Generic 10-digit fallback returned for the city tenant — try the root.
  return getMobileValidationRule(ROOT_TENANT);
}

/** A new number this deployment's mobile rule accepts. */
export async function freshCitizenMobile(tenant = TENANT): Promise<string> {
  return generateValidMobile(await resolveMobileRule(tenant));
}

/** Signs a citizen in by BFF OTP: a new number unless `mobile` is given. */
export async function provisionFreshCitizen(opts?: { tenant?: string; mobile?: string }): Promise<ProvisionedCitizen> {
  const tenant = opts?.tenant ?? TENANT;
  const rule = await resolveMobileRule(tenant);
  const mobile = opts?.mobile ?? generateValidMobile(rule);
  const request = await playwrightRequest.newContext();
  try {
    const context = await citizenSignIn(request, BASE_URL, mobile);
    if (context.UserRequest.tenantId !== tenant) throw new Error('Provisioned citizen belongs to a different workspace');
    const name = context.UserRequest.name;
    if (typeof name !== 'string' || !name) throw new Error('Provisioned citizen has no name');
    return {
      mobile, prefix: rule.prefix, name, userName: String(context.UserRequest.userName), token: context.access_token,
      uuid: context.UserRequest.uuid, tenantId: context.UserRequest.tenantId,
      pgrIdPrefix: await getPgrIdPrefix(),
      sessionCookies: (await request.storageState()).cookies,
    };
  } finally {
    await request.dispose();
  }
}
