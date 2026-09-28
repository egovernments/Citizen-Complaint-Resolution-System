import { authFetch, buildRequestInfo, getTenantId, hasAuth } from "./authService";
import { withTraceHeaders } from "./dashboardMetrics";

/**
 * Boundary-hierarchy fetch for the geography drill-down filter (CCSD-2171).
 *
 * Returns the boundary-relationships root nodes (nested { code, boundaryType,
 * children } — the input buildBoundaryTree expects), or null on ANY failure
 * (never rejects): no auth, no hierarchy type resolvable, HTTP error, empty
 * tree. Callers fall back to the flat ward select, exactly like the
 * complaint-type tree's degrade path.
 *
 * The hierarchy type comes from the deployment's HIERARCHY_TYPE globalConfig
 * (the same pin the PGR employee pages use — mz: "divisao_administrativa").
 * When unset, it is discovered from boundary-hierarchy-definition/_search
 * (first definition at the tenant), so flat/default deployments still work
 * without config.
 */

function getConfiguredHierarchyType() {
  const get = window.globalConfigs?.getConfig?.bind(window.globalConfigs);
  const pin = get?.("HIERARCHY_TYPE");
  return typeof pin === "string" && pin.trim() ? pin.trim() : null;
}

async function discoverHierarchyType(tenantId) {
  try {
    const response = await authFetch(
      `/boundary-service/boundary-hierarchy-definition/_search`,
      {
        headers: withTraceHeaders({}),
        // authFetch's contract is buildBody (re-invoked with a FRESH
        // RequestInfo on 401-refresh replays) — a plain `body` is ignored.
        buildBody: () => ({
          RequestInfo: buildRequestInfo("dashboard-boundary"),
          BoundaryTypeHierarchySearchCriteria: { tenantId },
        }),
        sessionCritical: false,
      }
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const first = payload?.BoundaryHierarchy?.[0]?.hierarchyType;
    return typeof first === "string" && first.trim() ? first.trim() : null;
  } catch {
    return null;
  }
}

/** Fetch the full relationships tree for the tenant's hierarchy. */
export async function fetchBoundaryTreeRoots() {
  if (!hasAuth()) return null;
  try {
    const tenantId = getTenantId();
    const hierarchyType =
      getConfiguredHierarchyType() || (await discoverHierarchyType(tenantId));
    if (!hierarchyType) return null;

    const params = new URLSearchParams({
      tenantId,
      hierarchyType,
      includeChildren: "true",
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
      console.warn(`boundary-relationships _search failed (${response.status})`);
      return null;
    }
    const payload = await response.json();
    const roots = payload?.TenantBoundary?.[0]?.boundary;
    return Array.isArray(roots) && roots.length ? roots : null;
  } catch (error) {
    console.warn("boundary-relationships _search error", error);
    return null;
  }
}
