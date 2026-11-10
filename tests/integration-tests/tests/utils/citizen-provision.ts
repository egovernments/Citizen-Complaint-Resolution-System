/** One new citizen per run, created by BFF phone possession and _select. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE_URL, ROOT_TENANT, TENANT } from './env';
import { getMobileValidationRule, generateValidMobile, ruleFromProfile, type MobileRule } from './mdms-mobile';
import { getPgrIdPrefix } from './pgr-idgen';
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
  /** PGR service-request ID prefix discovered via egov-idgen; absent when idgen could not be read. */
  pgrIdPrefix?: string;
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
 * Resolve the mobile-validation rule the Identity BFF will apply.
 *
 * Tenant-first since v2.20: citizen `otp/_send` validates the number against
 * the route tenant's own `common-masters.MobileNumberValidation` record (then
 * its root's; identity-bff citizen-otp/mobile-validation.ts), and a self-serve
 * workspace gets that record from the country chosen at signup. The SPA's boot
 * config (globalConfigs.js, `profile.mobile`) is stack-wide, so on a stack
 * hosting workspaces from several countries it names the wrong country. It is
 * only the fallback when MDMS has no rule for the tenant or its root, e.g. a
 * token-less `--no-deps` run. The BFF validates the selected number against
 * its own tenant rule; failure is reported without bypassing that validation.
 */
async function resolveMobileRule(tenant: string): Promise<MobileRule> {
  const isGeneric = (rule: MobileRule) => rule.pattern === '^\\d{10}$';
  for (const id of new Set([tenant, ROOT_TENANT])) {
    const rule = await getMobileValidationRule(id);
    if (!isGeneric(rule)) return rule;
  }
  return ruleFromProfile() ?? getMobileValidationRule(tenant);
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
    // The token's tenant is the route tenant's root (egov-user keeps citizens
    // there); the workspace is the route tenant the BFF returns as `tenant`.
    if (context.tenant?.tenantId !== tenant) throw new Error('Provisioned citizen belongs to a different workspace');
    const name = context.UserRequest.name;
    if (typeof name !== 'string' || !name) throw new Error('Provisioned citizen has no name');
    return {
      mobile, prefix: rule.prefix, name, userName: String(context.UserRequest.userName), token: context.access_token,
      uuid: context.UserRequest.uuid, tenantId: context.UserRequest.tenantId,
      pgrIdPrefix: await getPgrIdPrefix().catch(() => undefined),
      sessionCookies: (await request.storageState()).cookies,
    };
  } finally {
    await request.dispose();
  }
}
