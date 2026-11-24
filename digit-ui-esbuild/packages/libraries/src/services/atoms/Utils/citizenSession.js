// Citizen login lives in THIS browser tab only, like an employee's (#224, VAPT
// "Insecure Session Management").
//
// Before: the citizen login screen wrote the token and the citizen's details
// (name, mobile number) into localStorage, which every tab shares and which
// survives closing the browser, and every new tab rebuilt the session from it.
// Anyone opening the same browser later was signed straight in as that citizen.
//
// Now the credentials go to sessionStorage, which belongs to one tab and is
// cleared when it closes; a new tab or a new visit asks for the OTP again.
// Non-secret preferences (city, language) stay in localStorage so the next
// login still opens in the right city and language. There is no idle sign-out
// for citizens: a citizen filling a complaint is never cut off mid-form.
// Keycloak mode has its own adapter and is not covered here.

import { parse, isCitizen } from "./employeeSession";

/** The keys that carry a citizen's credential or identity, now tab-only. */
export const CITIZEN_TAB_KEYS = ["token", "Citizen.token", "user-info", "Citizen.user-info"];

// What older builds left in localStorage for a citizen.
const LEGACY_CITIZEN_LOCAL_KEYS = ["Citizen.token", "Citizen.user-info", "Citizen.refresh-token", "citizen.userRequestObject"];

/**
 * Removes every citizen credential an older build left in localStorage,
 * including the unprefixed `token` / `user-info` aliases when they are the
 * citizen's (purgeLegacyEmployeeAuth removes them when they are an employee's).
 * Never throws: a blocked store must not stop the app from starting.
 */
export const purgeLegacyCitizenAuth = (local) => {
  const removed = [];
  try {
    const drop = (key) => {
      if (local.getItem(key) != null) {
        local.removeItem(key);
        removed.push(key);
      }
    };
    // Decide about the aliases before Citizen.token itself is removed.
    const aliasToken = local.getItem("token");
    const aliasIsCitizens = aliasToken != null && aliasToken === local.getItem("Citizen.token");
    const infoIsCitizens = isCitizen(parse(local.getItem("user-info")));

    LEGACY_CITIZEN_LOCAL_KEYS.forEach(drop);
    if (aliasIsCitizens) drop("token");
    if (infoIsCitizens) drop("user-info");
  } catch (e) {
    // private mode / blocked storage: nothing to clean, carry on
  }
  return removed;
};

/**
 * Saves a successful citizen login: credentials and identity in the tab,
 * preferences in localStorage, and any credential an older build left behind
 * is removed.
 */
export const saveCitizenLogin = ({ tab, local, userObject, token, tenantId, locale }) => {
  local.setItem("Citizen.tenant-id", tenantId);
  local.setItem("tenant-id", tenantId);
  local.setItem("locale", locale);
  local.setItem("Citizen.locale", locale);

  tab.setItem("token", token);
  tab.setItem("Citizen.token", token);
  tab.setItem("user-info", JSON.stringify(userObject));
  tab.setItem("Citizen.user-info", JSON.stringify(userObject));

  purgeLegacyCitizenAuth(local);
};
