import jsonLogic from 'json-logic-js';
import type { DigitApiClient } from '../client/DigitApiClient.js';
import type { MdmsRecord } from '../client/types.js';

/**
 * Masters visibility/edit capability, computed client-side from data the
 * configurator already fetches from accesscontrol's MDMS masters — no new
 * MDMS master, no server-side (Tier-2) enforcement. See
 * docs/design/masters-configurator-access-policy-design.md §3.2/§3.3.
 *
 * - canView(schema): evaluates the JsonLogic `condition` under the one shared
 *   MDMS search action's `resource.masters.<schema>` block (action id 2513,
 *   url `/mdms-v2/v2/_search`, master ACCESSCONTROL-ACTIONS-TEST.actions-test).
 *   No entry for a schema = visible (today's behavior, unchanged).
 * - canEdit(schema): true iff one of the schema's dedicated create/update
 *   action ids (url pattern `/mdms-v2/v2/_(create|update)/<schema>`) is
 *   mapped to one of the user's roles in ACCESSCONTROL-ROLEACTIONS.roleactions.
 *   No dedicated write action for a schema = not editable through this check.
 *
 * Both are called ONLY for `type: 'mdms'` resources — see
 * `useMastersCapability.canViewResource`/`canEditResource`, which is where
 * that gate lives. Every other resource type is unrestricted, so this module
 * never needs to reason about non-mdms-v2 write paths.
 *
 * This is UI-level only — presentation, not a security boundary. Real write
 * security is whatever the gateway's RoleAction mapping already enforces.
 */
export interface MastersCapability {
  canView(schema: string | undefined): boolean;
  canEdit(schema: string | undefined): boolean;
}

export const ACTIONS_TEST_SCHEMA = 'ACCESSCONTROL-ACTIONS-TEST.actions-test';
export const ROLEACTIONS_SCHEMA = 'ACCESSCONTROL-ROLEACTIONS.roleactions';
const SEARCH_ACTION_URL = '/mdms-v2/v2/_search';
const WRITE_URL_RE = /^\/mdms-v2\/v2\/_(?:create|update)\/(.+)$/;

// Page size for the exhaustive fetch below — both masters can run into the
// thousands of rows, well past the 500-row cap generic master lists use
// elsewhere in this app (see mdmsGetList in dataProvider.ts). Paginating
// instead of a single fixed-limit fetch means no record count can ever be
// silently truncated out of the policy.
const POLICY_FETCH_PAGE_SIZE = 500;

// Used only when there's no tenant/role identity to evaluate a policy against
// at all (see the `!tenantId || roles.length === 0` guard below) — NOT the
// "no policy configured for this tenant" case, which is a per-schema decision
// already handled by `mastersConditions`' empty-object fallback (§2.5 "no
// entry = visible" still applies there). Deny-by-default here matches
// `useMastersCapability`'s documented posture for every other incomplete-
// identity path (pre-first-fetch, mid-refetch, fetch-failure) — this hook was
// the one path that still fell through to OPEN_CAPABILITY (#1441 review).
const DENY_CAPABILITY: MastersCapability = {
  canView: () => false,
  canEdit: () => false,
};

/**
 * Fetches every record for `schemaCode`, paging until a page comes back
 * shorter than the page size — never silently truncated by a fixed limit.
 * Propagates a fetch failure rather than swallowing it: the caller (
 * `loadMastersCapability`) must be able to tell "policy fetch failed" apart
 * from "policy fetch succeeded, zero records" — collapsing those into the
 * same empty array is exactly what let a fetch failure read as "no policy
 * configured, show everything" (see `loadMastersCapability`'s Javadoc).
 */
async function fetchAllMdmsRecords(client: DigitApiClient, tenantId: string, schemaCode: string): Promise<MdmsRecord[]> {
  const all: MdmsRecord[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.mdmsSearch(tenantId, schemaCode, { limit: POLICY_FETCH_PAGE_SIZE, offset });
    all.push(...page);
    if (page.length < POLICY_FETCH_PAGE_SIZE) return all;
    offset += POLICY_FETCH_PAGE_SIZE;
  }
}

export async function loadMastersCapability(
  client: DigitApiClient,
  tenantId: string,
  roles: string[],
): Promise<MastersCapability> {
  if (!tenantId || roles.length === 0) return DENY_CAPABILITY;

  // Deliberately NOT caught here: a policy-fetch failure must propagate to the
  // caller as a rejected promise, not resolve into an empty policy that reads
  // identically to "nothing configured, everything visible" (§2.5's existing
  // "no entry = visible" rule) — see `useMastersCapability`'s error handling,
  // which is what actually decides the safe fallback capability.
  const [actionRecords, roleActionRecords] = await Promise.all([
    fetchAllMdmsRecords(client, tenantId, ACTIONS_TEST_SCHEMA),
    fetchAllMdmsRecords(client, tenantId, ROLEACTIONS_SCHEMA),
  ]);

  const searchAction = actionRecords.find((r) => (r.data as Record<string, unknown> | undefined)?.url === SEARCH_ACTION_URL);
  const mastersConditions = ((searchAction?.data as Record<string, unknown> | undefined)
    ?.resource as Record<string, unknown> | undefined)
    ?.masters as Record<string, { condition?: unknown }> | undefined ?? {};

  const roleSet = new Set(roles.map((r) => r.toUpperCase()));
  const grantedActionIds = new Set<number>();
  for (const r of roleActionRecords) {
    const d = r.data as Record<string, unknown>;
    const rolecode = d?.rolecode;
    const actionid = d?.actionid;
    if (typeof rolecode === 'string' && roleSet.has(rolecode.toUpperCase()) && actionid != null) {
      grantedActionIds.add(Number(actionid));
    }
  }

  const writeActionIdsBySchema = new Map<string, number[]>();
  for (const r of actionRecords) {
    const d = r.data as Record<string, unknown>;
    const url = typeof d?.url === 'string' ? d.url : undefined;
    const match = url?.match(WRITE_URL_RE);
    if (!match) continue;
    const schema = match[1];
    const list = writeActionIdsBySchema.get(schema) ?? [];
    list.push(Number(d.id));
    writeActionIdsBySchema.set(schema, list);
  }

  const userDoc = { user: { roles: Array.from(roleSet) } };

  return {
    canView(schema) {
      if (!schema) return true;
      const rule = mastersConditions[schema];
      if (!rule?.condition) return true; // no entry = today's behavior (§2.5)
      try {
        return Boolean(jsonLogic.apply(rule.condition, userDoc));
      } catch {
        // Fail CLOSED: an entry IS present here — an operator authored a
        // restriction — so a malformed condition is policy corruption, not an
        // absent policy. Denying is the same "authored-but-broken must not
        // read as open" principle the PGR PDP already applies; the "no entry
        // at all" case above stays open, unaffected (#1441 review).
        return false;
      }
    },
    canEdit(schema) {
      if (!schema) return false;
      const actionIds = writeActionIdsBySchema.get(schema);
      if (!actionIds || actionIds.length === 0) return false;
      return actionIds.some((id) => grantedActionIds.has(id));
    },
  };
}
