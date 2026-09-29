import React from 'react';
import ReactDOM from 'react-dom';
import { initLibraries } from "@egovernments/digit-ui-libraries";
import { isKeycloakAuth } from "../packages/libraries/src/services/auth/authSurface";
import { resolveTenantRoute } from "../packages/libraries/src/services/tenant/tenantRoute";
import "./index.css";
import App from './App';
import { applyTheme } from "./theme/applyTheme";
import defaultTheme from "./theme/default.json";

// Apply the bundled default theme synchronously before render.
// MDMS-driven per-tenant theme is applied later in StoreService.digitInitData()
// via window.Digit.applyTheme(); defaults remain applied on failure.
applyTheme(defaultTheme);

// Expose for integration tests in dev builds; esbuild's NODE_ENV define makes
// this a no-op (and dead-code-eliminated) in production bundles.
if (process.env.NODE_ENV !== "production") {
  window.__applyTheme = applyTheme;
}

initLibraries();

window.Digit.Customizations = { PGR: {}};
window.Digit.applyTheme = applyTheme;

const DEFAULT_LOCALE = "en_IN";

const parseValue = (value) => {
  try { return JSON.parse(value); } catch (e) { return value; }
};

const getFromStorage = (key) => {
  const value = window.localStorage.getItem(key);
  return value && value !== "undefined" ? parseValue(value) : null;
};

const getFromInfo = (info) => {
  if (!info) return null;
  if (typeof info === "string") return getFromInfo(parseValue(info));
  return info?.tenantId || info?.tenantid || info?.userInfo?.tenantId || null;
};

const clearAuthFromAnotherTenant = (routeTenant) => {
  if (!routeTenant) return;
  const sessionInfo = window.Digit.SessionStorage.get("User")?.info;
  const token = getFromStorage("token");
  const citizenToken = getFromStorage("Citizen.token");
  const employeeToken = getFromStorage("Employee.token");
  const persistedInfo = token && token === citizenToken
    ? getFromStorage("Citizen.user-info")
    : token && token === employeeToken
      ? getFromStorage("Employee.user-info")
      : routeTenant.surface === "citizen"
        ? getFromStorage("Citizen.user-info")
        : getFromStorage("Employee.user-info");
  const activeTenant = getFromInfo(sessionInfo) || getFromInfo(persistedInfo);
  if (!activeTenant || activeTenant === routeTenant.tenantId) return;

  // Auth storage predates tenant-scoped routes and is shared across tabs. Do
  // not let a token issued for one tenant silently authenticate another URL.
  ["token", "user-info", "Employee.token", "Employee.user-info", "Citizen.token", "Citizen.user-info"]
    .forEach((key) => window.localStorage.removeItem(key));
  ["User", "user_type", "userType"].forEach((key) => window.Digit.SessionStorage.del(key));
};

const TENANT_CONFLICT_KEY = "Digit.tenantContextConflict";
const TENANT_AUTH_KEYS = new Set([
  "Employee.tenant-id",
  "Employee.user-info",
  "Citizen.tenant-id",
  "Citizen.user-info",
  "tenant-id",
  "user-info",
]);

const installCrossTabTenantGuard = (routeTenant) => {
  if (!routeTenant) return;
  const expected = routeTenant.tenantId;
  window.__digitTenantContextConflict =
    window.sessionStorage.getItem(TENANT_CONFLICT_KEY) === expected;

  window.addEventListener("storage", (event) => {
    if (!event.key || !TENANT_AUTH_KEYS.has(event.key) || !event.newValue) return;
    const observed = event.key.endsWith("tenant-id")
      ? parseValue(event.newValue)
      : getFromInfo(parseValue(event.newValue));
    if (!observed || observed === expected) return;

    // localStorage is origin-wide. If another tab installs a token for a
    // different tenant, freeze this tab before it can keep issuing requests
    // with stale route state. Recovery is an explicit user action in App.
    window.sessionStorage.setItem(TENANT_CONFLICT_KEY, expected);
    window.__digitTenantContextConflict = true;
    window.dispatchEvent(new CustomEvent("digit:tenant-context-conflict"));
  });
};

const normalizeLocale = () => {
  window.localStorage.setItem("locale", DEFAULT_LOCALE);
  window.localStorage.setItem("selectedLanguage", DEFAULT_LOCALE);
  window.localStorage.setItem("i18nextLng", DEFAULT_LOCALE);
  if (window?.Digit?.StoreData?.setCurrentLanguage) {
    window.Digit.StoreData.setCurrentLanguage(DEFAULT_LOCALE);
  }
};

async function bootstrap() {
  try {
    const resolvedTenant = await resolveTenantRoute(window.location.pathname);
    if (resolvedTenant) {
      window.__digitTenantContext = resolvedTenant;
      // Compatibility bridge while upstream modules migrate from the global
      // string to the route-context helper. This is a route base, not config.
      window.contextPath = resolvedTenant.appBasePath;
      window.globalPath = resolvedTenant.appBasePath;
      clearAuthFromAnotherTenant(resolvedTenant);
      installCrossTabTenantGuard(resolvedTenant);
    }
  } catch (error) {
    window.__digitTenantContextError = error;
  }

  if (isKeycloakAuth()) {
    const { initAuthAdapter } = await import(
      "../packages/libraries/src/services/auth/index"
    );
    console.log("[bootstrap] Starting initAuthAdapter...");
    await Promise.race([
      initAuthAdapter(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("initAuthAdapter timeout after 15s")), 15000))
    ]).catch(err => {
      console.error("[bootstrap] initAuthAdapter failed:", err.message);
    });
    console.log("[bootstrap] initAuthAdapter done");
    // If KC adapter didn't authenticate (SSO check failed/timed out),
    // fall back to localStorage tokens (same as non-KC path).
    const user = window.Digit.SessionStorage.get("User");
    if (!user || !user.access_token) {
      console.log("[bootstrap] KC adapter not authenticated, recovering from localStorage");
      const token = getFromStorage("token");
      const citizenToken = getFromStorage("Citizen.token");
      const citizenInfo = getFromStorage("Citizen.user-info");
      const stateCode = window.__digitTenantContext?.tenantId || window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
      const citizenTenantId = getFromStorage("Citizen.tenant-id") || getFromInfo(citizenInfo) || stateCode;
      const employeeToken = getFromStorage("Employee.token");
      const employeeInfo = getFromStorage("Employee.user-info");
      const employeeTenantId = getFromStorage("Employee.tenant-id") || getFromInfo(employeeInfo) || stateCode;
      const userType = token === citizenToken ? "citizen" : (employeeToken ? "employee" : "citizen");

      if (token) {
        window.Digit.SessionStorage.set("user_type", userType);
        window.Digit.SessionStorage.set("userType", userType);
        const getUserDetails = (access_token, info) => ({ token: access_token, access_token, info });
        const userDetails = userType === "citizen"
          ? getUserDetails(citizenToken, citizenInfo)
          : getUserDetails(employeeToken, employeeInfo);
        window.Digit.SessionStorage.set("User", userDetails);
        window.Digit.SessionStorage.set("Citizen.tenantId", citizenTenantId);
        window.Digit.SessionStorage.set("Employee.tenantId", employeeTenantId);
        console.log("[bootstrap] Recovered session from localStorage as " + userType);
      }
    }
  } else {
    const user = window.Digit.SessionStorage.get("User");
    if (!user || !user.access_token || !user.info) {
      const token = getFromStorage("token");
      const citizenToken = getFromStorage("Citizen.token");
      const citizenInfo = getFromStorage("Citizen.user-info");
      const stateCode = window.__digitTenantContext?.tenantId || window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
      const citizenTenantId = getFromStorage("Citizen.tenant-id") || getFromInfo(citizenInfo) || stateCode;
      const employeeToken = getFromStorage("Employee.token");
      const employeeInfo = getFromStorage("Employee.user-info");
      const employeeTenantId = getFromStorage("Employee.tenant-id") || getFromInfo(employeeInfo) || stateCode;
      const userType = token === citizenToken ? "citizen" : "employee";

      window.Digit.SessionStorage.set("user_type", userType);
      window.Digit.SessionStorage.set("userType", userType);
      const getUserDetails = (access_token, info) => ({ token: access_token, access_token, info });
      const userDetails = userType === "citizen"
        ? getUserDetails(citizenToken, citizenInfo)
        : getUserDetails(employeeToken, employeeInfo);
      window.Digit.SessionStorage.set("User", userDetails);
      window.Digit.SessionStorage.set("Citizen.tenantId", citizenTenantId);
      window.Digit.SessionStorage.set("Employee.tenantId", employeeTenantId);
      if (citizenTenantId) window.localStorage.setItem("Citizen.tenant-id", citizenTenantId);
      if (employeeTenantId) window.localStorage.setItem("Employee.tenant-id", employeeTenantId);
    }
  }

  normalizeLocale();
  const stateCode = window.__digitTenantContext?.tenantId || window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
  if (window.__digitTenantContext) {
    window.Digit.SessionStorage.set("Employee.tenantId", stateCode);
    window.Digit.SessionStorage.set("Citizen.tenantId", stateCode);
    // Several enabled PGR screens still read this legacy compatibility
    // record directly instead of going through ULBService. Keep it pinned to
    // the route tenant so an old city selection can never escape the URL
    // boundary, while exposing no selector that can change it.
    window.Digit.SessionStorage.set("CITIZEN.COMMON.HOME.CITY", {
      code: stateCode,
      name: window.__digitTenantContext.name,
    });
  }
  const sessionEmployeeTenant = window.Digit.SessionStorage.get("Employee.tenantId");
  const sessionCitizenTenant = window.Digit.SessionStorage.get("Citizen.tenantId");
  if (!sessionEmployeeTenant) {
    const fallback = getFromStorage("Employee.tenant-id") || getFromInfo(window.Digit.SessionStorage.get("User")?.info) || stateCode;
    if (fallback) {
      window.Digit.SessionStorage.set("Employee.tenantId", fallback);
      window.localStorage.setItem("Employee.tenant-id", fallback);
    }
  }
  if (!sessionCitizenTenant) {
    const fallback = getFromStorage("Citizen.tenant-id") || getFromInfo(window.Digit.SessionStorage.get("User")?.info) || stateCode;
    if (fallback) {
      window.Digit.SessionStorage.set("Citizen.tenantId", fallback);
      window.localStorage.setItem("Citizen.tenant-id", fallback);
    }
  }

  console.log("[bootstrap] About to call ReactDOM.render()");
  ReactDOM.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
    document.getElementById('root')
  );
}

bootstrap();
