import { isKeycloakAuth } from "../../auth/authSurface";

// Central auth-failure handling for the axios layer and the flows that need a
// pre-flight session check (long citizen forms). Replaces the old behaviour of
// string-matching error MESSAGES and calling localStorage.clear() +
// sessionStorage.clear() — which destroyed localization caches, the citizen's
// complaint draft and the language choice on every spurious auth hiccup, and
// misrouted real session expiries to the maintenance error page.

// Platform auth error codes. Codes, not human messages: messages vary by
// service and locale; these identifiers do not.
const AUTH_ERROR_CODES = ["InvalidAccessTokenException", "InvalidTokenException", "UnauthorizedAccess", "InvalidToken"];

export const isAuthFailure = (err) => {
  if (err?.response?.status === 401) return true;
  const errors = err?.response?.data?.Errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((e) =>
    AUTH_ERROR_CODES.some((code) => String(e?.code || "").includes(code) || String(e?.message || "").includes(code))
  );
};

export const loginPathFor = (pathname = window.location.pathname) => {
  if (isKeycloakAuth()) return `/${window?.contextPath}/user/login`;
  const isEmployee = pathname.split("/").includes("employee");
  return isEmployee ? `/${window?.contextPath}/employee/user/login` : `/${window?.contextPath}/citizen/login`;
};

// Session/auth keys ONLY. Everything else — Digit.Locale.* bundles, tenant-id,
// locale/i18nextLng, the citizen complaint draft (Digit.PGR_CREATE_CITIZEN_DRAFT),
// reopen drafts (Digit.reopen.*) — must survive, both so the user can continue
// where they stopped after re-login and so a slow connection is not forced to
// re-download hundreds of KB of caches it already had.
const AUTH_SESSION_KEYS = ["Digit.User", "Digit.UserTokenExpiryAt"];
const AUTH_LOCAL_KEYS = [
  "Digit.User",
  "Citizen.token",
  "Citizen.refresh-token",
  "Citizen.user-info",
  "Employee.token",
  "Employee.refresh-token",
  "Employee.user-info",
  "token",
  "user-info",
];

export const clearAuthSession = () => {
  try {
    // This tab's own session: always ours to remove.
    const myToken = window.Digit?.UserService?.getUser?.()?.access_token;
    AUTH_SESSION_KEYS.forEach((key) => window.sessionStorage.removeItem(key));

    // The localStorage keys are SHARED by every tab. Another tab signed in as a
    // different user owns them once it logs in, so removing them blindly would
    // log that tab out on its next reload for a failure that was not its own.
    // Remove only what belongs to this tab's dead session — or, when ownership
    // cannot be established (no token to compare), remove it anyway rather than
    // leave a stale credential behind.
    AUTH_LOCAL_KEYS.forEach((key) => {
      const value = window.localStorage.getItem(key);
      if (!value) return;
      if (!myToken || value.includes(myToken)) window.localStorage.removeItem(key);
    });
  } catch (e) {
    // A blocked store must not stop the redirect to login.
  }
};

// ---- session-expiry bookkeeping ------------------------------------------
// The oauth response's expires_in was previously discarded, so the app could
// not know a session had lapsed until a call failed — typically the final
// submit of a long form. Recorded at login; checked before expensive submits.
// 60s of skew so a token never gets used within moments of dying server-side.
const EXPIRY_KEY = "Digit.UserTokenExpiryAt";
const EXPIRY_SKEW_MS = 60 * 1000;

export const rememberSessionExpiry = (tokens) => {
  const expiresIn = Number(tokens?.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return;
  try {
    window.sessionStorage.setItem(EXPIRY_KEY, String(Date.now() + expiresIn * 1000 - EXPIRY_SKEW_MS));
  } catch (e) {}
};

// false when no record exists (sessions from before this change, or logins
// whose response carried no expires_in) — never lock such users out.
export const isSessionExpired = () => {
  try {
    const at = Number(window.sessionStorage.getItem(EXPIRY_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() > at;
  } catch (e) {
    return false;
  }
};

// One redirect per page lifetime: several requests failing together (a page
// fires many in parallel) must not stack navigations.
export const redirectToLogin = () => {
  if (window.__digitAuthRedirectInFlight) return;
  window.__digitAuthRedirectInFlight = true;
  clearAuthSession();
  const from = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `${loginPathFor()}?from=${from}`;
};
