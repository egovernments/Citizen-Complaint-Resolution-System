import { defaultTenantContextStorage, withTenantContextCache } from "./tenantContextCache";

// URL slug rules: backend/identity-bff/docs/identity-bff.md §2.4.1 is the
// source of truth, and the BFF and pgr-services carry the same list. Reserved:
// the SPA's own path words plus every top-level nginx/Kong path prefix on the
// same host. tests/tenant-route.test.js and the local-setup static tests keep
// this list equal to the doc and to the routing configs.
const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const RESERVED_TENANT_SLUGS = Object.freeze([
  "access",
  "api",
  "assets",
  "auth",
  "boundary-service",
  "brand",
  "citizen",
  "common-persist",
  "configurator",
  "dashboard",
  "digit-ui",
  "egov-bndry-mgmnt",
  "egov-enc-service",
  "egov-hrms",
  "egov-idgen",
  "egov-indexer",
  "egov-location",
  "egov-mdms-service",
  "egov-user-event",
  "egov-workflow-v2",
  "employee",
  "env",
  "file-store",
  "filestore",
  "gatus",
  "grafana",
  "health",
  "identity",
  "images",
  "inbox",
  "kc",
  "keycloak",
  "localization",
  "matomo",
  "mcp",
  "mdms-v2",
  "novu",
  "novu-api",
  "novu-bridge",
  "novu-ws",
  "otel",
  "otp",
  "pgr-services",
  "static",
  "status",
  "tests",
  "tests-v2",
  "turbopass",
  "user",
  "user-otp",
  "user-preference",
  "v1",
  "xstate-chatbot",
]);
const RESERVED_SLUGS = new Set(RESERVED_TENANT_SLUGS);

export function isValidTenantSlug(value) {
  return typeof value === "string" &&
    TENANT_SLUG.test(value) &&
    (value.match(/[a-z]/g) || []).length >= 2 &&
    !RESERVED_SLUGS.has(value);
}

/**
 * Parse only the canonical /{tenantSlug}/digit-ui/{surface}/... shape.
 * The slug is public routing state, not a DIGIT tenant id or authorization.
 */
export function parseTenantRoute(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  if (parts.length < 2 || parts[1] !== "digit-ui" || !isValidTenantSlug(parts[0])) {
    return null;
  }
  const surface = parts[2] === "employee"
    ? "employee"
    : parts[2] === "citizen"
      ? "citizen"
      : null;
  return {
    urlSlug: parts[0],
    appBasePath: `${parts[0]}/digit-ui`,
    surface,
    routeSuffix: parts.slice(2).join("/"),
  };
}

export async function resolveTenantRoute(pathname, fetchImpl, storage = defaultTenantContextStorage()) {
  const route = parseTenantRoute(pathname);
  if (!route) {
    const parts = String(pathname || "").split("/").filter(Boolean);
    if (parts[1] === "digit-ui") {
      const error = new Error("This tenant link is not available.");
      error.status = 404;
      throw error;
    }
    return null;
  }
  const request = fetchImpl || (typeof window !== "undefined" ? window.fetch.bind(window) : null);
  if (!request) throw new Error("Tenant routing requires a fetch implementation.");
  const tenant = await withTenantContextCache(
    route.urlSlug,
    () => fetchTenantContext(route.urlSlug, request),
    storage,
  );
  return Object.freeze({ ...route, ...tenant });
}

async function fetchTenantContext(urlSlug, request) {
  let response;
  try {
    response = await request(
      `/identity/v1/tenant-contexts/${encodeURIComponent(urlSlug)}`,
      { credentials: "include", headers: { Accept: "application/json" } },
    );
  } catch (cause) {
    const error = new Error("Tenant configuration is temporarily unavailable.");
    error.networkError = true;
    error.cause = cause;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(
      response.status === 404
        ? "This tenant link is not available."
        : "Tenant configuration is temporarily unavailable.",
    );
    error.status = response.status;
    throw error;
  }
  const body = await response.json();
  const tenant = body?.tenant;
  const parentIsValid = tenant?.parentTenantId === null ||
    (typeof tenant?.parentTenantId === "string" && tenant.parentTenantId.length > 0);
  const fallbacksAreValid = Array.isArray(tenant?.fallbackTenantIds) &&
    tenant.fallbackTenantIds.every((value) => typeof value === "string" && value.length > 0);
  const hierarchyIsConsistent = tenant?.parentTenantId === null
    ? tenant?.tenantId === tenant?.rootTenantId
    : tenant?.tenantId !== tenant?.rootTenantId;
  if (!tenant || tenant.urlSlug !== urlSlug || !tenant.tenantId ||
      !tenant.rootTenantId || !parentIsValid || !fallbacksAreValid ||
      !hierarchyIsConsistent) {
    const error = new Error("Tenant configuration could not be verified.");
    error.status = 502;
    // The BFF answered, but with a bad mapping: not an outage, so no cache.
    error.verificationFailed = true;
    throw error;
  }
  return tenant;
}

export function tenantContext() {
  return typeof window === "undefined" ? null : window.__digitTenantContext || null;
}

export function currentAppBasePath() {
  return tenantContext()?.appBasePath ||
    (typeof window !== "undefined" && window.globalConfigs?.getConfig?.("CONTEXT_PATH")) ||
    "digit-ui";
}

/**
 * The MDMS app identifier (`digit-ui` in ACCESSCONTROL actions such as
 * `digit-ui-card`). Unlike the route base it never carries the tenant slug.
 */
export function mdmsAppId() {
  return (typeof window !== "undefined" && window.globalConfigs?.getConfig?.("CONTEXT_PATH")) ||
    "digit-ui";
}

/** Rebase an MDMS `/digit-ui/...` URL onto the active tenant route base. */
export function rebaseAppUrl(url, context = tenantContext()) {
  const base = context?.appBasePath;
  const appId = mdmsAppId();
  if (!base || typeof url !== "string") return url;
  return url === `/${appId}` || url.startsWith(`/${appId}/`) || url.startsWith(`/${appId}?`)
    ? `/${base}${url.slice(appId.length + 1)}`
    : url;
}

export function currentTenantId() {
  return tenantContext()?.tenantId || null;
}

export function legacyMultiRootTenantEnabled(configured, context = tenantContext()) {
  return !context && Boolean(configured);
}
