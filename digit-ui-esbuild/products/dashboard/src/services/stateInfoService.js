import { authFetch, buildRequestInfo, getTenantId } from "./authService";
import { getMdmsSearchUrl } from "./complaintHierarchyService";
import { withTraceHeaders } from "./dashboardMetrics";

/**
 * The languages a tenant offers, for the standalone/public language switcher
 * (#1797). Same master and same selection rule as the employee app's TopBar
 * dropdown (packages/libraries Store/service.js): `common-masters.StateInfo`
 * at the state root, first record, `languages` only when `hasLocalisation`.
 *
 * MDMS v1 `_search` is auth-optional on Kong, and in the public runtime
 * authFetch sends a role-less single-shot request, so this needs no session.
 * Resolves to [] on any failure — the switcher simply stays hidden.
 *
 * @returns {Promise<Array<{label: string, value: string}>>}
 */
export async function fetchStateLanguages() {
  try {
    const response = await authFetch(getMdmsSearchUrl(), {
      headers: withTraceHeaders({}),
      sessionCritical: false,
      buildBody: () => ({
        RequestInfo: buildRequestInfo("dashboard-state-info"),
        MdmsCriteria: {
          tenantId: getTenantId(),
          moduleDetails: [
            { moduleName: "common-masters", masterDetails: [{ name: "StateInfo" }] },
          ],
        },
      }),
    });
    if (!response.ok) {
      console.warn(`egov-mdms-service StateInfo _search failed (${response.status})`);
      return [];
    }
    const payload = await response.json();
    return languagesFromStateInfo(payload?.MdmsRes?.["common-masters"]?.StateInfo);
  } catch (error) {
    console.warn("StateInfo _search error", error);
    return [];
  }
}

/** Pure: StateInfo records -> [{label, value}] (exported for tests). */
export function languagesFromStateInfo(records) {
  const info = Array.isArray(records) ? records[0] : null;
  if (!info || info.hasLocalisation !== true || !Array.isArray(info.languages)) return [];
  const seen = new Set();
  return info.languages
    .filter((l) => l && typeof l.value === "string" && l.value && !seen.has(l.value) && seen.add(l.value))
    .map((l) => ({ value: l.value, label: typeof l.label === "string" && l.label ? l.label : l.value }));
}
