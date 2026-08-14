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
    const raw = localStorage.getItem(getFiltersStorageKey());
    if (raw) {
      return sanitizeFilters(JSON.parse(raw), {}, timeZone);
    }
  } catch {
    /* fall through */
  }

  return sanitizeFilters({ timeWindow: migrateTimeWindowFromLegacy(timeZone) }, {}, timeZone);
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
    next.geography !== safe.geography ||
    next.complaintType !== safe.complaintType ||
    // The tree filter's companions can be repaired (path backfilled, leaf
    // re-derived) even when the code survives — must propagate too.
    next.complaintTypePath !== safe.complaintTypePath ||
    next.complaintTypeLeaf !== safe.complaintTypeLeaf ||
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
