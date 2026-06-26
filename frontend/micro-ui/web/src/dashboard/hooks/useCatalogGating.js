import { useMemo } from "react";
import { useCatalog } from "./useCatalog";
import { getTenantId } from "../config/dashboardConfig";
import { buildAllowedWidgetIds, OFFICER_PII_QUERY_KEYS } from "../config/catalogGating";
import { KPI_METRICS, CHART_WIDGETS } from "../config/supervisorMetrics";

/** Read the logged-in employee's identity for the scoping indicator. */
function getEmployeeInfo() {
  try {
    // localStorage is the authoritative source the dashboard login writes; prefer
    // it over Digit.SessionStorage, which can be stale across a user switch.
    const raw = localStorage.getItem("Employee.user-info");
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.roles ? parsed : parsed?.userInfo || parsed;
    }
    const fromSession = window.Digit?.SessionStorage?.get("User")?.info;
    if (fromSession?.roles) return fromSession;
  } catch {
    /* ignore */
  }
  return null;
}

/** The role that actually drives scoping — the first non-EMPLOYEE role. */
function getSignificantRole(userInfo) {
  const roles = userInfo?.roles || [];
  const meaningful = roles.find((r) => r.code && r.code !== "EMPLOYEE");
  return meaningful?.code || roles[0]?.code || roles[0]?.name || userInfo?.type || null;
}

function getUsername(userInfo) {
  return userInfo?.userName || userInfo?.name || null;
}

/**
 * Bridges the backend catalog (useCatalog) to the dashboard's local widget
 * registry. Computes the set of widget/metric IDs allowed for the logged-in
 * user's roles and exposes helpers for filtering the grid + the "add KPI"
 * picker, plus a legible scoping summary for the header.
 *
 * Graceful fallback: when the catalog is unavailable, errors, or returns an
 * empty allowed set (e.g. backend not deployed), gating is INACTIVE — the
 * dashboard renders all local KPIs exactly as before. Gating only turns on when
 * the catalog successfully returns a non-empty set of tiles.
 */
export function useCatalogGating() {
  const tenantId = useMemo(() => getTenantId(), []);
  const { loading, kpis, error } = useCatalog(tenantId);

  const userInfo = useMemo(() => getEmployeeInfo(), []);
  const roleLabel = useMemo(() => getSignificantRole(userInfo), [userInfo]);
  const username = useMemo(() => getUsername(userInfo), [userInfo]);

  const allowedKpiIds = useMemo(() => {
    const ids = kpis ? Object.keys(kpis) : [];
    if (error || ids.length === 0) {
      if (error) {
        // useCatalog already warns; keep a single breadcrumb for the empty case too.
        console.warn(
          "[useCatalogGating] catalog gating inactive — falling back to full local config."
        );
      }
      return null; // fallback: no gating
    }
    return new Set(ids);
  }, [kpis, error]);

  const allowedWidgetIds = useMemo(
    () => buildAllowedWidgetIds(KPI_METRICS, CHART_WIDGETS, allowedKpiIds),
    [allowedKpiIds]
  );

  // Does this role retain access to any officer-level (PII) KPI? Drives the
  // green/amber scope pill in the header.
  const officerAccess = useMemo(() => {
    if (!allowedKpiIds) return null;
    for (const k of OFFICER_PII_QUERY_KEYS) {
      if (allowedKpiIds.has(k)) return true;
    }
    return false;
  }, [allowedKpiIds]);

  return {
    loading,
    gatingActive: allowedWidgetIds != null,
    allowedWidgetIds,
    allowedKpiIds,
    visibleKpiCount: allowedKpiIds ? allowedKpiIds.size : null,
    officerAccess,
    roleLabel,
    username,
  };
}
