/**
 * ServiceDef (complaint type) lookup, sourced from MDMS.
 *
 * Reads `RAINMAKER-PGR.ServiceDefs` from MDMS v1 — v1 returns the full
 * tenant set (250+ rows on a real Kenya deployment) whereas v2 often
 * returns a curated subset. v1 is the canonical source for PGR.
 *
 * Public API (keep stable across ports — see memory feedback_test_data_from_deployment):
 *   getServiceDefs(tenant, opts)        -> Promise<ServiceDef[]>
 *   pickRandomServiceCode(tenant, opts) -> Promise<ServiceDef>
 *
 * Random picking is the default for `pickRandomServiceCode` — same
 * rationale as the boundary helper. Pinning to one serviceCode hides
 * SLA-mapping, workflow-rule, and localization gaps that only fire on
 * specific complaint types.
 */
import { getDigitToken } from '../utils/auth';

export interface ServiceDef {
  serviceCode: string;
  name?: string;
  menuPath?: string;
  department?: string;
  slaHours?: number;
  keywords?: string;
  active?: boolean;
}

export interface ServiceDefLookupOptions {
  baseURL?: string;
  adminUser?: string;
  adminPassword?: string;
  authTenant?: string;
  activeOnly?: boolean;
}

/**
 * Fetch ServiceDefs for `tenant` from MDMS v1. Filters to active rows by
 * default. Falls through unfiltered if `activeOnly: false`.
 */
export async function getServiceDefs(
  tenant: string,
  opts: ServiceDefLookupOptions = {},
): Promise<ServiceDef[]> {
  const baseURL = opts.baseURL ?? process.env.BASE_URL ?? 'http://localhost:18080';
  const authTenant = opts.authTenant ?? tenant;
  const adminUser =
    opts.adminUser ?? process.env.ADMIN_USER ?? process.env.DIGIT_EMPLOYEE_USER ?? 'ADMIN';
  const adminPassword =
    opts.adminPassword ??
    process.env.ADMIN_PASSWORD ??
    process.env.DIGIT_EMPLOYEE_PASSWORD ??
    'eGov@123';
  const activeOnly = opts.activeOnly ?? true;

  const token = await getDigitToken({
    baseURL,
    tenant: authTenant,
    username: adminUser,
    password: adminPassword,
    userType: 'EMPLOYEE',
  });

  const resp = await fetch(`${baseURL}/egov-mdms-service/v1/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token.access_token },
      MdmsCriteria: {
        tenantId: tenant,
        moduleDetails: [
          { moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'ServiceDefs' }] },
        ],
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`ServiceDefs fetch failed (${resp.status}): ${await resp.text()}`);
  }
  const json = (await resp.json()) as {
    MdmsRes?: { 'RAINMAKER-PGR'?: { ServiceDefs?: ServiceDef[] } };
  };
  const all = json.MdmsRes?.['RAINMAKER-PGR']?.ServiceDefs ?? [];
  return activeOnly ? all.filter((s) => s.active !== false) : all;
}

/**
 * Pick a random ServiceDef for the tenant. Throws if none found — same
 * principle as the boundary helper: a missing master is a real ops
 * finding, not something to paper over with a fallback.
 */
export async function pickRandomServiceCode(
  tenant: string,
  opts: ServiceDefLookupOptions = {},
): Promise<ServiceDef> {
  const defs = await getServiceDefs(tenant, opts);
  if (defs.length === 0) {
    throw new Error(
      `No ServiceDefs found for tenant=${tenant} (RAINMAKER-PGR.ServiceDefs is empty or unseeded)`,
    );
  }
  return defs[Math.floor(Math.random() * defs.length)];
}
