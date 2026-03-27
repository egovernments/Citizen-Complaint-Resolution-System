import React from 'react';
import ReactDOM from 'react-dom';
import { initLibraries, initAuthAdapter } from "@egovernments/digit-ui-libraries";
import "./index.css";
import App from './App';

initLibraries();

// Initialize Keycloak auth adapter if configured (SSO check).
// Login interception is handled inside UserService.authenticate (libraries package).
const authProvider = window.globalConfigs && window.globalConfigs.getConfig("AUTH_PROVIDER");
if (authProvider === "keycloak") {
  const adapter = initAuthAdapter();
  if (adapter) {
    adapter.init().catch(function(err) {
      console.warn("[KC] Auth adapter init failed:", err);
    });
  }
}

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
    await initAuthAdapter();
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

  ReactDOM.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
    document.getElementById('root')
  );
}

bootstrap();
