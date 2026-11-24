// Employee login lives in THIS browser tab only (#224, VAPT "Insecure Session
// Management").
//
// Before: both employee login screens wrote the token and the user's details
// (mobile number, email, roles) into localStorage, which every tab shares and
// which survives closing the browser, and every new tab rebuilt the session from
// it. Closing the tab never ended the login, anyone opening the same browser
// later was signed straight in (for as long as the server token lived), and any
// script on the page could read the token.
//
// Now the credentials go to sessionStorage, which belongs to one tab and is
// cleared when it closes. Non-secret preferences (tenant, language) stay in
// localStorage so the next login still opens in the right city and language.
//
// A citizen's login follows the same rule (citizenSession.js). Keycloak mode
// has its own adapter and is not covered here.

import { markEmployeeActive } from "./idleTimer";

/** The four keys that carry an employee's credential or identity, now tab-only. */
export const EMPLOYEE_TAB_KEYS = ["token", "Employee.token", "user-info", "Employee.user-info"];

// What older builds left in localStorage for an employee.
const LEGACY_EMPLOYEE_LOCAL_KEYS = ["Employee.token", "Employee.user-info", "Employee.refresh-token"];

export const parse = (raw) => {
  if (raw == null || raw === "undefined" || raw === "null") return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
};

export const isCitizen = (info) => String((info && (info.type || (info.info && info.info.type))) || "").toUpperCase() === "CITIZEN";

/**
 * Removes every employee credential an older build left in localStorage.
 * The unprefixed `token` / `user-info` aliases are shared with the citizen
 * portal, so they are only removed when they are NOT a signed-in citizen's.
 * Never throws: a blocked store must not stop the app from starting.
 */
export const purgeLegacyEmployeeAuth = (local) => {
  const removed = [];
  try {
    const drop = (key) => {
      if (local.getItem(key) != null) {
        local.removeItem(key);
        removed.push(key);
      }
    };
    LEGACY_EMPLOYEE_LOCAL_KEYS.forEach(drop);

    const aliasToken = local.getItem("token");
    const citizenToken = local.getItem("Citizen.token");
    const aliasIsCitizens = aliasToken != null && aliasToken === citizenToken;
    if (!aliasIsCitizens) {
      drop("token");
      if (!isCitizen(parse(local.getItem("user-info")))) drop("user-info");
    }
    // Employee login also used to copy the employee's details here; nothing reads
    // this localStorage key (readers use the Digit.SessionStorage copy).
    if (!isCitizen(parse(local.getItem("citizen.userRequestObject")))) drop("citizen.userRequestObject");
  } catch (e) {
    // private mode / blocked storage: nothing to clean, carry on
  }
  return removed;
};

/**
 * Saves a successful employee login: credentials and identity in the tab,
 * preferences in localStorage, and any credential an older build left behind
 * is removed. Used by both the password and the OTP login screens.
 */
export const saveEmployeeLogin = ({ tab, local, userObject, token, locale }) => {
  local.setItem("Employee.tenant-id", userObject?.tenantId);
  local.setItem("tenant-id", userObject?.tenantId);
  local.setItem("locale", locale);
  local.setItem("Employee.locale", locale);

  tab.setItem("token", token);
  tab.setItem("Employee.token", token);
  tab.setItem("user-info", JSON.stringify(userObject));
  tab.setItem("Employee.user-info", JSON.stringify(userObject));

  purgeLegacyEmployeeAuth(local);
  // A login is activity: the idle-logout clock (shared by the employee's tabs)
  // starts from now, not from whatever an earlier session left behind.
  markEmployeeActive(local);
};

/**
 * The user a NEW tab starts with (DIGIT login): nobody. Neither an employee nor
 * a citizen is rebuilt from localStorage, so closing the tab ends the login and
 * a new tab asks for it again. Only the user type is worked out as before, and
 * the shape matches what app start-up wrote before this change.
 */
export const bootUserFromLocal = (local) => {
  const read = (key) => {
    try {
      return parse(local.getItem(key));
    } catch (e) {
      return null;
    }
  };
  const userType = read("token") === read("Citizen.token") ? "citizen" : "employee";
  return { userType, user: { token: null, access_token: null, info: null } };
};
