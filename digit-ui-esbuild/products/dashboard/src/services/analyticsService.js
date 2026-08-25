import { withTraceHeaders, recordApiCall } from "./dashboardMetrics";
import {
  authFetch,
  buildRequestInfo,
  getTenantId,
  toRequestError,
} from "./authService";
import { runChunkedAnalyticsBatch } from "./analyticsBatch";

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

async function postAnalytics(path, body, signal) {
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
      signal,
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

/**
 * Public dashboard transport.
 *
 * This deliberately does not use authFetch/buildRequestInfo. The public page
 * can be opened in a browser that also has a live employee session on this
 * origin; reading that session here would silently turn the public URL into an
 * employee dashboard. It would also opt a public 401 into the employee token
 * refresh / session-expiry machinery. The dedicated backend endpoints own the
 * anonymous PUBLIC contract, so this transport always sends a role-less
 * RequestInfo and performs exactly one request.
 */
async function postPublicAnalytics(path, body, signal) {
  const url = `${ANALYTICS_BASE}/public${path}`;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...withTraceHeaders({}) },
      credentials: "omit",
      signal,
      body: JSON.stringify({
        RequestInfo: {
          apiId: "Rainmaker",
          ver: ".01",
          ts: Date.now(),
          action: "_search",
          msgId: `dashboard-public-${Date.now()}`,
        },
        ...body,
      }),
    });
  } catch (error) {
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordApiCall(url, endedAt - startedAt, 0, false);
    throw error;
  }

  if (!response.ok) {
    const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    recordApiCall(url, endedAt - startedAt, 0, false);
    throw await toRequestError(response, "Public analytics request");
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
 * Returns { results: { [tileKey]: { columns, rows, asOf, scope } }, partial, errors }
 */
export function runKpiBatch(refs, tenantId, maxBatchQueries, options = {}) {
  return runChunkedAnalyticsBatch(
    refs,
    maxBatchQueries,
    (queries) => postAnalytics("/_query", { tenantId, queries }, options.signal),
    options
  );
}

/** Curated PUBLIC pack. The response itself contains the safe tile descriptors. */
export function fetchPublicPack(tenantId) {
  return postPublicAnalytics("/packs", { tenantId });
}

/**
 * POST /v2/analytics/public/catalog/_search — every PUBLIC-tagged published tile
 * (#1797). Feeds the public Add-KPI menu; same safe tile shape as fetchCatalog.
 */
export function fetchPublicCatalog(tenantId) {
  return postPublicAnalytics("/catalog/_search", { tenantId });
}

/**
 * POST /v2/analytics/public/_options — filter-bar option codes (#1797). The
 * response mirrors the inline-batch envelope useFilterOptions already reads
 * (results.wards.rows[].ward_code / results.complaintTypes.rows[].service_code)
 * so one option builder serves both surfaces; counts are stripped server-side.
 */
export function fetchPublicFilterOptions(tenantId) {
  return postPublicAnalytics("/_options", { tenantId });
}

/**
 * PUBLIC data path. The backend accepts {kpiId[, params]} references over
 * PUBLIC-tagged tiles, with params limited to the global filter bar.
 */
export function runPublicKpiBatch(refs, tenantId, maxBatchQueries, options = {}) {
  return runChunkedAnalyticsBatch(
    refs,
    maxBatchQueries,
    (queries) => postPublicAnalytics("/_query", { tenantId, queries }, options.signal),
    options
  );
}
