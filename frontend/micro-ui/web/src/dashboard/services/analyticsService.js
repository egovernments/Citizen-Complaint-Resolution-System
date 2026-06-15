/** Browser-facing analytics API base (relative path or absolute URL). */
export function getAnalyticsBase() {
  if (process.env.REACT_APP_ANALYTICS_BASE) {
    return process.env.REACT_APP_ANALYTICS_BASE.replace(/\/$/, "");
  }
  return process.env.NODE_ENV === "development" ? "/pgr-analytics" : "/api/analytics";
}

const ANALYTICS_BASE = getAnalyticsBase();

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getEmployeeToken() {
  const raw = window.localStorage?.getItem("Employee.token");
  return raw && raw !== "undefined" ? parseJson(raw) : null;
}

function getEmployeeInfo() {
  const raw = window.localStorage?.getItem("Employee.user-info");
  return raw && raw !== "undefined" ? parseJson(raw) : null;
}

export function getTenantId() {
  return (
    window.globalConfigs?.getConfig("STATE_LEVEL_TENANT_ID") ||
    process.env.REACT_APP_STATE_LEVEL_TENANT_ID ||
    "ke"
  );
}

export function hasAuth() {
  return Boolean(getEmployeeToken());
}

function buildRequestInfo() {
  const authToken = getEmployeeToken();
  const userInfo = getEmployeeInfo();
  return {
    apiId: "Rainmaker",
    ver: ".01",
    ts: Date.now(),
    action: "_search",
    msgId: `dashboard-${Date.now()}`,
    ...(authToken && { authToken }),
    ...(userInfo && { userInfo }),
  };
}

async function postAnalytics(path, body) {
  const response = await fetch(`${ANALYTICS_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({
      RequestInfo: buildRequestInfo(),
      ...body,
    }),
  });

  if (!response.ok) {
    const error = new Error(`Analytics request failed (${response.status})`);
    error.status = response.status;
    try {
      error.payload = await response.json();
    } catch {
      error.payload = await response.text();
    }
    throw error;
  }

  return response.json();
}

export function fetchSchema() {
  return postAnalytics("/_schema", { tenantId: getTenantId() });
}

export function runBatchQueries(queries) {
  return postAnalytics("/_query", {
    tenantId: getTenantId(),
    queries,
  });
}
