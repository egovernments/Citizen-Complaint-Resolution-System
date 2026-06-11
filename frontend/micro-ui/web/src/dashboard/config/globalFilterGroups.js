import { TIME_WINDOW_OPTIONS } from "./complaintLandscape";

/**
 * Shared dashboard-wide filters only — dimensions that apply across multiple KPIs.
 * Per-metric view variants (channel slice, TTR avg vs median, etc.) use the
 * per-card view selector instead.
 */
export const GLOBAL_FILTER_GROUPS = [
  {
    id: "timeWindow",
    label: "Time window",
    defaultValue: "weekly",
    options: TIME_WINDOW_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
  },
];

export const GLOBAL_FILTER_GROUP_BY_ID = Object.fromEntries(
  GLOBAL_FILTER_GROUPS.map((group) => [group.id, group])
);

export function buildDefaultFilters() {
  return Object.fromEntries(
    GLOBAL_FILTER_GROUPS.map((group) => [group.id, group.defaultValue])
  );
}

export function sanitizeFilters(raw) {
  const defaults = buildDefaultFilters();
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const next = { ...defaults };
  for (const group of GLOBAL_FILTER_GROUPS) {
    const value = raw[group.id];
    if (group.options.some((opt) => opt.id === value)) {
      next[group.id] = value;
    }
  }
  return next;
}
