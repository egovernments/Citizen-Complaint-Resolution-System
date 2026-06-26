import { useMemo } from "react";
import { useCatalog } from "./useCatalog";
import { getTenantId } from "../config/dashboardConfig";
import { buildAllowedWidgetIds } from "../config/catalogGating";
import { KPI_METRICS, CHART_WIDGETS } from "../config/supervisorMetrics";

/** Read the logged-in employee's primary role for the scoping indicator. */
function getPrimaryRole() {
  try {
    const fromSession = window.Digit?.SessionStorage?.get("User")?.info;
    const sessionRole = fromSession?.roles?.[0]?.code || fromSession?.roles?.[0]?.name;
    if (sessionRole) return sessionRole;

    const raw = localStorage.getItem("Employee.user-info");
    if (raw) {
      const parsed = JSON.parse(raw);
      const user = parsed?.roles ? parsed : parsed?.userInfo || parsed;
      return user?.roles?.[0]?.code || user?.roles?.[0]?.name || user?.type || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Bridges the backend catalog (useCatalog) to the dashboard's local widget
 * registry. Computes the set of widget/metric IDs allowed for the logged-in
 * user's roles and exposes helpers for filtering the grid + the "add KPI"
 * picker.
 *
 * Graceful fallback: when the catalog is unavailable, errors, or returns an
 * empty allowed set (e.g. backend not deployed), gating is INACTIVE — the
 * dashboard renders all local KPIs exactly as before. Gating only turns on when
 * the catalog successfully returns a non-empty set of tiles.
 *
 * Returns:
 * - gatingActive: boolean
 * - allowedWidgetIds: Set<string> | null   (null when inactive)
 * - allowedKpiIds: Set<string> | null      (raw catalog kpiIds, null when inactive)
 * - roleLabel: string | null               (primary role, for the demo badge)
 * - loading: boolean
 */
export function useCatalogGating() {
  const tenantId = useMemo(() => getTenantId(), []);
  const { loading, kpis, error } = useCatalog(tenantId);
  const roleLabel = useMemo(() => getPrimaryRole(), []);

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

  return {
    loading,
    gatingActive: allowedWidgetIds != null,
    allowedWidgetIds,
    allowedKpiIds,
    roleLabel,
  };
}
