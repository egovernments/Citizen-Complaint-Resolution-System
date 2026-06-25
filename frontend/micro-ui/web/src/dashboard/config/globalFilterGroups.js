function todayISO() {
  const d = new Date();
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
  { id: "dateFrom", type: "date", label: "From", defaultValue: todayISO() },
  { id: "dateTo", type: "date", label: "To", defaultValue: todayISO() },
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
  const defaults = Object.fromEntries(
    GLOBAL_FILTER_FIELDS.map((field) => [field.id, field.defaultValue])
  );
  defaults.timeWindow = "weekly";
  defaults.dateRangeActive = false;
  return defaults;
}

export function hasActiveFilters(filters) {
  if (!filters) return false;
  if (filters.dateRangeActive) return true;
  const defaults = buildDefaultFilters();
  return (
    filters.geography !== defaults.geography ||
    filters.complaintType !== defaults.complaintType
  );
}

function isValidISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function sanitizeFilters(raw, dynamicOptions = {}) {
  const defaults = buildDefaultFilters();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const next = { ...defaults };

  for (const field of GLOBAL_FILTER_FIELDS) {
    const value = raw[field.id];
    if (field.type === "date" && isValidISODate(value)) {
      next[field.id] = value;
    }
    if (field.type === "select") {
      const options = dynamicOptions[field.id] ?? field.options;
      if (options.some((opt) => opt.id === value)) {
        next[field.id] = value;
      }
    }
  }

  if (["daily", "weekly", "monthly", "wow", "mom"].includes(raw.timeWindow)) {
    next.timeWindow = raw.timeWindow;
  }

  next.dateRangeActive = raw.dateRangeActive === true;

  return next;
}
