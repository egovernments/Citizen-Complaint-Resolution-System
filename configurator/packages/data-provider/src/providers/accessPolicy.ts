import jsonLogic from 'json-logic-js';
import type { DigitApiClient } from '../client/DigitApiClient.js';

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

// One-time fetch at login, not a paginated UI list — both masters run into
// the thousands of rows, well past the 500-row cap generic master lists use
// elsewhere in this app (see mdmsGetList in dataProvider.ts).
const POLICY_FETCH_LIMIT = 5000;

const OPEN_CAPABILITY: MastersCapability = {
  canView: () => true,
  canEdit: () => false,
};

export async function loadMastersCapability(
  client: DigitApiClient,
  tenantId: string,
  roles: string[],
): Promise<MastersCapability> {
  if (!tenantId || roles.length === 0) return OPEN_CAPABILITY;

  const [actionRecords, roleActionRecords] = await Promise.all([
    client.mdmsSearch(tenantId, ACTIONS_TEST_SCHEMA, { limit: POLICY_FETCH_LIMIT }).catch(() => []),
    client.mdmsSearch(tenantId, ROLEACTIONS_SCHEMA, { limit: POLICY_FETCH_LIMIT }).catch(() => []),
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
        // Fail OPEN here (not the fail-closed rule the PGR PDP uses) — this is
        // UI-only presentation, not a security boundary (§1.1); a bad condition
        // should never lock an admin out of the console.
        return true;
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
