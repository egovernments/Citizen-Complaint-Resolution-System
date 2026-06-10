/**
 * Auth surface + provider resolution.
 *
 * DIGIT serves two surfaces from a single bundle: citizen
 * (`/<contextPath>/citizen/...`) and employee (`/<contextPath>/employee/...`).
 * They can use DIFFERENT auth providers — e.g. Keycloak/SSO for citizens while
 * employees stay on DIGIT password auth.
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
  // `/<contextPath>/employee/...` -> employee, anything else -> citizen.
  const parts = (path || "").split("/").filter(Boolean);
  return parts[1] === "employee" ? "employee" : "citizen";
}

export function getAuthProvider(pathname) {
  const cfg = (key) => window?.globalConfigs?.getConfig(key);
  if (getAuthSurface(pathname) === "employee") {
    return cfg("EMPLOYEE_AUTH_PROVIDER") || "digit";
  }
  return cfg("CITIZEN_AUTH_PROVIDER") || cfg("AUTH_PROVIDER") || "digit";
}

export function isKeycloakAuth(pathname) {
  return getAuthProvider(pathname) === "keycloak";
}
