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

  if (widgetId === "cl-chart-categories" && chartSeriesMatches(chartData.categories, q, "label")) {
    return true;
  }
  if (widgetId === "cl-chart-wards" && chartSeriesMatches(chartData.wards, q, "label")) {
    return true;
  }
  if (widgetId === "cl-chart-dow" && chartSeriesMatches(chartData.dow, q, "label")) {
    return true;
  }
  if (widgetId === "cl-list-categories" && chartSeriesMatches(chartData.trendingComplaints, q)) {
    return true;
  }

  return false;
}

export function countMatchingWidgets(layout, query, context) {
  if (!query?.trim()) return layout.length;
  return layout.filter((item) => widgetMatchesSearch(item.i, query, context)).length;
}
