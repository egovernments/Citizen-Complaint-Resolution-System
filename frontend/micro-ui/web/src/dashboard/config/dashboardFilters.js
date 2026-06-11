import { getFiltersStorageKey, getSubMetricStorageKey } from "./dashboardConfig";
import {
  buildDefaultFilters,
  sanitizeFilters,
} from "./globalFilterGroups";
import { KPI_METRICS } from "./supervisorMetrics";

const TIME_WINDOW_METRIC_IDS = [
  "cl-metric-total-registered",
  "cl-metric-total-open",
  "cl-metric-total-resolved",
];

function loadLegacySubMetricSelection() {
  try {
    const raw = localStorage.getItem(getSubMetricStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function migrateTimeWindowFromLegacy() {
  const legacy = loadLegacySubMetricSelection();
  for (const metricId of TIME_WINDOW_METRIC_IDS) {
    const subId = legacy[metricId];
    const metric = KPI_METRICS.find((m) => m.id === metricId);
    if (subId && metric?.subMetrics.some((sub) => sub.id === subId)) {
      return subId;
    }
  }
  return buildDefaultFilters().timeWindow;
}

export function loadDashboardFilters() {
  try {
    const raw = localStorage.getItem(getFiltersStorageKey());
    if (raw) {
      return sanitizeFilters(JSON.parse(raw));
    }
  } catch {
    /* fall through */
  }

  return { timeWindow: migrateTimeWindowFromLegacy() };
}

export function clearDashboardFilters() {
  return buildDefaultFilters();
}

export function persistDashboardFilters(filters, dynamicOptions) {
  localStorage.setItem(
    getFiltersStorageKey(),
    JSON.stringify(sanitizeFilters(filters, dynamicOptions))
  );
}

export function reconcileFiltersWithOptions(filters, filterOptions) {
  if (!filterOptions) return filters;

  const next = sanitizeFilters(filters, filterOptions);
  const changed =
    next.geography !== filters.geography ||
    next.complaintType !== filters.complaintType ||
    next.dateFrom !== filters.dateFrom ||
    next.dateTo !== filters.dateTo;

  return changed ? next : filters;
}

export function resolveSubMetricId(metric, globalFilters) {
  if (!metric) return null;

  if (metric.filterGroup) {
    const value = globalFilters[metric.filterGroup];
    if (value && metric.subMetrics.some((sub) => sub.id === value)) {
      return value;
    }
    return metric.defaultSubMetricId;
  }

  return metric.defaultSubMetricId;
}
