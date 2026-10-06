import { parseTenantRoute } from "../tenant/tenantRoute";

/**
 * Auth surface + provider resolution.
 *
 * DIGIT serves two surfaces from a single bundle: citizen
 * (`/<contextPath>/citizen/...`) and employee (`/<contextPath>/employee/...`).
 * Canonical tenant-scoped routes (`/{tenantSlug}/digit-ui/{employee|citizen}`)
 * always use the Identity BFF on both surfaces. Legacy `/<contextPath>/...`
 * routes use DIGIT password/OTP auth; the browser Keycloak provider and its
 * `*_AUTH_PROVIDER` config keys were removed with the tenantless login (#2072).
 */

export function getAuthSurface(pathname) {
  const path =
    pathname || (typeof window !== "undefined" ? window.location.pathname : "");
  // Canonical /{tenantSlug}/digit-ui/{surface} routes come from the tenant
  // route parser; legacy `/<contextPath>/{surface}` routes keep any context path.
  const route = parseTenantRoute(path);
  if (route) return route.surface === "employee" ? "employee" : "citizen";
  const parts = (path || "").split("/").filter(Boolean);
  return parts[1] === "employee" ? "employee" : "citizen";
}

export function getAuthProvider(pathname) {
  const path = pathname || (typeof window !== "undefined" ? window.location.pathname : "");
  const tenantSurface = parseTenantRoute(path)?.surface;
  if (tenantSurface === "employee" || tenantSurface === "citizen") {
    return "identity-bff";
  }
  return "digit";
}

export function isIdentityBffAuth(pathname) {
  return getAuthProvider(pathname) === "identity-bff";
}

/**
 * Surface and login page for a protected route. Canonical tenant routes
 * (`/{tenantSlug}/digit-ui/{surface}/...`) resolve the surface from the
 * tenant-route parser and send users to that tenant's login; legacy
 * `/<contextPath>/{surface}/...` routes keep their historical targets.
 */
export function privateRouteLogin(pathname, contextPath) {
  const route = parseTenantRoute(pathname);
  if (route) {
    const surface = route.surface === "employee" ? "employee" : "citizen";
    return {
      surface,
      loginPath: surface === "employee"
        ? `/${route.appBasePath}/employee/user/login`
        : `/${route.appBasePath}/citizen/login`,
    };
  }
  const parts = (pathname || "").split("/").filter(Boolean);
  const surface = parts[1] === "employee" ? "employee" : "citizen";
  const loginPath = surface === "employee"
    ? `/${contextPath}/employee/user/language-selection`
    : `/${contextPath}/citizen/login`;
  return { surface, loginPath };
}
