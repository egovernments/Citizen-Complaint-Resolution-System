# 40 — The Global Filter Bar: Options, Persistence, "No Data"

The bar at the top of the dashboard (date range, geography/ward, complaint type) feeds the
`params` object sent with every `{kpiId, params}` tile query (see `10-kpi-catalog.md` §4 for how
params merge server-side).

FE anatomy:

- `frontend/micro-ui/web/src/dashboard/components/DashboardFilters.jsx` — the bar
- `frontend/micro-ui/web/src/dashboard/config/globalFilterGroups.js` — field definitions
  (`GLOBAL_FILTER_FIELDS`: dateFrom/dateTo/geography/complaintType), placeholder option lists,
  and the sanitizer
- `frontend/micro-ui/web/src/dashboard/config/dashboardFilters.js` — load/persist/reconcile
- `frontend/micro-ui/web/src/dashboard/hooks/useDashboardFilters.js` — the store
- `frontend/micro-ui/web/src/dashboard/hooks/useFilterOptions.js` — server-scoped option fetch
  *(changed in PR #1075 — new file; before it the bar showed only the static "All wards"/"All
  types" placeholders and `applyFilterOptions` was never invoked)*

## 1. Where the options come from — scoped distincts via `_query`

The ward and complaint-type dropdowns are populated from the **analytics API itself**, not from a
separate masters call. `useFilterOptions` runs one inline batch `POST /v2/analytics/_query`:

```js
complaintTypes: { grain: "facts", window: { name: "all" },
                  dimensions: ["service_code"], measures: [{ name: "n", agg: "count" }], limit: 300 }
wards:          { grain: "facts", window: { name: "all" },
                  dimensions: ["ward_code"], ... }
```

Because these run through the normal planner, the server-injected **ABAC row-scope applies to the
option lists too** (`20-packs-and-rbac.md` layer 1): a Water-department supervisor's complaint-type
dropdown contains only water types; a citizen-scoped caller only their own history's values. This
is intentional — the option list is itself scoped data. Blank-code rows are dropped, options are
label-sorted, and each list is prepended with its "all" sentinel. On failure the selects keep
their placeholder lists — the dashboard is never blocked on options. *(Changed in PR #1075.)*

**Labels**: option labels are derived from the code via the shared humanizer
(`frontend/micro-ui/web/src/dashboard/config/labelFormat.js` `formatDimensionLabel`), because
`ward_name` is not a groupable facts column. Complaint-type **labels and grouping** for tenants
running the N-level taxonomy come from `RAINMAKER-PGR.ComplaintHierarchy` (node `name`/`path`);
the dashboard FE does not read that master directly today — the grains bake its grouping in as
`service_group` / `complaint_node_path` (see `50-sla-and-hierarchies.md` §hierarchies), and the
humanizer covers display. TODO-verify once the #1079 grain columns land whether the filter bar
switches its type dropdown to hierarchy-grouped options (`ComplaintHierarchy` labels) or stays on
humanized codes.

## 2. How selections travel

`DashboardFilters` writes into `useDashboardFilters`; `AdminDashboard.jsx` translates the state
into per-tile params: `dateFrom`/`dateTo` (ISO dates), `ward` (geography id unless `all`),
`serviceCode` (complaint type id unless `all`). Server-side these can only **narrow** — RBAC
scope is layered on top by the planner. Two server behaviors worth knowing when a filter "does
nothing":

- A param is applied only if the grain can express it (`ward_code`/`service_code` filterable) —
  otherwise it is *silently skipped* for that tile (`KpiQueryComposer.applyEqFilter`).
- **Live open snapshots ignore the date range** by design (`is_open` + no base window = point-in-
  time metric; `KpiQueryComposer.isLiveOpenSnapshot`). "Open complaints" not shrinking when you
  narrow the dates is correct behavior.

## 3. Persistence and reconciliation against live options

Selections persist per-browser in localStorage (keys from
`config/dashboardConfig.js` `getFiltersStorageKey()` / `getSubMetricStorageKey()`).

On load, `loadDashboardFilters()` runs `sanitizeFilters(stored, dynamicOptions)`
(`globalFilterGroups.js`): each select keeps its stored value **only if it exists in the current
option list** (`fieldOptions.some(opt => opt.id === value)`), otherwise it resets to the field
default; dates must pass an ISO-date check. When the server-scoped options arrive,
`reconcileFiltersWithOptions(filters, filterOptions)` re-runs the sanitize and re-persists only
if something changed (`useDashboardFilters.js`). A `null`/absent options object deliberately does
**not** blank anything (guard in `sanitizeFilters`) — no options yet ≠ options are empty.

Net effect: a persisted ward that no longer exists — or that the *current* (differently-scoped)
user is not allowed to see — is silently reset to "All" instead of being sent as a dead param.
*(Effective end-to-end with PR #1075; before it, reconciliation only ran against the static
placeholder lists.)*

## 4. When an option "shows no data" — checklist

A user picks a ward/type and tiles go empty or show "No data" (`KpiTile` renders a
`kpi-tile--empty` placeholder per tile; tables render their `emptyMessage`; there is no global
banner — each widget degrades independently. The map now stays mounted and overlays its empty
state instead of unmounting Leaflet — *changed in PR #1076*).

Check in this order:

1. **Is it genuinely empty?** Run the tile's KPI by hand as the same user:
   `POST /v2/analytics/_query` with `{"queries":{"t":{"kpiId":"<id>","params":{"ward":"<code>"}}}}`.
   `rowCount: 0` with no `error` = real empty set.
2. **RBAC scope intersection.** The option list is scoped, but scope can still shrink between
   sessions (HRMS assignment changed). Check the response's `scope` object (`departments`,
   `restrictedTo`) — a department-scoped user filtering to a type outside their departments
   yields a legitimate empty intersection.
3. **Stale persisted filter.** If the selection isn't in the current dropdown at all, clear the
   dashboard's localStorage filter key (or the reconcile pass will fix it on next options load).
4. **Grain can't express the filter.** Tiles on grains where the column isn't filterable ignore
   the param (§2) — mixed dashboards can show some tiles narrowing and others not. That's
   per-design; check the def's grain.
5. **Data drift between the option source and the tile's grain.** Options come from `facts`;
   a `daily`-grain tile only has rows since the daily snapshots began accumulating. Early
   deployments have facts history but a short daily history.
6. **MV staleness.** Compare the response `asOf` with now — see `60-operations.md`. A complaint
   filed a minute ago is not in the grains until the next refresh cycle.
7. **The SLA column specifically**: blank SLA values on the Complaint Type Details table were
   the #1028 bug (SLA target only resolved from workflow config at the exact tenant). Fixed by
   the MDMS-first COALESCE in this PR — see `50-sla-and-hierarchies.md`. The table also covers
   all complaints (not week-to-date) since *PR #1074* removed its baked `wtd` window and its
   `window` param default.
