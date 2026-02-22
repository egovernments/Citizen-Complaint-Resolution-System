import React from 'react';
import ReactDOM from 'react-dom';
import { initLibraries } from "@egovernments/digit-ui-libraries";
import "./index.css";
import App from './App';


initLibraries();


window.Digit.Customizations = { PGR: {}};

const DEFAULT_LOCALE = "en_IN";

const user = window.Digit.SessionStorage.get("User");

const parseValue = (value) => {
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
}

const getFromStorage = (key) => {
  const value = window.localStorage.getItem(key);
  return value && value !== "undefined" ? parseValue(value) : null;
}

const getFromInfo = (info) => {
  if (!info) return null;
  if (typeof info === "string") {
    const parsed = parseValue(info);
    return getFromInfo(parsed);
  }
  return info?.tenantId || info?.tenantid || info?.userInfo?.tenantId || null;
}

const normalizeLocale = () => {
  // Keep locale deterministic so localization requests don't unexpectedly switch language.
  window.localStorage.setItem("locale", DEFAULT_LOCALE);
  window.localStorage.setItem("selectedLanguage", DEFAULT_LOCALE);
  window.localStorage.setItem("i18nextLng", DEFAULT_LOCALE);
  if (window?.Digit?.StoreData?.setCurrentLanguage) {
    window.Digit.StoreData.setCurrentLanguage(DEFAULT_LOCALE);
  }
}

if (!user || !user.access_token || !user.info) {
  // login detection

  const token = getFromStorage("token")

  const citizenToken = getFromStorage("Citizen.token")
  const citizenInfo = getFromStorage("Citizen.user-info")
  const stateCode = window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
  const citizenTenantId = getFromStorage("Citizen.tenant-id") || getFromInfo(citizenInfo) || stateCode;

  const employeeToken = getFromStorage("Employee.token")
  const employeeInfo = getFromStorage("Employee.user-info")
  const employeeTenantId = getFromStorage("Employee.tenant-id") || getFromInfo(employeeInfo) || stateCode;
  const userType = token === citizenToken ? "citizen" : "employee";

  window.Digit.SessionStorage.set("user_type", userType);
  window.Digit.SessionStorage.set("userType", userType);

  const getUserDetails = (access_token, info) => ({ token: access_token, access_token, info })

  const userDetails = userType === "citizen" ? getUserDetails(citizenToken, citizenInfo) : getUserDetails(employeeToken, employeeInfo)

  window.Digit.SessionStorage.set("User", userDetails);
  window.Digit.SessionStorage.set("Citizen.tenantId", citizenTenantId);
  window.Digit.SessionStorage.set("Employee.tenantId", employeeTenantId);
  // Keep tenant-id keys in sync for fresh browser sessions.
  if (citizenTenantId) window.localStorage.setItem("Citizen.tenant-id", citizenTenantId);
  if (employeeTenantId) window.localStorage.setItem("Employee.tenant-id", employeeTenantId);
  // end
}

// Always normalize locale and tenant fallback, even when User exists in SessionStorage.
normalizeLocale();
const stateCode = window?.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID");
const sessionEmployeeTenant = window.Digit.SessionStorage.get("Employee.tenantId");
const sessionCitizenTenant = window.Digit.SessionStorage.get("Citizen.tenantId");
if (!sessionEmployeeTenant) {
  const fallbackEmployeeTenant = getFromStorage("Employee.tenant-id") || getFromInfo(window.Digit.SessionStorage.get("User")?.info) || stateCode;
  if (fallbackEmployeeTenant) {
    window.Digit.SessionStorage.set("Employee.tenantId", fallbackEmployeeTenant);
    window.localStorage.setItem("Employee.tenant-id", fallbackEmployeeTenant);
  }
}
if (!sessionCitizenTenant) {
  const fallbackCitizenTenant = getFromStorage("Citizen.tenant-id") || getFromInfo(window.Digit.SessionStorage.get("User")?.info) || stateCode;
  if (fallbackCitizenTenant) {
    window.Digit.SessionStorage.set("Citizen.tenantId", fallbackCitizenTenant);
    window.localStorage.setItem("Citizen.tenant-id", fallbackCitizenTenant);
  }
}

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);
