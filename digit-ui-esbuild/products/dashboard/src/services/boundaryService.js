import {
  authFetch,
  buildRequestInfo,
  getTenantId,
  hasAuth,
} from "./authService";
import { isPublicDashboardRuntime } from "./dashboardRuntime";
import { withTraceHeaders } from "./dashboardMetrics";
import { chunkValues, runSequentialChunks } from "./sequentialChunks";


/**
 * Fetch boundary entities with GeoJSON geometry.
 * Supports Point centroids and Polygon/MultiPolygon choropleths.
 * API: POST /boundary-service/boundary/_search?tenantId=&codes=&limit=
 */
export async function fetchBoundariesByCodes(codes = []) {
  // Runtime flag first: hasAuth() reads employee storage, which the public
  // runtime must never do (publicRuntimeIsolation.test.js).
  if ((!isPublicDashboardRuntime() && !hasAuth()) || !codes.length) return [];

  const tenantId = getTenantId();
  const uniqueCodes = [...new Set(codes.filter(Boolean))];
  const all = [];
  let lastError = null;
  let successfulChunks = 0;

  const outcomes = await runSequentialChunks(chunkValues(uniqueCodes, 100), async (chunk) => {
    const params = new URLSearchParams({
      tenantId,
      codes: chunk.join(","),
      limit: String(chunk.length),
    });

    // Per-chunk tolerance so one failure does not discard what is already
    // loaded, but a TOTAL failure still rethrows so the map can show its error
    // state instead of a silently blank choropleth. Auxiliary data: a 401 here
    // must never be allowed to declare the whole session dead.
    const response = await authFetch(`/boundary-service/boundary/_search?${params}`, {
      headers: withTraceHeaders({}),
      buildBody: () => ({ RequestInfo: buildRequestInfo("dashboard-boundary") }),
      sessionCritical: false,
    });

    if (!response.ok) throw new Error(`boundary/_search failed (${response.status})`);

    const payload = await response.json();
    return payload?.Boundary || [];
  });

  for (const outcome of outcomes) {
    if (outcome.error) {
      console.warn("boundary/_search error", outcome.error);
      lastError = outcome.error;
    } else {
      successfulChunks += 1;
      all.push(...outcome.value);
    }
  }

  if (successfulChunks === 0 && lastError) throw lastError;

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
  if ((!isPublicDashboardRuntime() && !hasAuth()) || !codes.length) return {};

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

    const response = await authFetch(
      `/boundary-service/boundary-relationships/_search?${params}`,
      {
        headers: withTraceHeaders({}),
        buildBody: () => ({ RequestInfo: buildRequestInfo("dashboard-boundary") }),
        sessionCritical: false,
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
