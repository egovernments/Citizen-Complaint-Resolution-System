import { translate } from "../i18n/localeRuntime";
import {
  clearedSelection,
  normalizeComplaintTypeValue,
  repairSelection,
} from "../utils/complaintTypeTree";

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

// Labels resolve lazily (getters call translate() at property-access time) so
// they react to language switches while keeping the flat {id,label} contract
// intact — useFilterOptions array-spreads these sentinel objects by reference,
// so the getters survive into the server-scoped option lists too.
export const GEOGRAPHY_OPTIONS = [
  {
    id: "all",
    get label() {
      return translate("DASHBOARD_FILTERS_ALL_WARDS", "All wards");
    },
  },
];

export const COMPLAINT_TYPE_OPTIONS = [
  {
    id: "all",
    get label() {
      return translate("DASHBOARD_FILTERS_ALL_TYPES", "All types");
    },
  },
];

/**
 * Global dashboard filters — shared dimensions across KPIs and charts.
 * timeWindow is retained for volume KPI sub-metric resolution until date-range API wiring.
 */
export const GLOBAL_FILTER_FIELDS = [
  {
    id: "dateFrom",
    type: "date",
    get label() {
      return translate("DASHBOARD_FILTERS_FROM", "From");
    },
    defaultValue: oneMonthAgoISO(),
  },
  {
    id: "dateTo",
    type: "date",
    get label() {
      return translate("DASHBOARD_FILTERS_TO", "To");
    },
    defaultValue: todayISO(),
  },
  {
    id: "geography",
    type: "select",
    get label() {
      return translate("DASHBOARD_FILTERS_GEOGRAPHY", "Geography");
    },
    defaultValue: "all",
    options: GEOGRAPHY_OPTIONS,
  },
  {
    id: "complaintType",
    type: "select",
    get label() {
      return translate("DASHBOARD_FILTERS_COMPLAINT_TYPE", "Complaint type");
    },
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
  // Tree-traversal complaint-type filter companions: `complaintType` stays the
  // selected node's code ("all" = cleared, back-compat with every consumer);
  // path + leaf make the persisted selection self-describing so the very first
  // batch (before the MDMS tree loads) already sends the right param shape
  // (leaf → serviceCode, interior → complaintPath).
  defaults.complaintTypePath = null;
  defaults.complaintTypeLeaf = false;
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
    dateRangeActive !== defaults.dateRangeActive ||
    dateFrom !== defaults.dateFrom ||
    dateTo !== defaults.dateTo ||
    geography !== defaults.geography ||
    complaintType !== defaults.complaintType
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

  // The `= {}` default only applies when the arg is `undefined`. Callers such as
  // persistDashboardFilters(filters, dynamicOptions) can pass `null` explicitly, which
  // slips past the default and makes `dynamicOptions[field.id]` throw on the first select
  // field ("geography") — blanking the dashboard on any date-filter change. Normalize it.
  const options = dynamicOptions && typeof dynamicOptions === "object" ? dynamicOptions : {};

  const next = { ...defaults };

  for (const field of GLOBAL_FILTER_FIELDS) {
    const value = raw[field.id];
    if (field.type === "date" && isValidISODate(value)) {
      next[field.id] = value;
    }
    // complaintType is a tree node, not a flat option — handled below.
    if (field.type === "select" && field.id !== "complaintType") {
      const fieldOptions = options[field.id] ?? field.options;
      if (fieldOptions.some((opt) => opt.id === value)) {
        next[field.id] = value;
      }
    }
  }

  Object.assign(next, sanitizeComplaintTypeSelection(raw, options));

  if (["daily", "weekly", "monthly", "wow", "mom"].includes(raw.timeWindow)) {
    next.timeWindow = raw.timeWindow;
  }

  next.dateRangeActive = raw.dateRangeActive === true;

  return next;
}

/**
 * Sanitize/repair the complaint-type node selection ({ complaintType,
 * complaintTypePath, complaintTypeLeaf }):
 *
 * - Pruned tree available (options.complaintTypeTree) — the authority:
 *   exact node wins; a vanished node walks UP its stored dot-path to the
 *   nearest surviving ancestor (repairSelection); nothing valid → cleared.
 * - Flat scoped option list only (tree fetch failed / flat tenant): leaf
 *   codes validate against the list exactly like before; interior selections
 *   can't be verified without a tree → cleared.
 * - No dynamic options at all (initial localStorage load): trust the
 *   persisted trio and let reconcileFiltersWithOptions repair it when the
 *   tree arrives — clearing here would forget the selection on every reload.
 */
function sanitizeComplaintTypeSelection(raw, options) {
  const stored = normalizeComplaintTypeValue({
    code: raw.complaintType,
    path: raw.complaintTypePath,
    leaf: raw.complaintTypeLeaf,
  });
  let selection = stored;

  if (options.complaintTypeTree) {
    selection = repairSelection(options.complaintTypeTree, stored);
  } else if (options.complaintType) {
    selection =
      stored.leaf && options.complaintType.some((opt) => opt.id === stored.code)
        ? stored
        : clearedSelection();
  }

  return {
    complaintType: selection.code,
    complaintTypePath: selection.path,
    complaintTypeLeaf: selection.leaf,
  };
}
