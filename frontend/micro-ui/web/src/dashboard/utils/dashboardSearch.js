import { TABLE_WIDGET_CONFIG } from "../config/dashboardTables";
import { WIDGETS, isKpiWidget } from "../constants/layoutConfig";

function includesQuery(text, query) {
  return String(text ?? "")
    .toLowerCase()
    .includes(query);
}

function rowMatches(row, query) {
  return Object.values(row).some((value) => includesQuery(value, query));
}

function chartSeriesMatches(items, query, labelKey = "label") {
  return (items || []).some(
    (item) =>
      includesQuery(item[labelKey], query) ||
      includesQuery(item.count, query) ||
      includesQuery(item.value, query)
  );
}

/** Returns true when a dashboard widget matches the header search query. */
export function widgetMatchesSearch(widgetId, query, { kpiCardData = {}, chartData = {} } = {}) {
  const trimmed = query?.trim();
  if (!trimmed) return true;

  const q = trimmed.toLowerCase();
  const meta = WIDGETS[widgetId];
  if (!meta) return false;

  const metaText = [meta.metric, meta.subMetric, meta.outputFormat, widgetId]
    .filter(Boolean)
    .join(" ");
  if (includesQuery(metaText, q)) return true;

  if (isKpiWidget(widgetId)) {
    const card = kpiCardData[widgetId];
    if (!card) return false;
    const parts = [card.title, card.value, card.context];
    if (card.listItems?.length) {
      card.listItems.forEach((item) => {
        parts.push(item.label, item.value);
      });
    }
    if (includesQuery(parts.join(" "), q)) return true;
  }

  const tableConfig = TABLE_WIDGET_CONFIG[widgetId];
  if (tableConfig) {
    const rows = chartData[tableConfig.dataKey] || [];
    if (rows.some((row) => rowMatches(row, q))) return true;
  }

  if (widgetId === "cl-table-complaints-at-risk") {
    const rows = chartData.complaintsAtRisk || [];
    if (rows.some((row) => rowMatches(row, q))) return true;
  }

  if (widgetId === "cl-map-geography-choropleth") {
    const layers = chartData.geographyMap ?? {};
    const rows = [
      ...(layers.created ?? []),
      ...(layers.open ?? []),
      ...(layers.resolved ?? []),
    ];
    if (rows.some((row) => rowMatches(row, q))) return true;
  }

  if (
    widgetId === "cl-chart-complaints-by-type" &&
    (chartData.complaintsByTypeStacked?.categories || []).some((label) =>
      includesQuery(label, q)
    )
  ) {
    return true;
  }
  if (widgetId === "cl-chart-departments" && chartSeriesMatches(chartData.departments, q)) {
    return true;
  }
  if (
    widgetId === "cl-chart-department-resolution-rate" &&
    chartSeriesMatches(chartData.departmentResolutionRates, q)
  ) {
    return true;
  }
  if (
    widgetId === "cl-chart-department-flow-ratio" &&
    chartSeriesMatches(chartData.departmentFlowRatios, q, "label")
  ) {
    return true;
  }
  if (
    widgetId === "cl-chart-officer-sla" &&
    (chartData.officerSlaStacked?.categories || []).some((label) => includesQuery(label, q))
  ) {
    return true;
  }
  if (
    (widgetId === "cl-chart-open-by-type" ||
      widgetId === "cl-chart-resolution-subtype") &&
    (chartData.openByTypeStacked?.categories || []).some((label) => includesQuery(label, q))
  ) {
    return true;
  }
  if (widgetId === "cl-chart-open-by-channel" && chartSeriesMatches(chartData.openByChannel, q)) {
    return true;
  }
  if (widgetId === "cl-chart-complaints-by-age" && chartSeriesMatches(chartData.complaintsByAge, q)) {
    return true;
  }

  return false;
}

export function countMatchingWidgets(layout, query, context) {
  if (!query?.trim()) return layout.length;
  return layout.filter((item) => widgetMatchesSearch(item.i, query, context)).length;
}
