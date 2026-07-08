# 10 — The KPI Catalog: `dss.KpiDefinition`

Every tile on the supervisor dashboard is a **KpiDefinition** record in MDMS (module `dss`,
master `KpiDefinition`). The backend loads them at the **state-root tenant** (a city tenantId is
collapsed to its root before the MDMS lookup — `KpiCatalogService.getVisibleDefs` →
`MultiStateInstanceUtil.getStateLevelTenant`), so definitions are authored once per state root
(e.g. `ke`), never per city.

- Live seed example: `ansible/nairobi-mdms/mdms/dss/KpiDefinition.json` (28 defs on `ke`)
- Loader: `backend/pgr-services/src/main/java/org/egov/pgr/analytics/KpiCatalogService.java`
- POJO / accepted fields: `backend/pgr-services/src/main/java/org/egov/pgr/analytics/model/KpiDefinition.java`
- Query grammar reference (authoritative): `backend/pgr-services/ANALYTICS-QUERY-API.md`

Adding, changing, or retiring a KPI is an **MDMS edit — no rebuild, no deploy**.

## 1. Anatomy of a definition

```jsonc
{
  "tenantId": "ke",                       // state root; MDMS record wrapper
  "data": {
    "id": "cl_resolution_rate_count",     // stable id — referenced by packs, layout, FE refs
    "version": "1.0.0",                   // informational; passed through to the FE (see §6)
    "status": "published",                // lifecycle gate (see §5)
    "query": { ... },                     // the baked analytics query (see §2), or null for compose defs
    "supportsSeries": true,               // FE hint: tile can be re-rendered as a daily series
    "viz": { ... },                       // how the FE renders it (see §3)
    "params": [ ... ],                    // caller-tunable knobs + allow-lists + defaults (see §4)
    "rbac": { "visibleTo": ["PUBLIC"] }   // role ceiling — see 20-packs-and-rbac.md
  }
}
```

## 2. The `query` block — grammar essentials

The full grammar lives in `backend/pgr-services/ANALYTICS-QUERY-API.md`; this is the operator's
summary. A query targets **exactly one grain**:

| grain | table/MV | one row is | typical measures |
|---|---|---|---|
| `facts` | `complaint_facts` | one complaint | counts, rates, `resolution_ms`, `sla_target_ms` |
| `events` | `complaint_events` | one workflow transition | `dwell_ms`, bottlenecks, transition matrix |
| `daily` | `complaint_open_state_daily` | one open complaint per day | backlog history, sparklines |

If `grain` is omitted it is inferred from the measure columns (events-only columns like
`dwell_ms` → `events`; otherwise `facts`) — set it explicitly in defs.

**Measures** — each has a caller-chosen `name` (becomes the result column) and an `agg`:
`count` (optional `filter`), `count_distinct` (needs `column`), `sum`/`avg`/`min`/`max`
(numeric `column`, optional `filter`), `percentile` (`column` + `p` in (0,100) — prefer
median/p90 over `avg` for durations), and `ratio`:

```json
{ "name": "pct", "agg": "ratio",
  "numerator":   { "agg": "count", "filter": { "is_resolved": true } },
  "denominator": { "agg": "count" } }
```

Ratio sides support `count`/`sum`, each with its own `filter`; the planner emits
`round(num::numeric / NULLIF(den,0), 4)` — **ratios come back as a 0..1 fraction**, and the FE
`percent*` formats expect that.

**Filters** — `{ column: predicate }` where a predicate is a bare value (shorthand `eq`) or an
operator object: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `isnull`. Every column must be in
the grain's `filterable` whitelist (`AnalyticsCatalog.java`); UUID/PII-adjacent columns
(`account_id`, `current_assignee_uuid`, …) are deliberately **not** filterable.

**Window + timeRoles**:

```json
"window": { "name": "last_30d", "timeBucket": "month", "timeRole": "filed_at" }
```

- `name`: `all` | `live` | `last_<N>d` | `wtd` | `mtd` | `qtd` | `ytd` (computed in the dashboard
  zone, Africa/Nairobi UTC+3 — `AnalyticsPlanner.EAT`).
- `timeRole`: a *named* time axis per grain — facts: `filed_at` (→ `created_at`) and
  `resolved_at`; events: `event_at` (→ `entered_at`); daily: `snapshot_date`. Free-form time
  columns are rejected. The timeRole also steers which column a global date-range narrows
  (`KpiQueryComposer.dateFilterColumn`): a facts def carrying `timeRole:"resolved_at"` gets its
  date range applied to `resolved_at`.
- `timeBucket`: `day|week|month|quarter|year` — adds a grouped `bucket` column.

**Sort / limit** — `sort` entries must reference a selected dimension or measure name;
`limit` is capped at 1000 (`AnalyticsPlanner.MAX_LIMIT`).

**Live-open-snapshot semantics** (matters when authoring "open now" tiles): a query with
`filters.is_open: true`, a non-daily grain and **no base window** is treated as a point-in-time
snapshot — the server deliberately does *not* narrow it by the global window/date-range params
(`KpiQueryComposer.isLiveOpenSnapshot`). Give an open-metric a window if you want it
time-bounded.

## 3. The `viz` block — rendering contract

The FE render engine is `frontend/micro-ui/web/src/dashboard/components/KpiTile.jsx`
(`renderByKind`). Every `viz.kind` it dispatches:

| `viz.kind` (aliases) | renders as | key extra fields |
|---|---|---|
| `scalar`, `number-tile`, `number-tile-delta` | KPI number card with optional delta | `valueKey`, `format`, `priorKey`, `delta {mode, compare}`, `deltaLabel`, `threshold` |
| `number-tile-sparkline`, `sparkline-card` | number card + mini trend | + `dateKey`, `sparklineMeasureKey`, `seriesColor` |
| `bar`, `bar-chart` | vertical bar chart | `dimensionKey`, `measureKeys`, `colors`, `categoryOrder` |
| `histogram` | vertical bars, insertion order kept | same as bar |
| `horizontal-bar` | horizontal bars | same as bar |
| `stacked-bar` | stacked bars | `stackSeries` / stack keys |
| `pie`, `pie-chart` | pie/donut | `dimensionKey`, `measureKey` |
| `line`, `line-chart` | time-series line | `dateKey`, `measureKeys` |
| `sla-risk-table` | the complaints-at-risk table | `columns` |
| `choropleth-map`, `map` | ward choropleth / pin map | see `GeographyChoroplethMap.jsx` |
| `ranked-list`, `rankedList` | ranked list | — |
| `dow`, `day-of-week` | day-of-week profile | — |
| `table`, `data-table`, *anything else* | generic data table (the **default** fallback) | `columns` |

First-class `viz` fields on the BE POJO: `kind`, `format`, `valueKey`, `accent`, `group`,
`titleKey`, `dimensionKey`, `measureKeys`, `variants`, `compose`, `pii`. **Anything else is
passed through verbatim** (`KpiDefinition.KpiViz.extra`, `@JsonAnySetter`) — `threshold`,
`delta`, `dateKey`, `sparklineMeasureKey`, `seriesColor`, `contextLabel`, `deltaLabel`,
`colors`, `stackSeries`, `columns`, `title`, … — so new FE viz options need **no backend
schema change**, only a KpiTile capability.

**Titles / localization**: the FE currently prefers the human `viz.title` string
(`KpiTile.resolveTitle`); `viz.titleKey` (convention `RAINMAKER-PGR.DASHBOARD_KPI_<ID>`) is
retained for a future i18n layer and is only ever *prettified* as a last-resort fallback, never
rendered verbatim. Ship both: `title` for today, `titleKey` so the def is i18n-ready.

**Thresholds** color the card by value: `viz.threshold = { kind: "percent"|..., higherIsBetter,
onTrack, breaching }` — percent thresholds are in display units (e.g. `onTrack: 70`) while the
ratio value is 0..1; KpiTile normalizes.

**Backend-composed defs**: a def with `query: null` plus
`viz.compose = { type, sourceKpiIds: [...], elapsedFromAsOf? }` is computed server-side from
other KPIs' results (`AnalyticsService.maybeComposeResult`). Supported ops:
`dailyAvgFromWeekly`, `hourlyAvgFromDaily`, `openRateComplement`, `netBacklogDaily`.
Source KPIs are resolved with the caller's RBAC and the same params.

## 4. `params` — the caller-tunable knobs

```json
"params": [
  { "name": "window", "default": "last_7d",
    "allowed": ["last_1d","last_7d","last_30d","wtd","mtd"] }
]
```

The dashboard sends `{ kpiId, params }` and the server layers the params onto the baked query
(`KpiQueryComposer.mergeParams`). Supported param names (fixed vocabulary — anything else is
ignored):

| param | effect |
|---|---|
| `window` | overrides `query.window.name`, preserving `timeRole`/`timeBucket` |
| `dateFrom` + `dateTo` | inclusive ISO dates → half-open `gte`/`lt` range on the grain's time column; removes the base window. Unparseable values are a hard `invalid_param`, not a silent fallback |
| `ward` | narrows `ward_code = ?` iff filterable on the grain |
| `serviceCode` | narrows `service_code = ?` iff filterable |
| `compare: "prior"` | immediately-preceding equal-duration range (prior calendar week when no range is set) — powers "vs prior period" deltas |
| `series: "daily"` | scalar → daily time series (adds the grain's date dimension + asc sort, caps limit at min(366, days)) — powers sparklines |

Rules enforced server-side:

- **`allowed` list** (C1): a requested `window` outside the def's `allowed` list is rejected
  with `invalid_param` — it is never silently honoured.
- **`default`** is applied **server-side** for any declared param the caller omitted, with
  precedence *explicit caller param > declared default > the def's baked query*
  (`AnalyticsService.withDeclaredDefaults`). A bare `{ "kpiId": "..." }` reference therefore
  behaves like the dashboard's default filter state. *(Changed in this PR — the #1026
  params-default fix; previously a declared `default` was documentation-only.)*
- Params can only **narrow**: the server-injected RBAC row-scope is layered on top by the
  planner and is never widened by params.

Design consequence: a KPI that should cover *all time* by default (e.g. the Complaint Type
Details table) must **not** declare a `window` default — with the server-side default fix, a
declared default now actually applies. *(Changed in this PR: `cl_table_complaint_type_details`
dropped its `last_7d` default for exactly this reason — issue #1028 / PR #1074 context.)*

## 5. Status lifecycle

`status` is a free string; the server serves a def **only when `status == "published"`**
(`KpiDefinition.isPublished`). Anything else (`draft`, `retired`, …) is invisible to `/packs`,
`/catalog/_search` and unresolvable via `kpiId` (callers get `kpi_forbidden`). So:

- **draft** → author with `status: "draft"`, flip to `published` when ready (MDMS `_update`).
- **retire** → flip status away from `published` (mdms-v2 has no `_delete`; you can also set the
  MDMS record `isActive: false`).

## 6. Versioning

`version` is a semver-style string carried on the def and echoed to the FE in `/packs` /
`/catalog/_search` tile descriptors (`AnalyticsController.safeTile`). The server attaches **no
semantics** to it today — no side-by-side versions, no negotiation. Treat it as a change marker:
bump it whenever `query`/`viz` changes shape so FE caches and humans can tell defs apart.

## 7. Cookbook — add a new KPI end-to-end

Goal: a "Complaints via WhatsApp (last 30d)" number card for supervisors.

1. **Author the def** (validate the query first by POSTing it inline to
   `/pgr-services/v2/analytics/_query` as an admin):

   ```json
   {
     "id": "cl_whatsapp_count",
     "version": "1.0.0",
     "status": "published",
     "query": {
       "grain": "facts",
       "measures": [ { "name": "total", "agg": "count" } ],
       "filters": { "source": "whatsapp" },
       "window": { "name": "last_30d" }
     },
     "viz": {
       "kind": "number-tile-delta",
       "format": "number",
       "valueKey": "total",
       "accent": "blue",
       "group": "complaint-landscape",
       "title": "WhatsApp complaints",
       "titleKey": "RAINMAKER-PGR.DASHBOARD_KPI_CL_WHATSAPP_COUNT",
       "delta": { "compare": "prior" },
       "deltaLabel": "vs prior period"
     },
     "params": [ { "name": "window", "default": "last_30d",
                   "allowed": ["last_7d","last_30d","mtd"] } ],
     "rbac": { "visibleTo": ["SUPERVISOR","PGR_SUPERVISOR","PGR_ADMIN"] }
   }
   ```

2. **Set the role ceiling** — `rbac.visibleTo` (see `20-packs-and-rbac.md` §visibleTo for the
   exact semantics of `[]` and `PUBLIC`).

3. **Upsert to MDMS** at the state root (`dss` / `KpiDefinition`, tenant `ke`) via
   mdms-v2 `_create`/`_update`. In git-driven deployments also add it to the seed file
   (`ansible/nairobi-mdms/mdms/dss/KpiDefinition.json`) so a redeploy doesn't lose it.

4. **Optionally add it to a pack** so it appears in the default layout: append the id to
   `tiles` and a `{kpiId,x,y,w,h}` entry to `layout` in `dss.DashboardPack`
   (see `20-packs-and-rbac.md`). Without a pack entry the KPI is still available in the
   dashboard's Add-KPI picker (served by `/catalog/_search`) for any role that passes
   `visibleTo`.

5. **Title/localization** — `viz.title` renders today; if/when the i18n layer lands, add the
   `titleKey` message to the localization store (module upsert + cache flush — see
   `30-view-access.md` for the localization cache-bust procedure).

6. **Verify**: `POST /v2/analytics/catalog/_search` as the target role should list the tile;
   `POST /v2/analytics/_query` with `{"queries":{"t":{"kpiId":"cl_whatsapp_count"}}}` should
   return rows. No service restart is involved anywhere in this flow.
