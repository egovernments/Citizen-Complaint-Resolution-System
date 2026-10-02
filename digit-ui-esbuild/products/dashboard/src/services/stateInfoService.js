import { authFetch, buildRequestInfo, getTenantId } from "./authService";
import { getMdmsSearchUrl } from "./complaintHierarchyService";
import { withTraceHeaders } from "./dashboardMetrics";

/**
 * The tenant's `common-masters.StateInfo` records: the same master and the
 * same selection rule as the employee app's TopBar (packages/libraries
 * Store/service.js), the first record at the state root.
 *
 * MDMS v1 `_search` is auth-optional on Kong, and in the public runtime
 * authFetch sends a role-less single-shot request, so this needs no session.
 * Resolves to null on any failure, and the callers fall back to showing
 * nothing.
 */
async function requestStateInfo() {
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
    return null;
  }
  const payload = await response.json();
  return payload?.MdmsRes?.["common-masters"]?.StateInfo ?? null;
}

// The public top bar's crest and the language menu mount together and read
// the same record, so a request already in flight is shared. Nothing is kept
// once it settles: a later call asks again.
let pendingStateInfo = null;

function fetchStateInfo() {
  if (!pendingStateInfo) {
    pendingStateInfo = requestStateInfo()
      .catch((error) => {
        console.warn("StateInfo _search error", error);
        return null;
      })
      .finally(() => {
        pendingStateInfo = null;
      });
  }
  return pendingStateInfo;
}

/**
 * The languages a tenant offers, for the standalone/public language switcher
 * (#1797): `languages` only when `hasLocalisation`. Resolves to [] on any
 * failure — the switcher simply stays hidden.
 *
 * @returns {Promise<Array<{label: string, value: string}>>}
 */
export async function fetchStateLanguages() {
  return languagesFromStateInfo(await fetchStateInfo());
}

/**
 * The tenant crest for the public top bar, as the app's TopBar picks it: the
 * light-on-dark variant first, the plain logo otherwise. Null when neither is
 * set or the request fails.
 *
 * @returns {Promise<string|null>}
 */
export async function fetchStateLogo() {
  return logoFromStateInfo(await fetchStateInfo());
}

/** Pure: StateInfo records -> the crest URL, or null (exported for tests). */
export function logoFromStateInfo(records) {
  const info = Array.isArray(records) ? records[0] : null;
  const url = [info?.logoUrlWhite, info?.logoUrl].find((value) => typeof value === "string" && value.trim());
  return url ? url.trim() : null;
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
