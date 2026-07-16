import { getTenantId, hasAuth } from "./analyticsService";

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
    msgId: `dashboard-boundary-${Date.now()}`,
    ...(authToken && { authToken }),
    ...(userInfo && { userInfo }),
  };
}

/**
 * Fetch boundary entities with GeoJSON geometry.
 * Supports Point centroids and Polygon/MultiPolygon choropleths.
 * API: POST /boundary-service/boundary/_search?tenantId=&codes=&limit=
 */
export async function fetchBoundariesByCodes(codes = []) {
  if (!hasAuth() || !codes.length) return [];

  const tenantId = getTenantId();
  const uniqueCodes = [...new Set(codes.filter(Boolean))];
  const chunkSize = 100;
  const all = [];

  for (let i = 0; i < uniqueCodes.length; i += chunkSize) {
    const chunk = uniqueCodes.slice(i, i + chunkSize);
    const params = new URLSearchParams({
      tenantId,
      codes: chunk.join(","),
      limit: String(chunk.length),
    });

    const response = await fetch(`/boundary-service/boundary/_search?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ RequestInfo: buildRequestInfo() }),
    });

    if (!response.ok) {
      console.warn(`boundary/_search failed (${response.status})`);
      continue;
    }

    const payload = await response.json();
    const boundaries = payload?.Boundary || [];
    all.push(...boundaries);
  }

  return all;
}

function flattenRelationshipTree(nodes, ancestors = [], out = {}) {
  const list = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
  for (const node of list) {
    const code = String(node?.code ?? "").trim();
    if (!code) continue;

    const parent = String(node?.parent ?? "").trim() || null;
    const boundaryType = String(node?.boundaryType ?? "").trim() || null;
    const materializedPath = String(
      node?.ancestralMaterializedPath ?? node?.ancestralmaterializedpath ?? ""
    ).trim();
    const pathAncestors = materializedPath
      ? materializedPath.split("|").map((segment) => segment.trim()).filter(Boolean)
      : ancestors;

    out[code] = {
      code,
      parent: parent ?? (pathAncestors.length ? pathAncestors[pathAncestors.length - 1] : null),
      boundaryType,
      ancestors: pathAncestors,
      ancestralMaterializedPath: pathAncestors.join("|"),
    };

    const children = node?.children;
    if (children?.length) {
      flattenRelationshipTree(children, [...pathAncestors, code], out);
    }
  }
  return out;
}

/** County/root code shared by ward codes (e.g. BOMET from BOMET_BOMET_CENTRAL_CHESOEN). */
export function deriveBoundaryRootCode(codes = []) {
  const unique = [...new Set(codes.filter(Boolean).map((c) => String(c).trim()))];
  if (!unique.length) return null;

  const segmentCounts = new Map();
  for (const code of unique) {
    const root = code.split("_")[0]?.trim();
    if (root) segmentCounts.set(root, (segmentCounts.get(root) ?? 0) + 1);
  }

  let best = null;
  let bestCount = 0;
  for (const [root, count] of segmentCounts) {
    if (count > bestCount) {
      best = root;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Fetch parent hierarchy metadata for boundary codes.
 * Loads the full county tree from the shared root so ancestor chains are available
 * for state → city → district drill clustering.
 * API: POST /boundary-service/boundary-relationships/_search?tenantId=&codes=&hierarchyType=
 */
export async function fetchBoundaryRelationshipsByCodes(
  codes = [],
  { hierarchyType = "ADMIN" } = {}
) {
  if (!hasAuth() || !codes.length) return {};

  const tenantId = getTenantId();
  const rootCode = deriveBoundaryRootCode(codes);
  if (!rootCode) return {};

  const index = {};

  try {
    const params = new URLSearchParams({
      tenantId,
      codes: rootCode,
      hierarchyType,
      includeChildren: "true",
      limit: "500",
    });

    const response = await fetch(
      `/boundary-service/boundary-relationships/_search?${params}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ RequestInfo: buildRequestInfo() }),
      }
    );

    if (!response.ok) {
      console.warn(`boundary-relationships/_search failed (${response.status})`);
      return index;
    }

    const payload = await response.json();
    for (const tenantBoundary of payload?.TenantBoundary ?? []) {
      flattenRelationshipTree(tenantBoundary?.boundary, [], index);
    }
  } catch (error) {
    console.warn("boundary-relationships/_search error", error);
  }

  return index;
}

/** Inspect geometry types returned for the requested ward codes. */
export function summarizeBoundaryGeometry(boundaries) {
  const summary = { point: 0, polygon: 0, other: 0, missing: 0 };
  for (const boundary of boundaries) {
    const type = boundary?.geometry?.type;
    if (!type) {
      summary.missing += 1;
    } else if (type === "Point") {
      summary.point += 1;
    } else if (type === "Polygon" || type === "MultiPolygon") {
      summary.polygon += 1;
    } else {
      summary.other += 1;
    }
  }
  return summary;
}
