import React from 'react';
import ReactDOM from 'react-dom';
import { initLibraries } from "@egovernments/digit-ui-libraries";
import { isKeycloakAuth } from "../packages/libraries/src/services/auth/authSurface";
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

// CCSD-2161: derive the boot default from the deploy's configured locale
// (globalConfigs LOCALE_DEFAULT/LOCALE_REGION — pt_PT on Moz) instead of a
// hardcoded en_IN, which clobbered the "pt" that public/globalConfigs.js had
// just written and forced every fresh session to English.
const getDefaultLocale = () => {
  try {
    const d = window?.Digit?.Utils?.getDefaultLanguage?.();
    if (d && !d.includes("undefined")) return d;
  } catch (e) {}
  return "en_IN";
};

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

// CCSD-2161: only seed defaults when the user has NO stored choice — the old
// version unconditionally rewrote locale/selectedLanguage/i18nextLng to en_IN
// on EVERY boot, overriding both the configured default and any prior manual
// toggle's raw-localStorage traces. Crucially, also seed the wrapped
// Digit.SessionStorage "locale" key: that is the ONE key both language paths
// read (i18next's active lng via getCurrentLanguage(), and the bundle fetch
// via initData.selectedLanguage). Nothing seeded it before, which is why the
// active language said pt_PT while the en_IN bundle loaded.
const normalizeLocale = () => {
  const existing = window.Digit?.SessionStorage?.get?.("locale");
  if (existing) return; // explicit user choice (manual toggle) always wins
  const def = getDefaultLocale();
  window.localStorage.setItem("locale", def);
  window.localStorage.setItem("selectedLanguage", def);
  window.localStorage.setItem("i18nextLng", def);
  window.Digit?.SessionStorage?.set?.("locale", def);
};

async function bootstrap() {
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
      const stateCode = window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
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
      const stateCode = window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
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
  const stateCode = window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
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
