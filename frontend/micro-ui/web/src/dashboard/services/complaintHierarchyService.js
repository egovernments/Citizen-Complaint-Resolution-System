import { getTenantId, hasAuth } from "./analyticsService";
import { formatDimensionLabel } from "../config/labelFormat";

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
 * have name === code ("MedicalServices", "complaints.categories.X") — those go
 * through the shared code humanizer instead.
 */
function displayName(record) {
  const code = String(record?.code ?? "").trim();
  const name = String(record?.name ?? "").trim();
  if (name && name !== code) return name;
  return formatDimensionLabel(code);
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
    const response = await fetch("/egov-mdms-service/v1/_search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
