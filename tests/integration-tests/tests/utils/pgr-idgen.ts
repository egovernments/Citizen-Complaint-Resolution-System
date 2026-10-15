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
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from './env';
import { getDigitToken } from './auth';

/**
 * Resolve the PGR ID prefix for this deployment by asking egov-idgen
 * for one `pgr.servicerequestid` at the root tenant. Returns the segment
 * before `-PGR-` (e.g. "NCCG", "PG"). Throws when idgen cannot answer:
 * discovery never invents a prefix.
 */
export async function getPgrIdPrefix(opts?: { tenant?: string }): Promise<string> {
  const tenant = opts?.tenant ?? TENANT;
  const auth = await getDigitToken({ baseURL: BASE_URL, tenant, username: ADMIN_USER, password: ADMIN_PASS });
  const resp = await fetch(`${BASE_URL}/egov-idgen/id/_generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { authToken: auth.access_token, apiId: 'Rainmaker' },
      idRequests: [{ idName: 'pgr.servicerequestid', tenantId: tenant }],
    }),
  });
  if (!resp.ok) throw new Error(`egov-idgen answered HTTP ${resp.status} for pgr.servicerequestid at ${tenant}`);
  const id = ((await resp.json()) as { idResponses?: Array<{ id?: string }> }).idResponses?.[0]?.id ?? '';
  // The prefix can itself hold hyphens: a signup workspace's is `<COUNTRY>-<TENANT>` (KE-QA).
  const match = id.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)*)-PGR-/);
  if (!match) throw new Error(`egov-idgen returned no PGR id at ${tenant} (got '${id}')`);
  return match[1];
}
