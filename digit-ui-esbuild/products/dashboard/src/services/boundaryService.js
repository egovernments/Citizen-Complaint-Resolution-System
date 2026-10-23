import {
  authFetch,
  buildRequestInfo,
  getTenantId,
  hasAuth,
} from "./authService";
import { isPublicDashboardRuntime } from "./dashboardRuntime";
import { withTraceHeaders } from "./dashboardMetrics";
import { chunkValues, runSequentialChunks } from "./sequentialChunks";
import { getMdmsSearchUrl } from "./complaintHierarchyService";

const hierarchyTypes = new Map();

/**
 * The tenant's boundary hierarchy type: its CMS-BOUNDARY.HierarchySchema "CMS"
 * row (written by the configurator's Geography step; mdms-v2 resolves a city
 * to its state's row), else globalConfigs HIERARCHY_TYPE, else ADMIN. Resolved
 * once per tenant per page load; never rejects.
 */
export function fetchTenantHierarchyType(tenantId = getTenantId()) {
  if (!hierarchyTypes.has(tenantId)) {
    hierarchyTypes.set(
      tenantId,
      (async () => {
        try {
          const response = await authFetch(getMdmsSearchUrl(), {
            headers: withTraceHeaders({}),
            sessionCritical: false,
            buildBody: () => ({
              RequestInfo: buildRequestInfo("dashboard-boundary"),
              MdmsCriteria: {
                tenantId,
                moduleDetails: [{ moduleName: "CMS-BOUNDARY", masterDetails: [{ name: "HierarchySchema" }] }],
              },
            }),
          });
          if (response.ok) {
            const rows = (await response.json())?.MdmsRes?.["CMS-BOUNDARY"]?.HierarchySchema;
            const row = Array.isArray(rows) ? rows.find((r) => r?.moduleName === "CMS" && r?.hierarchy) : null;
            if (row) return String(row.hierarchy);
          }
        } catch (error) {
          console.warn("CMS-BOUNDARY.HierarchySchema _search error", error);
        }
        return window.globalConfigs?.getConfig?.("HIERARCHY_TYPE") || "ADMIN";
      })()
    );
  }
  return hierarchyTypes.get(tenantId);
}

// ours (#1754, 2026-10-14): the tenants whose boundaries the dashboard reads.
const boundaryTenantLists = new Map();

/** The tenant has a boundary hierarchy definition of its own (200 either way, so no 4xx on a state). */
async function hasHierarchyDefinition(tenantId) {
  try {
    const hierarchyType = await fetchTenantHierarchyType(tenantId);
    const response = await authFetch(`/boundary-service/boundary-hierarchy-definition/_search`, {
      headers: withTraceHeaders({}),
      sessionCritical: false,
      buildBody: () => ({
        RequestInfo: buildRequestInfo("dashboard-boundary"),
        BoundaryTypeHierarchySearchCriteria: { tenantId, hierarchyType, limit: 1, offset: 0 },
      }),
    });
    if (!response.ok) return true; // unknown: keep reading the tenant itself, as before
    return Number((await response.json())?.totalCount ?? 0) > 0;
  } catch (error) {
    console.warn("boundary-hierarchy-definition/_search error", error);
    return true;
  }
}

/** The tenant's direct child tenants (tenant.tenants codes `<tenantId>.<x>`). */
async function childTenants(tenantId) {
  try {
    const response = await authFetch(getMdmsSearchUrl(), {
      headers: withTraceHeaders({}),
      sessionCritical: false,
      buildBody: () => ({
        RequestInfo: buildRequestInfo("dashboard-boundary"),
        MdmsCriteria: { tenantId, moduleDetails: [{ moduleName: "tenant", masterDetails: [{ name: "tenants" }] }] },
      }),
    });
    if (!response.ok) return [];
    const rows = (await response.json())?.MdmsRes?.tenant?.tenants;
    const prefix = `${tenantId}.`;
    return [...new Set((Array.isArray(rows) ? rows : [])
      .map((row) => String(row?.code ?? ""))
      .filter((code) => code.startsWith(prefix) && !code.slice(prefix.length).includes(".")))];
  } catch (error) {
    console.warn("tenant.tenants _search error", error);
    return [];
  }
}

/**
 * Where the tenant's boundaries live: the tenant itself when it has a hierarchy definition (a county, or a state in
 * the legacy flat layout), else its direct child tenants that have one (a state in the county layout: Bomet's and
 * Nairobi's boundaries live at ke.bomet / ke.nairobi, and boundary-relationships at the state answers 400
 * HIERARCHY_DEFINITION_DOES_NOT_EXIST). Falls back to the tenant itself. Resolved once per tenant per page load.
 * The public dashboard keeps reading its configured tenant (its anonymous calls stay minimal).
 */
export function resolveBoundaryTenants(tenantId = getTenantId()) {
  if (isPublicDashboardRuntime()) return Promise.resolve([tenantId]);
  if (!boundaryTenantLists.has(tenantId)) {
    boundaryTenantLists.set(
      tenantId,
      (async () => {
        if (await hasHierarchyDefinition(tenantId)) return [tenantId];
        const owners = [];
        for (const child of await childTenants(tenantId)) {
          if (await hasHierarchyDefinition(child)) owners.push(child);
        }
        return owners.length ? owners : [tenantId];
      })()
    );
  }
  return boundaryTenantLists.get(tenantId);
}


/**
 * Fetch boundary entities with GeoJSON geometry.
 * Supports Point centroids and Polygon/MultiPolygon choropleths.
 * API: POST /boundary-service/boundary/_search?tenantId=&codes=&limit=
 */
export async function fetchBoundariesByCodes(codes = []) {
  // Runtime flag first: hasAuth() reads employee storage, which the public
  // runtime must never do (publicRuntimeIsolation.test.js).
  if ((!isPublicDashboardRuntime() && !hasAuth()) || !codes.length) return [];

  const tenants = await resolveBoundaryTenants(getTenantId());
  const uniqueCodes = [...new Set(codes.filter(Boolean))];
  const all = [];
  let lastError = null;
  let successfulChunks = 0;

  // ours (#1754): one chunk list per tenant holding boundaries (a county-layout state reads its counties)
  const jobs = tenants.flatMap((tenantId) => chunkValues(uniqueCodes, 100).map((chunk) => ({ tenantId, chunk })));
  const outcomes = await runSequentialChunks(jobs, async ({ tenantId, chunk }) => {
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
 * The hierarchy defaults to the tenant's own (fetchTenantHierarchyType).
 */
export async function fetchBoundaryRelationshipsByCodes(codes = [], { hierarchyType } = {}) {
  if ((!isPublicDashboardRuntime() && !hasAuth()) || !codes.length) return {};

  const tenantId = getTenantId();
  const rootCode = deriveBoundaryRootCode(codes);
  if (!rootCode) return {};

  const index = {};
  // ours (#1754): a county-layout state reads each county's whole tree (its ward codes span the counties)
  const tenants = await resolveBoundaryTenants(tenantId);

  for (const boundaryTenant of tenants) {
    try {
      const type = hierarchyType || (await fetchTenantHierarchyType(boundaryTenant));
      const params = new URLSearchParams({
        tenantId: boundaryTenant,
        ...(boundaryTenant === tenantId ? { codes: rootCode } : {}),
        hierarchyType: type,
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
        continue;
      }

      const payload = await response.json();
      for (const tenantBoundary of payload?.TenantBoundary ?? []) {
        flattenRelationshipTree(tenantBoundary?.boundary, [], index);
      }
    } catch (error) {
      console.warn("boundary-relationships/_search error", error);
    }
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
