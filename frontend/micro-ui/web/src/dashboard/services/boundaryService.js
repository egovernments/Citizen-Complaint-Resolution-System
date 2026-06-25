import { getTenantId, hasAuth } from "./analyticsService";

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

function buildRequestInfo() {
  const authToken = getEmployeeToken();
  const userInfo = getEmployeeInfo();
  return {
    apiId: "Rainmaker",
    ver: ".01",
    ts: Date.now(),
    action: "_search",
    msgId: `dashboard-boundary-${Date.now()}`,
    ...(authToken && { authToken }),
    ...(userInfo && { userInfo }),
  };
}

/**
 * Fetch boundary entities with GeoJSON geometry.
 * Supports Point centroids and Polygon/MultiPolygon choropleths.
 * API: POST /boundary-service/boundary/_search?tenantId=&codes=&limit=
 */
export async function fetchBoundariesByCodes(codes = []) {
  if (!hasAuth() || !codes.length) return [];

  const tenantId = getTenantId();
  const uniqueCodes = [...new Set(codes.filter(Boolean))];
  const chunkSize = 100;
  const all = [];

  for (let i = 0; i < uniqueCodes.length; i += chunkSize) {
    const chunk = uniqueCodes.slice(i, i + chunkSize);
    const params = new URLSearchParams({
      tenantId,
      codes: chunk.join(","),
      limit: String(chunk.length),
    });

    const response = await fetch(`/boundary-service/boundary/_search?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ RequestInfo: buildRequestInfo() }),
    });

    if (!response.ok) {
      console.warn(`boundary/_search failed (${response.status})`);
      continue;
    }

    const payload = await response.json();
    const boundaries = payload?.Boundary || [];
    all.push(...boundaries);
  }

  return all;
}

/** Inspect geometry types returned for the requested ward codes. */
export function summarizeBoundaryGeometry(boundaries) {
  const summary = { point: 0, polygon: 0, other: 0, missing: 0 };
  for (const boundary of boundaries) {
    const type = boundary?.geometry?.type;
    if (!type) {
      summary.missing += 1;
    } else if (type === "Point") {
      summary.point += 1;
    } else if (type === "Polygon" || type === "MultiPolygon") {
      summary.polygon += 1;
    } else {
      summary.other += 1;
    }
  }
  return summary;
}
