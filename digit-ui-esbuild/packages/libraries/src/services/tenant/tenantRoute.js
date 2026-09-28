const TENANT_SLUG = /^[a-z0-9-]{2,63}$/;
const RESERVED_SLUGS = new Set([
  "api",
  "auth",
  "citizen",
  "configurator",
  "digit-ui",
  "identity",
  "v1",
]);

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

export async function resolveTenantRoute(pathname, fetchImpl) {
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
  const response = await request(
    `/identity/v1/tenant-contexts/${encodeURIComponent(route.urlSlug)}`,
    { credentials: "include", headers: { Accept: "application/json" } },
  );
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
  if (!tenant || tenant.urlSlug !== route.urlSlug || !tenant.tenantId ||
      !tenant.rootTenantId || !parentIsValid || !fallbacksAreValid ||
      !hierarchyIsConsistent) {
    const error = new Error("Tenant configuration could not be verified.");
    error.status = 502;
    throw error;
  }
  return Object.freeze({ ...route, ...tenant });
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
