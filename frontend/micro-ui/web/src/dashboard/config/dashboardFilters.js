import { getFiltersStorageKey, getSubMetricStorageKey } from "./dashboardConfig";
import {
  buildDefaultFilters,
  sanitizeFilters,
} from "./globalFilterGroups";

const TIME_WINDOW_METRIC_IDS = [];

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
    if (subId) {
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

  return sanitizeFilters({ timeWindow: migrateTimeWindowFromLegacy() });
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

  // `filters` can momentarily be null (e.g. a rapid external change racing the options
  // effect); sanitizeFilters already tolerates that, but the comparison below dereferences
  // it — fall back to sane defaults so we never read `.geography` off null.
  const safe = filters && typeof filters === "object" ? filters : buildDefaultFilters();
  const next = sanitizeFilters(safe, filterOptions);
  const changed =
    next.geography !== safe.geography ||
    next.complaintType !== safe.complaintType ||
    next.dateFrom !== safe.dateFrom ||
    next.dateTo !== safe.dateTo;

  return changed ? next : safe;
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
