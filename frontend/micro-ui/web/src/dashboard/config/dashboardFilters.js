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

function pickPersistedFilters(parsed) {
  if (!parsed || typeof parsed !== "object") return {};

  const next = {
    geography: parsed.geography,
    complaintType: parsed.complaintType,
    timeWindow: parsed.timeWindow,
  };

  if (parsed.datesCustomized === true) {
    next.datesCustomized = true;
    next.dateFrom = parsed.dateFrom;
    next.dateTo = parsed.dateTo;
  }

  return next;
}

export function loadDashboardFilters() {
  try {
    const raw = localStorage.getItem(getFiltersStorageKey());
    if (raw) {
      return sanitizeFilters(pickPersistedFilters(JSON.parse(raw)));
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
  try {
    const sanitized = sanitizeFilters(filters, dynamicOptions);
    const toSave = {
      geography: sanitized.geography,
      complaintType: sanitized.complaintType,
      timeWindow: sanitized.timeWindow,
    };

    if (sanitized.datesCustomized) {
      toSave.datesCustomized = true;
      toSave.dateFrom = sanitized.dateFrom;
      toSave.dateTo = sanitized.dateTo;
    }

    localStorage.setItem(getFiltersStorageKey(), JSON.stringify(toSave));
  } catch {
    /* ignore quota / private-mode storage errors */
  }
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
