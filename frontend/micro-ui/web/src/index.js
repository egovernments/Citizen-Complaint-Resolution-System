import React from 'react';
import ReactDOM from 'react-dom';
import { initLibraries } from "@egovernments/digit-ui-libraries";
import "./index.css";
import App from './App';
import { applyTheme } from "./theme/applyTheme";
import defaultTheme from "./theme/default.json";

// Phase 1: apply the bundled default theme before the libraries init so
// every component renders against the active palette from first paint.
// Phase 2 (future): fetch MDMS `common-masters.ThemeConfig` per tenant
// once the user/tenant is resolved and re-apply on top of these defaults.
applyTheme(defaultTheme);

if (process.env.NODE_ENV === "development") {
  // Dev-only: tweak the live palette from the console.
  //   window.__applyTheme({ version: "1", colors: { primary: { main: "#10cdda" } } })
  window.__applyTheme = applyTheme;
}


initLibraries();


window.Digit.Customizations = { PGR: {}};

const user = window.Digit.SessionStorage.get("User");

if (!user || !user.access_token || !user.info) {
  // login detection

  const parseValue = (value) => {
    try {
      return JSON.parse(value)
    } catch (e) {
      return value
    }
  }

  const getFromStorage = (key) => {
    const value = window.localStorage.getItem(key);
    return value && value !== "undefined" ? parseValue(value) : null;
  }

  const token = getFromStorage("token")

  const citizenToken = getFromStorage("Citizen.token")
  const citizenInfo = getFromStorage("Citizen.user-info")
  const citizenTenantId = getFromStorage("Citizen.tenant-id")

  const employeeToken = getFromStorage("Employee.token")
  const employeeInfo = getFromStorage("Employee.user-info")
  const employeeTenantId = getFromStorage("Employee.tenant-id")
  const userType = token === citizenToken ? "citizen" : "employee";

  window.Digit.SessionStorage.set("user_type", userType);
  window.Digit.SessionStorage.set("userType", userType);

  const getUserDetails = (access_token, info) => ({ token: access_token, access_token, info })

  const userDetails = userType === "citizen" ? getUserDetails(citizenToken, citizenInfo) : getUserDetails(employeeToken, employeeInfo)

  window.Digit.SessionStorage.set("User", userDetails);
  window.Digit.SessionStorage.set("Citizen.tenantId", citizenTenantId);
  window.Digit.SessionStorage.set("Employee.tenantId", employeeTenantId);
  // end
}

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);

