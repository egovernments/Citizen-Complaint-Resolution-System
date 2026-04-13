import React from 'react';
import ReactDOM from 'react-dom';
import { initLibraries } from "@egovernments/digit-ui-libraries";
import "./index.css";
import App from './App';

initLibraries();

window.Digit.Customizations = { PGR: {}};

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

const normalizeLocale = () => {
  window.localStorage.setItem("locale", DEFAULT_LOCALE);
  window.localStorage.setItem("selectedLanguage", DEFAULT_LOCALE);
  window.localStorage.setItem("i18nextLng", DEFAULT_LOCALE);
  if (window?.Digit?.StoreData?.setCurrentLanguage) {
    window.Digit.StoreData.setCurrentLanguage(DEFAULT_LOCALE);
  }
};

const isKeycloakAuth = () =>
  window?.globalConfigs?.getConfig("AUTH_PROVIDER") === "keycloak";

async function bootstrap() {
  if (isKeycloakAuth()) {
    const { initAuthAdapter } = await import(
      /* webpackChunkName: "keycloak-auth" */
      "../micro-ui-internals/packages/libraries/src/services/auth/index"
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
    // fall back to localStorage tokens (same as non-KC path)
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
