function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function oneMonthAgoISO() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const GEOGRAPHY_OPTIONS = [
  { id: "all", label: "All wards" },
];

export const COMPLAINT_TYPE_OPTIONS = [
  { id: "all", label: "All types" },
];

/**
 * Global dashboard filters — shared dimensions across KPIs and charts.
 * timeWindow is retained for volume KPI sub-metric resolution until date-range API wiring.
 */
export const GLOBAL_FILTER_FIELDS = [
  { id: "dateFrom", type: "date", label: "From" },
  { id: "dateTo", type: "date", label: "To" },
  {
    id: "geography",
    type: "select",
    label: "Geography",
    defaultValue: "all",
    options: GEOGRAPHY_OPTIONS,
  },
  {
    id: "complaintType",
    type: "select",
    label: "Complaint type",
    defaultValue: "all",
    options: COMPLAINT_TYPE_OPTIONS,
  },
];

/** @deprecated use GLOBAL_FILTER_FIELDS */
export const GLOBAL_FILTER_GROUPS = GLOBAL_FILTER_FIELDS.filter((f) => f.type === "select");

export function buildDefaultFilters() {
  const today = todayISO();
  const monthAgo = oneMonthAgoISO();
  const defaults = Object.fromEntries(
    GLOBAL_FILTER_FIELDS.map((field) => {
      if (field.id === "dateFrom") return [field.id, monthAgo];
      if (field.id === "dateTo") return [field.id, today];
      return [field.id, field.defaultValue];
    })
  );
  defaults.timeWindow = "weekly";
  defaults.dateRangeActive = true;
  defaults.datesCustomized = false;
  return defaults;
}

export function hasActiveFilters(filters) {
  if (!filters) return false;
  const defaults = buildDefaultFilters();
  const geography = filters.geography ?? defaults.geography;
  const complaintType = filters.complaintType ?? defaults.complaintType;
  const dateFrom = filters.dateFrom ?? defaults.dateFrom;
  const dateTo = filters.dateTo ?? defaults.dateTo;
  const dateRangeActive = filters.dateRangeActive ?? defaults.dateRangeActive;

  return (
    filters.datesCustomized === true ||
    dateRangeActive !== defaults.dateRangeActive ||
    dateFrom !== defaults.dateFrom ||
    dateTo !== defaults.dateTo ||
    geography !== defaults.geography ||
    complaintType !== defaults.complaintType
  );
}

export function isValidISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeDateRange(dateFrom, dateTo) {
  if (!isValidISODate(dateFrom) || !isValidISODate(dateTo)) {
    return { dateFrom, dateTo };
  }
  if (dateFrom > dateTo) {
    return { dateFrom: dateTo, dateTo: dateFrom };
  }
  return { dateFrom, dateTo };
}

export function applyFilterChange(prev, groupId, value) {
  if (!prev || typeof prev !== "object") {
    return buildDefaultFilters();
  }

  if (groupId === "dateFrom" || groupId === "dateTo") {
    if (!isValidISODate(value)) return prev;

    const draft = {
      ...prev,
      [groupId]: value,
      datesCustomized: true,
      dateRangeActive: true,
    };
    const normalized = normalizeDateRange(draft.dateFrom, draft.dateTo);
    draft.dateFrom = normalized.dateFrom;
    draft.dateTo = normalized.dateTo;
    return sanitizeFilters(draft);
  }

  return sanitizeFilters({ ...prev, [groupId]: value });
}

export function sanitizeFilters(raw, dynamicOptions = {}) {
  const defaults = buildDefaultFilters();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  // The `= {}` default only applies when the arg is `undefined`. Callers such as
  // persistDashboardFilters(filters, dynamicOptions) can pass `null` explicitly, which
  // slips past the default and makes `dynamicOptions[field.id]` throw on the first select
  // field ("geography") — blanking the dashboard on any date-filter change. Normalize it.
  const options = dynamicOptions && typeof dynamicOptions === "object" ? dynamicOptions : {};

  const next = { ...defaults };

  for (const field of GLOBAL_FILTER_FIELDS) {
    const value = raw[field.id];
    if (field.type === "date") {
      if (raw.datesCustomized === true && isValidISODate(value)) {
        next[field.id] = value;
      }
      continue;
    }
    if (field.type === "select") {
      const fieldOptions = options[field.id] ?? field.options;
      if (fieldOptions.some((opt) => opt.id === value)) {
        next[field.id] = value;
      }
    }
  }

  if (["daily", "weekly", "monthly", "wow", "mom"].includes(raw.timeWindow)) {
    next.timeWindow = raw.timeWindow;
  }

  next.datesCustomized = raw.datesCustomized === true;

  // One-month default range is always active when dates are set (no UI to disable it).
  next.dateRangeActive =
    isValidISODate(next.dateFrom) && isValidISODate(next.dateTo);

  return next;
}
