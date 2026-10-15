/** One new citizen per run, created by BFF phone possession and _select. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE_URL, IGNORE_HTTPS_ERRORS, TENANT } from './env';
import { getMobileValidationRule, generateValidMobile, derivedStartingDigits, type MobileRule } from './mdms-mobile';
import { getPgrIdPrefix } from './pgr-idgen';
import { tryGetProfile } from './profile';
import { request as playwrightRequest } from '@playwright/test';
import { citizenSignIn } from './identity-bff';

export interface ProvisionedCitizen {
  mobile: string;
  prefix: string | undefined;
  name: string;
  token: string;
  uuid: string;
  tenantId: string;
  /** PGR service-request ID prefix discovered via egov-idgen. Deployment-specific. */
  pgrIdPrefix: string;
  /**
   * The citizen's BFF session cookies, so UI specs can reuse this sign-in: each
   * OTP send counts against the BFF's per-phone (5/h) and per-IP (20/h) limits.
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
 * tenant having populated the MDMS schema at all. Falls back to the MDMS
 * lookup only when no profile was discovered, e.g. a `--no-deps` single-spec
 * run without PROFILE_INLINE=1.
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
  return getMobileValidationRule(tenant);
}

export async function provisionFreshCitizen(opts?: { tenant?: string }): Promise<ProvisionedCitizen> {
  const tenant = opts?.tenant ?? TENANT;
  const rule = await resolveMobileRule(tenant);
  const mobile = generateValidMobile(rule);
  const request = await playwrightRequest.newContext({ ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS });
  try {
    const context = await citizenSignIn(request, BASE_URL, mobile);
    // Root tenants only: the citizen account and the workspace are the same tenant.
    if (context.UserRequest.tenantId !== tenant) {
      throw new Error(`Provisioned citizen belongs to tenant ${context.UserRequest.tenantId}, not the workspace root ${tenant}`);
    }
    const name = context.UserRequest.name;
    if (typeof name !== 'string' || !name) throw new Error('Provisioned citizen has no name');
    return {
      mobile, prefix: rule.prefix, name, token: context.access_token,
      uuid: context.UserRequest.uuid, tenantId: context.UserRequest.tenantId,
      pgrIdPrefix: tryGetProfile()?.pgr.idPrefix || await getPgrIdPrefix(),
      sessionCookies: (await request.storageState()).cookies,
    };
  } finally {
    await request.dispose();
  }
}
