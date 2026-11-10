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
import { BASE_URL, ROOT_TENANT, TENANT, ADMIN_USER, ADMIN_PASS } from './env';
import { getDigitToken } from './auth';

/**
 * A service-request ID, `<PREFIX>-PGR-<YYYY>-<MM>-<DD>-<seq>`; group 1 is the
 * prefix, which can itself hold hyphens (a signup workspace's KE-QA).
 */
export const SRID_RE = /([A-Z0-9]+(?:-[A-Z0-9]+)*)-PGR-\d{4}-\d{2}-\d{2}-\d+/;

/**
 * Resolve the PGR ID prefix for this deployment by asking egov-idgen
 * for one `pgr.servicerequestid`. Returns the segment before `-PGR-`
 * (e.g. "NCCG", "PG"). THROWS when the admin login or both the city- and
 * root-scoped idgen calls fail: a guessed prefix used to be recorded in the
 * profile as if discovered, and then every SRID regex failed for a reason
 * nobody could see. profile.ts's attempt() now logs it as a probe failure.
 */
export async function getPgrIdPrefix(opts?: { tenant?: string }): Promise<string> {
  const cityTenant = opts?.tenant ?? TENANT;
  const tenantsToTry = cityTenant === ROOT_TENANT ? [ROOT_TENANT] : [cityTenant, ROOT_TENANT];

  let auth;
  try {
    auth = await getDigitToken({
      baseURL: BASE_URL,
      tenant: ROOT_TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });
  } catch (e) {
    throw new Error(`idgen PGR prefix: admin login failed: ${(e as Error).message}`);
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
      const match = id.match(SRID_RE);
      if (match) return match[1];
    } catch {
      // try next tenant
    }
  }
  throw new Error(`egov-idgen issued no pgr.servicerequestid for ${tenantsToTry.join(', ')}`);
}
