import { parseTenantRoute } from "../tenant/tenantRoute";

/**
 * Auth surface + provider resolution.
 *
 * DIGIT serves two surfaces from a single bundle: citizen
 * (`/<contextPath>/citizen/...`) and employee (`/<contextPath>/employee/...`).
 * Canonical tenant-scoped routes (`/{tenantSlug}/digit-ui/{employee|citizen}`)
 * always use the Identity BFF on both surfaces. Legacy routes retain their
 * per-surface provider settings during migration.
 *
 * Config keys (globalConfigs):
 *   CITIZEN_AUTH_PROVIDER  - provider for the citizen surface
 *                            (default: AUTH_PROVIDER || "digit")
 *   EMPLOYEE_AUTH_PROVIDER - provider for the employee surface (default: "digit")
 *   AUTH_PROVIDER          - legacy/global key; honoured for the CITIZEN surface
 *                            only, for backward compatibility.
 *
 * The employee surface NEVER inherits the global AUTH_PROVIDER. A deployment
 * that turns on Keycloak for citizens must not silently break employee login
 * (which has no SSO path): the employee bundle would otherwise run the Keycloak
 * adapter, time out, and leave the login page wedged. That is exactly the
 * regression this split fixes.
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
  const cfg = (key) => typeof window !== "undefined" && window.globalConfigs?.getConfig(key);
  const tenantSurface = parseTenantRoute(path)?.surface;
  if (tenantSurface === "employee" || tenantSurface === "citizen") {
    return "identity-bff";
  }
  if (getAuthSurface(path) === "employee") {
    return cfg("EMPLOYEE_AUTH_PROVIDER") || "digit";
  }
  return cfg("CITIZEN_AUTH_PROVIDER") || cfg("AUTH_PROVIDER") || "digit";
}

export function isKeycloakAuth(pathname) {
  return getAuthProvider(pathname) === "keycloak";
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
  const loginPath = isKeycloakAuth(pathname)
    ? `/${contextPath}/user/login`
    : (surface === "employee"
      ? `/${contextPath}/employee/user/language-selection`
      : `/${contextPath}/citizen/login`);
  return { surface, loginPath };
}
