import {
  getFiltersStorageKey,
  getLegacyFiltersStorageKey,
  getSubMetricStorageKey,
} from "./dashboardConfig";
import { buildDefaultFilters, sanitizeFilters } from "./globalFilterGroups";

const TIME_WINDOW_METRIC_IDS = [];

function loadLegacySubMetricSelection() {
  try {
    const raw = localStorage.getItem(getSubMetricStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function migrateTimeWindowFromLegacy(timeZone) {
  const legacy = loadLegacySubMetricSelection();
  for (const metricId of TIME_WINDOW_METRIC_IDS) {
    const subId = legacy[metricId];
    if (subId) {
      return subId;
    }
  }
  return buildDefaultFilters(timeZone).timeWindow;
}

export function loadDashboardFilters(timeZone) {
  try {
    const raw =
      localStorage.getItem(getFiltersStorageKey()) ??
      localStorage.getItem(getLegacyFiltersStorageKey());
    if (raw) {
      return sanitizeFilters(JSON.parse(raw), {}, timeZone);
    }
  } catch {
    /* fall through */
  }

  return sanitizeFilters(
    { timeWindow: migrateTimeWindowFromLegacy(timeZone) },
    {},
    timeZone
  );
}

export function clearDashboardFilters(timeZone) {
  return buildDefaultFilters(timeZone);
}

export function persistDashboardFilters(filters, dynamicOptions, timeZone) {
  localStorage.setItem(
    getFiltersStorageKey(),
    JSON.stringify(sanitizeFilters(filters, dynamicOptions, timeZone))
  );
}

export function reconcileFiltersWithOptions(filters, filterOptions, timeZone) {
  if (!filterOptions) return filters;

  // filters can be momentarily null (e.g. a rapid external date-input change racing
  // the options effect); fall back to defaults so we never read .geography off null.
  const safe = filters ?? buildDefaultFilters(timeZone);
  const next = sanitizeFilters(safe, filterOptions, timeZone);
  const changed =
    JSON.stringify(next.geographies) !== JSON.stringify(safe.geographies) ||
    JSON.stringify(next.complaintTypes) !==
      JSON.stringify(safe.complaintTypes) ||
    JSON.stringify(next.departments) !== JSON.stringify(safe.departments) ||
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
