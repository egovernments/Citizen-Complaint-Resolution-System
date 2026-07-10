/**
 * PGR ID prefix discovery via egov-idgen.
 *
 * The PGR service-request ID has the shape `<PREFIX>-PGR-<YYYY>-<MM>-<DD>-<seq>`.
 * The prefix is deployment-specific (NCCG on Nairobi, PG on Ethiopia and
 * Bomet's ke.etoebeta, …) and is configured via the idgen MDMS format for
 * idName `pgr.servicerequestid`. Rather than hardcode or env-var the
 * prefix, the suite asks egov-idgen for one ID at setup time and parses
 * the prefix from the response — the canonical source of truth.
 *
 * One idgen call per `npx playwright test` invocation; the resulting
 * prefix is cached on disk via citizen-fixture.json (see citizen-provision).
 */
import { BASE_URL, ROOT_TENANT, TENANT } from './env';
import { getDigitToken } from './auth';

const DEFAULT_FALLBACK = 'NCCG';

/**
 * Resolve the PGR ID prefix for this deployment by asking egov-idgen
 * for one `pgr.servicerequestid`. Returns the segment before `-PGR-`
 * (e.g. "NCCG", "PG"). Falls back to "NCCG" only if both the city- and
 * root-scoped idgen calls fail — at which point the caller's regex
 * assertion will fail informatively rather than the helper crashing.
 */
export async function getPgrIdPrefix(opts?: { tenant?: string }): Promise<string> {
  const cityTenant = opts?.tenant ?? TENANT;
  const tenantsToTry = cityTenant === ROOT_TENANT ? [ROOT_TENANT] : [cityTenant, ROOT_TENANT];

  let auth;
  try {
    auth = await getDigitToken({
      baseURL: BASE_URL,
      tenant: ROOT_TENANT,
      username: process.env.ADMIN_USER || 'ADMIN',
      password: process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || 'eGov@123',
    });
  } catch {
    return DEFAULT_FALLBACK;
  }

  for (const tenant of tenantsToTry) {
    try {
      const resp = await fetch(`${BASE_URL}/egov-idgen/id/_generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { authToken: auth.access_token, apiId: 'Rainmaker' },
          idRequests: [{ idName: 'pgr.servicerequestid', tenantId: tenant }],
        }),
      });
      if (!resp.ok) continue;
      const json = (await resp.json()) as {
        idResponses?: Array<{ id?: string }>;
      };
      const id = json.idResponses?.[0]?.id;
      if (!id) continue;
      const match = id.match(/^([A-Z0-9]+)-PGR-/);
      if (match) return match[1];
    } catch {
      // try next tenant
    }
  }
  return DEFAULT_FALLBACK;
}
