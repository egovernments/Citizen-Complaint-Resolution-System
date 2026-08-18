import { translate } from "../i18n/localeRuntime";
import {
  ALL,
  complaintMultiSelectionFromCode,
  normalizeComplaintTypeValue,
  repairSelection,
} from "../utils/complaintTypeTree";
import {
  geographyMultiSelectionFromCode,
  normalizeGeographyValue,
  repairGeographySelection,
} from "../utils/boundaryTree";
import {
  normalizeHierarchySelections,
  normalizeStringList,
} from "../utils/multiSelectFilters";
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  oneMonthEarlierYMD,
  zonedYMD,
} from "../utils/dashboardTimeZone";

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

export const DEPARTMENT_OPTIONS = [
  {
    id: "all",
    get label() {
      return translate("DASHBOARD_FILTERS_ALL_DEPARTMENTS", "All departments");
    },
  },
];

/**
 * Global dashboard filters — shared dimensions across KPIs and charts.
 * timeWindow is retained for volume KPI sub-metric resolution until date-range API wiring.
 *
 * The date fields carry NO computed defaultValue: a module-load `new Date()` would freeze
 * on whatever instant/browser-local zone the bundle first evaluated in, then silently
 * disagree with the resolved dashboard timeZone for the rest of the session. buildDefaultFilters(timeZone)
 * is the ONLY source of date defaults, computed fresh (zone-correct) every time it's called;
 * these placeholders exist solely so `.find(f => f.id === "dateFrom")`-style field lookups
 * (options, labels, type) stay valid without implying a usable date default.
 */
export const GLOBAL_FILTER_FIELDS = [
  {
    id: "dateFrom",
    type: "date",
    get label() {
      return translate("DASHBOARD_FILTERS_FROM", "From");
    },
    defaultValue: null,
  },
  {
    id: "dateTo",
    type: "date",
    get label() {
      return translate("DASHBOARD_FILTERS_TO", "To");
    },
    defaultValue: null,
  },
  {
    id: "geographies",
    type: "multi-select",
    get label() {
      return translate("DASHBOARD_FILTERS_GEOGRAPHY", "Geography");
    },
    defaultValue: [],
    options: GEOGRAPHY_OPTIONS,
  },
  {
    id: "complaintTypes",
    type: "multi-select",
    get label() {
      return translate("DASHBOARD_FILTERS_COMPLAINT_TYPE", "Complaint type");
    },
    defaultValue: [],
    options: COMPLAINT_TYPE_OPTIONS,
  },
  {
    id: "departments",
    type: "multi-select",
    get label() {
      return translate("DASHBOARD_FILTERS_DEPARTMENT", "Department");
    },
    defaultValue: [],
    options: DEPARTMENT_OPTIONS,
  },
];

/** @deprecated use GLOBAL_FILTER_FIELDS */
export const GLOBAL_FILTER_GROUPS = GLOBAL_FILTER_FIELDS.filter(
  (f) => f.type === "multi-select"
);

/**
 * `timeZone` should be an already-resolved zone (resolveConfiguredTimeZone
 * output); an invalid/missing value here falls back to DEFAULT_TIME_ZONE too,
 * so every caller — threaded or not — degrades the same way the backend does.
 */
export function buildDefaultFilters(timeZone) {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const now = new Date();
  const today = zonedYMD(now, zone);
  const monthAgo = oneMonthEarlierYMD(now, zone);
  const defaults = Object.fromEntries(
    GLOBAL_FILTER_FIELDS.map((field) => {
      if (field.id === "dateFrom") return [field.id, monthAgo];
      if (field.id === "dateTo") return [field.id, today];
      return [field.id, field.defaultValue];
    })
  );
  defaults.timeWindow = "weekly";
  defaults.dateRangeActive = true;
  return defaults;
}

export function hasActiveFilters(filters, timeZone) {
  if (!filters) return false;
  const defaults = buildDefaultFilters(timeZone);
  const geographies = normalizeHierarchySelections(
    filters.geographies ?? defaults.geographies
  );
  const complaintTypes = normalizeHierarchySelections(
    filters.complaintTypes ?? defaults.complaintTypes
  );
  const departments = normalizeStringList(
    filters.departments ?? defaults.departments
  );
  const dateFrom = filters.dateFrom ?? defaults.dateFrom;
  const dateTo = filters.dateTo ?? defaults.dateTo;
  const dateRangeActive = filters.dateRangeActive ?? defaults.dateRangeActive;

  return (
    dateRangeActive !== defaults.dateRangeActive ||
    dateFrom !== defaults.dateFrom ||
    dateTo !== defaults.dateTo ||
    geographies.length > 0 ||
    complaintTypes.length > 0 ||
    departments.length > 0
  );
}

function isValidISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function sanitizeFilters(raw, dynamicOptions = {}, timeZone) {
  const defaults = buildDefaultFilters(timeZone);
  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  // The `= {}` default only applies when the arg is `undefined`. Callers such as
  // persistDashboardFilters(filters, dynamicOptions) can pass `null` explicitly, which
  // slips past the default and makes `dynamicOptions[field.id]` throw on the first select
  // field ("geography") — blanking the dashboard on any date-filter change. Normalize it.
  const options =
    dynamicOptions && typeof dynamicOptions === "object" ? dynamicOptions : {};

  const next = { ...defaults };

  for (const field of GLOBAL_FILTER_FIELDS) {
    const value = raw[field.id];
    if (field.type === "date" && isValidISODate(value)) {
      next[field.id] = value;
    }
  }

  next.complaintTypes = sanitizeComplaintTypeSelections(raw, options);
  next.geographies = sanitizeGeographySelections(raw, options);
  next.departments = sanitizeFlatSelections(
    raw.departments,
    options.department
  );

  if (["daily", "weekly", "monthly", "wow", "mom"].includes(raw.timeWindow)) {
    next.timeWindow = raw.timeWindow;
  }

  next.dateRangeActive = raw.dateRangeActive === true;

  return next;
}

/**
 * Sanitize/repair the complaint-type selections. The v4 scalar trio
 * ({ complaintType, complaintTypePath, complaintTypeLeaf }) is accepted as a
 * one-release migration input; v5 persists self-describing selection arrays.
 *
 * - Pruned tree available (options.complaintTypeTree) — the authority:
 *   exact node wins; a vanished node walks UP its stored dot-path to the
 *   nearest surviving ancestor (repairSelection); nothing valid → cleared.
 * - Flat scoped option list only (tree fetch failed / flat tenant): leaf
 *   codes validate against the list exactly like before; interior selections
 *   can't be verified without a tree, so they are HELD as-is (never cleared)
 *   — a transient MDMS hiccup must not permanently forget a persisted subtree
 *   filter (persistDashboardFilters runs this sanitizer on every filter
 *   change, so a destructive clear here would outlive the hiccup). The trio
 *   is repaired-or-cleared by the tree branch on the next successful load.
 * - No dynamic options at all (initial localStorage load): trust the
 *   persisted trio and let reconcileFiltersWithOptions repair it when the
 *   tree arrives — clearing here would forget the selection on every reload.
 *
 * Geography follows the same rules on the
 * boundary tree (options.geographyTree as the authority; flat scoped ward
 * list validates leaves only, interior selections HELD through tree-fetch
 * hiccups; no options at all → trust the persisted trio).
 */
function legacyGeographySelections(raw) {
  if (Array.isArray(raw.geographies))
    return normalizeHierarchySelections(raw.geographies);
  const legacy = normalizeGeographyValue({
    code: raw.geography,
    path: raw.geographyPath,
    leaf: raw.geographyLeaf,
  });
  return legacy.code === ALL
    ? []
    : normalizeHierarchySelections({
        ...legacy,
        codes: legacy.leaf ? [legacy.code] : [],
      });
}

function legacyComplaintTypeSelections(raw) {
  if (Array.isArray(raw.complaintTypes))
    return normalizeHierarchySelections(raw.complaintTypes);
  const legacy = normalizeComplaintTypeValue({
    code: raw.complaintType,
    path: raw.complaintTypePath,
    leaf: raw.complaintTypeLeaf,
  });
  return legacy.code === ALL
    ? []
    : normalizeHierarchySelections({
        ...legacy,
        codes: legacy.leaf ? [legacy.code] : [],
      });
}

function sanitizeGeographySelections(raw, options) {
  const stored = legacyGeographySelections(raw);
  if (options.geographyTree) {
    return stored
      .map((selection) =>
        repairGeographySelection(options.geographyTree, selection)
      )
      .filter((selection) => selection.code !== ALL)
      .map((selection) =>
        geographyMultiSelectionFromCode(options.geographyTree, selection.code)
      )
      .filter(Boolean);
  }
  if (!options.geography) return stored;
  const valid = new Set(options.geography.map((option) => option.id));
  return stored.filter(
    (selection) => !selection.leaf || valid.has(selection.code)
  );
}

function sanitizeComplaintTypeSelections(raw, options) {
  const stored = legacyComplaintTypeSelections(raw);
  if (options.complaintTypeTree) {
    return stored
      .map((selection) => repairSelection(options.complaintTypeTree, selection))
      .filter((selection) => selection.code !== ALL)
      .map((selection) =>
        complaintMultiSelectionFromCode(
          options.complaintTypeTree,
          selection.code
        )
      )
      .filter(Boolean);
  }
  if (!options.complaintType) return stored;
  const valid = new Set(options.complaintType.map((option) => option.id));
  return stored.filter(
    (selection) => !selection.leaf || valid.has(selection.code)
  );
}

function sanitizeFlatSelections(raw, fieldOptions) {
  const stored = normalizeStringList(raw);
  if (!fieldOptions) return stored;
  const valid = new Set(fieldOptions.map((option) => option.id));
  return stored.filter((value) => valid.has(value));
}
