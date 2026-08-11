import { withTraceHeaders, recordApiCall } from "./dashboardMetrics";
import {
  authFetch,
  buildRequestInfo,
  getTenantId,
  toRequestError,
} from "./authService";
import { normalizeAnalyticsBatch } from "./analyticsBatch";

// Re-exported for existing importers; authService is the definition.
export { getTenantId };

/** Browser-facing analytics API base (relative path or absolute URL). */
export function getAnalyticsBase() {
  if (process.env.REACT_APP_ANALYTICS_BASE) {
    return process.env.REACT_APP_ANALYTICS_BASE.replace(/\/$/, "");
  }
  return process.env.NODE_ENV === "development" ? "/pgr-analytics" : "/api/analytics";
}

const ANALYTICS_BASE = getAnalyticsBase();

async function postAnalytics(path, body) {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  // The analytics API is the dashboard's primary data path, so it is the one
  // surface allowed to conclude the session is dead (sessionCritical defaults
  // to true). Trace headers are preserved through the wrapper.
  // authFetch THROWS on every terminal 401 verdict, which would skip the
  // recordApiCall below — so during an auth incident the metrics would show zero
  // failed analytics calls while users stared at error banners, hiding exactly
  // the outage this module is meant to surface. Record, then rethrow.
  let response;
  try {
    response = await authFetch(`${ANALYTICS_BASE}${path}`, {
      headers: withTraceHeaders({}),
      buildBody: () => ({
        RequestInfo: buildRequestInfo("dashboard"),
        ...body,
      }),
    });
  } catch (error) {
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordApiCall(`${ANALYTICS_BASE}${path}`, endedAt - startedAt, 0, false);
    throw error;
  }

  if (!response.ok) {
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordApiCall(`${ANALYTICS_BASE}${path}`, endedAt - startedAt, 0, false);
    throw await toRequestError(response, "Analytics request");
  }

  return response.json();
}

export function fetchSchema() {
  return postAnalytics("/_schema", { tenantId: getTenantId() });
}

export function runBatchQueries(queries) {
  return postAnalytics("/_query", {
    tenantId: getTenantId(),
    queries,
  });
}

/**
 * POST /v2/analytics/packs — schema bootstrap (no data).
 * Returns { tiles, defaultLayout, asOf } with full viz schema per tile.
 * Never includes query bodies or rbac ceilings.
 */
export function fetchPack(tenantId) {
  return postAnalytics("/packs", { tenantId });
}

/**
 * POST /v2/analytics/catalog/_search — full role-filtered catalog for the picker.
 * Returns { tiles, total } — same tile shape as /packs but no defaultLayout.
 */
export function fetchCatalog(tenantId) {
  return postAnalytics("/catalog/_search", { tenantId, filters: { status: "published" } });
}

/**
 * POST /v2/analytics/_query — data, by kpiId reference (not inline).
 * refs: { [tileKey]: { kpiId, params } }
 * Returns { results, partial, errors: { [tileKey]: { code, message } } | null }.
 * Legacy inline and additive top-level backend errors are normalized at this boundary.
 */
export function runKpiBatch(refs, tenantId) {
  return postAnalytics("/_query", { tenantId, queries: refs }).then(normalizeAnalyticsBatch);
}
