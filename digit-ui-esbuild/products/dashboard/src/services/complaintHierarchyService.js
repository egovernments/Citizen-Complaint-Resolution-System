import { getTenantId, hasAuth } from "./analyticsService";
import { selectHierarchyDefinition, orderedLevels } from "../utils/hierLevelGrouping";
import { withTraceHeaders } from "./dashboardMetrics";

/**
 * MDMS context path from globalConfigs (deployments serve MDMS under
 * "mdms-v2"; the v1-compat search stays available under that context).
 * Falls back to the legacy service name when no config is present
 * (e.g. the standalone dashboard build without globalConfigs.js).
 */
function getMdmsSearchUrl() {
  const get = window.globalConfigs?.getConfig?.bind(window.globalConfigs);
  const contextPath =
    get?.("MDMS_V1_CONTEXT_PATH") ||
    get?.("MDMS_CONTEXT_PATH") ||
    "egov-mdms-service";
  return `/${String(contextPath).replace(/^\/+|\/+$/g, "")}/v1/_search`;
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getEmployeeToken() {
  const raw = window.localStorage?.getItem("Employee.token");
  return raw && raw !== "undefined" ? parseJson(raw) : null;
}

function getEmployeeInfo() {
  const raw = window.localStorage?.getItem("Employee.user-info");
  return raw && raw !== "undefined" ? parseJson(raw) : null;
}

function buildRequestInfo() {
  const authToken = getEmployeeToken();
  const userInfo = getEmployeeInfo();
  return {
    apiId: "Rainmaker",
    ver: ".01",
    ts: Date.now(),
    action: "_search",
    msgId: `dashboard-complaint-hierarchy-${Date.now()}`,
    ...(authToken && { authToken }),
    ...(userInfo && { userInfo }),
  };
}

/**
 * Display name for a hierarchy node. Live masters carry real display names on
 * leaves ("Ambulance breakdown / Crew unresponsive") but category records often
 * have name === code ("MedicalServices", "complaints.categories.X") — those
 * return undefined so the dimension-label seam surfaces the raw code as a
 * localisation gap instead of a humanised pseudo-name.
 */
function displayName(record) {
  const code = String(record?.code ?? "").trim();
  const name = String(record?.name ?? "").trim();
  return name && name !== code ? name : undefined;
}

/**
 * Build code → { label, rootCode, rootLabel } from ComplaintHierarchy records.
 *
 * Observed record shape (RAINMAKER-PGR.ComplaintHierarchy):
 *   { code, name, path (dot-delimited), parentCode, levelCode, order, active,
 *     department(s), slaHours, keywords, hierarchyType }
 *
 * The root category is resolved by walking parentCode up to the topmost record
 * present in the master (cycle-guarded), so it works for the N-level hierarchy
 * without needing ComplaintHierarchyDefinition level ordering.
 *
 * Exported for reuse/testing; pure — no fetch.
 */
export function buildComplaintTypeIndex(records) {
  const byCode = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const code = String(record?.code ?? "").trim();
    if (!code || record?.active === false) continue;
    byCode.set(code, record);
  }

  const index = new Map();
  for (const [code, record] of byCode) {
    let node = record;
    const seen = new Set([code]);
    for (;;) {
      const parentCode = String(node?.parentCode ?? "").trim();
      if (!parentCode || !byCode.has(parentCode) || seen.has(parentCode)) break;
      seen.add(parentCode);
      node = byCode.get(parentCode);
    }
    const rootCode = String(node.code).trim();
    index.set(code, {
      label: displayName(record),
      rootCode,
      rootLabel: displayName(node),
    });
  }
  return index;
}

/**
 * Fetch the PGR complaint hierarchy master (state-root tenant, same-origin
 * MDMS v1 — same auth/tenant conventions as boundaryService) and return the
 * code → { label, rootCode, rootLabel } index.
 *
 * Resolves null on any failure (never rejects) so callers can fall back to
 * humanized flat labels without blocking the dashboard.
 */
export async function fetchComplaintTypeIndex() {
  if (!hasAuth()) return null;

  try {
    const response = await fetch(getMdmsSearchUrl(), {
      method: "POST",
      headers: withTraceHeaders({ "Content-Type": "application/json" }),
      credentials: "omit",
      body: JSON.stringify({
        RequestInfo: buildRequestInfo(),
        MdmsCriteria: {
          tenantId: getTenantId(),
          moduleDetails: [
            {
              moduleName: "RAINMAKER-PGR",
              masterDetails: [{ name: "ComplaintHierarchy" }],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      console.warn(`egov-mdms-service ComplaintHierarchy _search failed (${response.status})`);
      return null;
    }

    const payload = await response.json();
    const records = payload?.MdmsRes?.["RAINMAKER-PGR"]?.ComplaintHierarchy;
    if (!Array.isArray(records) || !records.length) return null;

    const indexed = buildComplaintTypeIndex(records);
    return indexed.size ? indexed : null;
  } catch (error) {
    console.warn("egov-mdms-service ComplaintHierarchy _search error", error);
    return null;
  }
}

/**
 * The deployment's complaint hierarchyType pin. Optional globalConfigs key —
 * ke's MDMS carries BOTH a "PGR" (2-level) and a "PGR_TEST" (4-level)
 * ComplaintHierarchyDefinition, and only the deployment knows which one its
 * complaints are coded against. Unset → selectHierarchyDefinition falls back
 * to the rows-backed heuristic the PGR complaint pages use.
 */
function getComplaintHierarchyTypePin() {
  const get = window.globalConfigs?.getConfig?.bind(window.globalConfigs);
  const pin = get?.("COMPLAINT_HIERARCHY_TYPE");
  return pin ? String(pin) : "";
}

const NO_HIERARCHY = Object.freeze({ hasHierarchy: false, hierarchyType: null, levels: [] });

/**
 * Fetch the deployment's complaint-hierarchy LEVELS for the per-widget
 * "Group by" control (#1111 PR2): ComplaintHierarchyDefinition (level order +
 * names) scoped to the deployment's hierarchyType, alongside the
 * ComplaintHierarchy rows needed to pick the live definition when no
 * COMPLAINT_HIERARCHY_TYPE pin is configured.
 *
 * Returns { hasHierarchy, hierarchyType, levels:[{ levelCode, label, order,
 * isLeafServiceCode }] }; hasHierarchy is false when the tenant has no usable
 * definition (flat/legacy tenant) so callers hide the control. Resolves the
 * NO_HIERARCHY shape on any failure (never rejects).
 */
export async function fetchComplaintHierarchyLevels() {
  if (!hasAuth()) return NO_HIERARCHY;

  try {
    const response = await fetch(getMdmsSearchUrl(), {
      method: "POST",
      headers: withTraceHeaders({ "Content-Type": "application/json" }),
      credentials: "omit",
      body: JSON.stringify({
        RequestInfo: buildRequestInfo(),
        MdmsCriteria: {
          tenantId: getTenantId(),
          moduleDetails: [
            {
              moduleName: "RAINMAKER-PGR",
              masterDetails: [
                { name: "ComplaintHierarchyDefinition" },
                { name: "ComplaintHierarchy" },
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      console.warn(
        `egov-mdms-service ComplaintHierarchyDefinition _search failed (${response.status})`
      );
      return NO_HIERARCHY;
    }

    const payload = await response.json();
    const pgr = payload?.MdmsRes?.["RAINMAKER-PGR"] || {};
    const definition = selectHierarchyDefinition(
      pgr.ComplaintHierarchyDefinition,
      pgr.ComplaintHierarchy,
      getComplaintHierarchyTypePin()
    );
    if (!definition) return NO_HIERARCHY;

    const levels = orderedLevels(definition);
    if (!levels.length) return NO_HIERARCHY;
    return {
      hasHierarchy: true,
      hierarchyType: definition.hierarchyType ?? null,
      levels,
    };
  } catch (error) {
    console.warn("egov-mdms-service ComplaintHierarchyDefinition _search error", error);
    return NO_HIERARCHY;
  }
}
