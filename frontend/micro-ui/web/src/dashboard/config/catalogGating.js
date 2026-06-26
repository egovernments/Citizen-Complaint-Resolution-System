/**
 * Catalog role-gating helpers for the supervisor dashboard.
 *
 * The backend (POST /api/analytics/packs + /catalog/_search) returns the set of
 * KPI tiles the logged-in user's roles are allowed to see (scoped server-side by
 * `rbac.visibleTo`). The returned tiles are keyed by `kpiId`, which corresponds
 * 1:1 with the dashboard's `queryKey` values (e.g. `cl_chart_officer_sla`,
 * `ep_leaderboard_closed`, `er_critical_by_officer`).
 *
 * For a SUPERVISOR the returned set includes the officer-PII kpiIds; for a GRO it
 * does NOT. This module maps each dashboard widget / metric card to its
 * underlying queryKey(s) and decides whether it survives the gate.
 *
 * Design notes:
 * - We only ever HIDE a widget whose query is in OFFICER_PII_QUERY_KEYS and is
 *   absent from the allowed set. Non-sensitive widgets are never gated, so a
 *   partial/curated backend catalog can't accidentally nuke the dashboard.
 * - A metric card that has at least one allowed (or non-officer) sub-metric stays,
 *   with only its disallowed officer-PII sub-metrics pruned. A card whose only
 *   identifying sub-metric is officer-PII is removed entirely for a GRO.
 * - Gating is applied ONLY when the catalog returns a non-empty allowed set
 *   (see useCatalogGating). With no catalog the local config renders unchanged.
 */

/**
 * Officer-PII query keys — per-officer (current_assignee_uuid / assignee_uuid)
 * breakdowns that expose individual staff identities. These are the keys gated
 * away from roles (e.g. GRO) that the backend does not authorise.
 */
export const OFFICER_PII_QUERY_KEYS = new Set([
  "cl_chart_officer_sla",
  "ep_table_employee_performance",
  "ep_table_employee_performance_dept",
  "ep_table_employee_performance_escalations",
  "ep_open_by_officer",
  "ep_open_list",
  "ep_closed_by_officer",
  "ep_closed_list",
  "ep_leaderboard_closed",
  "er_critical_by_officer",
]);

export function isOfficerPiiQueryKey(queryKey) {
  return !!queryKey && OFFICER_PII_QUERY_KEYS.has(queryKey);
}

/** Collect the queryKey(s) a metric card surfaces (across its sub-metrics). */
export function metricQueryKeys(metric) {
  const keys = [];
  for (const sub of metric?.subMetrics ?? []) {
    if (sub?.queryKey) keys.push(sub.queryKey);
  }
  if (metric?.queryKey) keys.push(metric.queryKey);
  return keys;
}

/**
 * Decide visibility for a flat chart/table/map widget (single queryKey).
 * Returns true if the widget should be shown for the given allowed set.
 */
export function isWidgetAllowed(widget, allowedKpiIds) {
  if (!allowedKpiIds) return true; // no gating active
  const queryKey = widget?.queryKey ?? null;
  if (!isOfficerPiiQueryKey(queryKey)) return true; // never gate non-PII widgets
  return allowedKpiIds.has(queryKey);
}

/**
 * Gate a metric card. Returns:
 * - the card unchanged when gating is inactive,
 * - a copy with disallowed officer-PII sub-metrics pruned when at least one
 *   sub-metric survives,
 * - null when the card would have no remaining sub-metrics (drop it).
 */
export function gateMetricCard(metric, allowedKpiIds) {
  if (!allowedKpiIds) return metric; // no gating active
  if (!metric?.subMetrics?.length) {
    // Flat metric (no sub-metrics) — gate by its own queryKey if officer-PII.
    return isWidgetAllowed(metric, allowedKpiIds) ? metric : null;
  }

  const keptSubs = metric.subMetrics.filter((sub) => {
    if (!isOfficerPiiQueryKey(sub?.queryKey)) return true; // keep non-PII subs
    return allowedKpiIds.has(sub.queryKey);
  });

  if (keptSubs.length === 0) return null; // entire card is officer-PII -> drop
  if (keptSubs.length === metric.subMetrics.length) return metric; // unchanged

  // Pruned a sub-metric: keep the card, reset default sub-metric if it was dropped.
  const stillHasDefault = keptSubs.some(
    (sub) => sub.id === metric.defaultSubMetricId
  );
  return {
    ...metric,
    subMetrics: keptSubs,
    defaultSubMetricId: stillHasDefault
      ? metric.defaultSubMetricId
      : keptSubs[0]?.id,
  };
}

/**
 * Build the set of widget/metric IDs that survive the gate, given a registry of
 * metric cards + chart widgets and the allowed kpiId set. Used to filter the
 * grid layout and the "add KPI" picker.
 *
 * @returns Set<string> of allowed widget IDs, or null when gating is inactive.
 */
export function buildAllowedWidgetIds(metrics, widgets, allowedKpiIds) {
  if (!allowedKpiIds) return null;
  const allowed = new Set();
  for (const metric of metrics ?? []) {
    if (gateMetricCard(metric, allowedKpiIds) != null) allowed.add(metric.id);
  }
  for (const widget of widgets ?? []) {
    if (isWidgetAllowed(widget, allowedKpiIds)) allowed.add(widget.id);
  }
  return allowed;
}
