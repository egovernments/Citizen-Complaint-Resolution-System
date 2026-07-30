/**
 * Single source of truth for dashboard auth: token storage, RequestInfo
 * construction, and the 401 -> refresh -> retry cycle.
 *
 * Before this module, getEmployeeToken / getEmployeeInfo / buildRequestInfo were
 * duplicated verbatim in analyticsService, boundaryService and
 * complaintHierarchyService, and no caller inspected response.status. A 401
 * therefore surfaced as the raw string "Analytics request failed (401)" in a
 * banner, and the auth gate (evaluated once at mount) never re-ran (#1466).
 *
 * Behaviour verified against egov-user on bomet, not assumed:
 *   - grant_type=refresh_token is supported and returns a new access_token.
 *   - The refresh token is NOT rotated: the same value comes back.
 *   - Refreshing IMMEDIATELY invalidates the previous access token — a request
 *     still in flight with the old token gets 401. This is why refresh must be
 *     single-flight and why we retry the original request afterwards, rather
 *     than letting each 401 refresh independently.
 *   - A dead refresh token returns HTTP 400 invalid_grant (not 401), so the
 *     refresh call's own failure must never be fed back into this retry path.
 *   - Tokens are opaque UUIDs, not JWTs, so expiry cannot be inspected client
 *     side. Refresh is necessarily reactive (on 401), never pre-emptive.
 */

const TOKEN_KEY = "Employee.token";
const REFRESH_KEY = "Employee.refresh-token";
const USER_INFO_KEY = "Employee.user-info";
const TENANT_KEY = "Employee.tenant-id";

/** Keys cleared on sign-out / dead session. Mirrors what login writes. */
const SESSION_KEYS = [TOKEN_KEY, REFRESH_KEY, USER_INFO_KEY, TENANT_KEY, "user-info", "token"];

export const SESSION_EXPIRED_EVENT = "dashboard:session-expired";

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function readStorage(key) {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw && raw !== "undefined" && raw !== "null" ? parseJson(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — non-fatal, the session just won't survive reload */
  }
}

export function getEmployeeToken() {
  return readStorage(TOKEN_KEY);
}

export function getRefreshToken() {
  return readStorage(REFRESH_KEY);
}

export function getEmployeeInfo() {
  return readStorage(USER_INFO_KEY);
}

export function getTenantId() {
  return (
    window.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID") ||
    process.env.REACT_APP_STATE_LEVEL_TENANT_ID ||
    "ke"
  );
}

/**
 * True when a token is PRESENT. Deliberately not a validity check — tokens are
 * opaque, so validity is only knowable by calling the API. Session death is
 * detected reactively via SESSION_EXPIRED_EVENT.
 */
export function hasAuth() {
  return Boolean(getEmployeeToken());
}

export function persistSession({ accessToken, refreshToken, userInfo, tenantId }) {
  if (accessToken != null) {
    writeStorage(TOKEN_KEY, accessToken);
    writeStorage("token", accessToken);
  }
  if (refreshToken != null) writeStorage(REFRESH_KEY, refreshToken);
  if (userInfo != null) {
    writeStorage(USER_INFO_KEY, userInfo);
    writeStorage("user-info", userInfo);
  }
  if (tenantId != null) writeStorage(TENANT_KEY, tenantId);
}

export function clearSession() {
  SESSION_KEYS.forEach((k) => {
    try {
      window.localStorage?.removeItem(k);
    } catch {
      /* ignore */
    }
  });
}

/** Notifies the app that the session is unrecoverable and login must be shown. */
function announceSessionExpired() {
  clearSession();
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  } catch {
    /* CustomEvent unavailable — the auth gate still re-checks on next render */
  }
}

export function buildRequestInfo(msgIdPrefix = "dashboard") {
  const authToken = getEmployeeToken();
  const userInfo = getEmployeeInfo();
  return {
    apiId: "Rainmaker",
    ver: ".01",
    ts: Date.now(),
    action: "_search",
    msgId: `${msgIdPrefix}-${Date.now()}`,
    ...(authToken && { authToken }),
    ...(userInfo && { userInfo }),
  };
}

/**
 * OAuth client credentials header. globalConfigs stores JWT_TOKEN as the bare
 * base64 of "egov-user-client:" WITHOUT the scheme, so the "Basic " prefix is
 * added here — matching what DashboardLogin sends on the password grant.
 */
export function getOAuthBasic() {
  const configured = window.globalConfigs?.getConfig?.("JWT_TOKEN");
  const raw = configured || "ZWdvdi11c2VyLWNsaWVudDo=";
  return /^Basic\s/i.test(raw) ? raw : `Basic ${raw}`;
}

/**
 * In-flight refresh, shared by every caller that 401s in the same window.
 * Without this, N concurrent batch queries would fire N refreshes, and since
 * each refresh invalidates the prior access token they would invalidate each
 * other's tokens in turn.
 */
let refreshInFlight = null;

async function requestRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    tenantId: getTenantId(),
  });

  const res = await fetch("/user/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: getOAuthBasic(),
    },
    body,
  });

  // A dead/blacklisted refresh token answers 400 invalid_grant. Anything
  // non-2xx here means the session cannot be recovered.
  if (!res.ok) return false;

  const data = await res.json();
  if (!data?.access_token) return false;

  persistSession({
    accessToken: data.access_token,
    // Not rotated today, but honour a rotated value if the server ever sends one.
    refreshToken: data.refresh_token || refreshToken,
    userInfo: data.UserRequest || undefined,
  });
  return true;
}

/** Single-flight wrapper around requestRefresh. Resolves to a boolean. */
function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = requestRefresh()
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * fetch() for authenticated dashboard APIs.
 *
 * `buildBody` is a function, not a value: on retry the RequestInfo must be
 * rebuilt so the request carries the NEW token. Passing a pre-serialised body
 * would replay the dead one and 401 again.
 *
 * On a 401 it refreshes once (shared across callers) and replays the request.
 * If refresh fails, or the replay 401s again, the session is announced dead and
 * the error is thrown with `status` and `sessionExpired` set for callers.
 */
export async function authFetch(url, { buildBody, method = "POST", headers } = {}) {
  const send = () =>
    fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      credentials: "omit",
      body: buildBody ? JSON.stringify(buildBody()) : undefined,
    });

  let response = await send();

  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) response = await send();

    if (!refreshed || response.status === 401) {
      announceSessionExpired();
      const error = new Error("Your session has expired. Please sign in again.");
      error.status = 401;
      error.sessionExpired = true;
      throw error;
    }
  }

  return response;
}

/** Shared non-401 error shape so every service reports failures identically. */
export async function toRequestError(response, label) {
  const error = new Error(`${label} failed (${response.status})`);
  error.status = response.status;
  try {
    error.payload = await response.json();
  } catch {
    try {
      error.payload = await response.text();
    } catch {
      error.payload = null;
    }
  }
  return error;
}
