# PGR Analytics Query API — Reference & Guide

A dynamic JSON→SQL query API for PGR complaint analytics. Dashboard KPIs are expressed as
**configuration** (a JSON query) rather than per-KPI code or hand-written materialized views:
every metric is a `WHERE … GROUP BY … + aggregate` over a small set of denormalized grains.

- **Add a KPI** = send a different JSON body. No deploy.
- **Closed grammar over an open catalog**: every identifier (table, column, function) is validated
  against the served schema; every literal is a bound parameter. The catalog is the validation layer
  *and* the SQL-injection defense.
- **Extend** = add a column to a grain + register it in the catalog → instantly queryable.

---

## 1. The three grains

All three are keyed on `service_request_id`. A query resolves to **exactly one** grain (the grains
have different denominators, so they are never blended into one result row).

| Grain | Type | One row represents | Answers |
|---|---|---|---|
| `complaint_facts` | materialized view | one **complaint** (snapshot + lifecycle rollup) | how many / how fast / what share |
| `complaint_events` | materialized view | one **workflow transition** | dwell-in-state, bottlenecks, transition matrix, per-officer holding time |
| `complaint_open_state_daily` | table (append-only) | one **open complaint per day** | backlog history, aging trend, sparklines |

The grain is usually inferred from the measure column (e.g. `resolution_ms` lives only on facts,
`dwell_ms` only on events). You may set `"grain"` explicitly to override.

---

## 2. Endpoints

```
POST /pgr-services/v2/analytics/_query    run a single query, or a batch dict of named queries
POST /pgr-services/v2/analytics/_schema   capabilities/catalog (for building a KPI editor dynamically)
```

Both accept a JSON body. `_query` returns the result set + metadata; `_schema` returns the
queryable grains, dimensions, measurable/distinct-countable columns, time-roles, and operators.

---

## 3. Request structure

**Single query**

```json
{
  "RequestInfo": { },
  "tenantId": "pb",
  "query": { /* …grammar… */ }
}
```

**Batch (dict of named queries)** — returns `results: { name → result }`, so a whole dashboard
panel fetches in one call, each measure-set labelled by the caller:

```json
{
  "RequestInfo": { },
  "tenantId": "pb",
  "queries": {
    "headline": { /* …grammar… */ },
    "by_ward":  { /* …grammar… */ }
  }
}
```

---

## 4. Grammar reference

A `query` object:

| Key | Meaning |
|---|---|
| `grain` | optional — `facts` \| `events` \| `daily`; inferred from measures if omitted |
| `measures` | **required** — array of measures (see below) |
| `dimensions` | array of group-by columns |
| `filters` | object of `column → predicate` |
| `window` | named time window + optional time-bucket / time-role |
| `sort` | array of `{ "by": <dimension|measure>, "dir": "asc"|"desc" }` |
| `limit` | integer (capped) |

### Measures

Each measure has a caller-supplied `name` (used as the result key — your custom label) and an `agg`:

| `agg` | needs | SQL |
|---|---|---|
| `count` | — (optional `filter`) | `count(*) [FILTER (WHERE …)]` |
| `count_distinct` | `column` | `count(DISTINCT column)` |
| `sum`/`avg`/`min`/`max` | `column` (numeric, optional `filter`) | `agg(column) [FILTER (WHERE …)]` |
| `percentile` | `column` (numeric), `p` in (0,100) | `percentile_cont(p/100) WITHIN GROUP (ORDER BY column)` |
| `ratio` | `numerator`, `denominator` (each `count`/`sum`, optional `filter`) | `round(num::numeric / NULLIF(den,0), 4)` |

> Use `percentile` (median/p90) rather than `avg` for durations — averages on time-to-resolve are
> skewed by outliers.

### Filters

`filters` is `{ column: predicate }`. A predicate is an object of operators (or a bare value =
shorthand for `eq`):

| Operator | Example |
|---|---|
| `eq` / `ne` | `{ "eq": "RESOLVED" }` |
| `gt`/`gte`/`lt`/`lte` | `{ "gte": 1719792000000 }` |
| `in` | `{ "in": ["web","mobile"] }` |
| `isnull` | `{ "isnull": false }` |
| `starts_with` / `subtree` | `{ "starts_with": "BOMET." }` / `{ "subtree": "SANITATION.SEWAGE" }` — allowed ONLY on the grain's prefix-filterable materialized-path columns (`boundary_path`, `complaint_node_path`). `subtree` is the delimiter-guarded form (`col = ? OR col LIKE ?\|\|'.%'`): the node itself plus dot-descendants, so `PGR` never matches a `PGRX` sibling |

UUID/PII-adjacent columns (e.g. `account_id`, `current_assignee_uuid`) are **group-by-able and
distinct-countable but not filterable** — arbitrary UUID probing is rejected.

### Window

```json
"window": { "name": "last_30d", "timeBucket": "month", "timeRole": "filed_at" }
```

- `name`: `all` | `live` | `last_<N>d` | `dtd` | `wtd` | `mtd` | `qtd` | `ytd` (computed in EAT/UTC+3).
  `dtd` is the **calendar** day ("today"); `last_1d` is a rolling 24h and drifts across midnight.
- `pinned`: `true` marks the window as the tile's own time axis — the `window` param and
  `dateFrom`/`dateTo` no longer rewrite it (see **Pinned windows** below). Default `false`,
  i.e. every existing def keeps letting the dashboard's range govern its time axis.
- `timeBucket`: `day` | `week` | `month` | `quarter` | `year` — adds a `bucket` group-by column.
- `timeRole`: a named time column for the grain (e.g. facts: `filed_at`, `resolved_at`;
  events: `event_at`; daily: `snapshot_date`). Defaults per grain.

### Pinned windows

A def that means a fixed period regardless of the dashboard's filters declares it on the window:

```json
"window": { "name": "dtd", "timeRole": "filed_at", "pinned": true }
```

"Complaints created today" is the motivating case (#1462): with the range filter applied it was
counting the **selected range**, so a month filter made it identical to "New complaints created";
with no range it fell back to a rolling 24h rather than the calendar day.

For a pinned window:

- the `window` param and `dateFrom`/`dateTo` do **not** rewrite the time predicate; a supplied
  `window` param comes back as `paramsIgnored: ["window"]` rather than being silently swallowed;
- if the selected range does not **cover** the pinned interval, the entry is **suppressed** — no SQL
  is run and the result is `{ rows: [], rowCount: 0, suppressed: "filter_excludes_window" }`.
  Coverage, not mere overlap: a partial intersection would report the tile's full pinned total under
  a filter that excludes part of that period;
- `compare: "prior"` means the preceding window of equal span (yesterday, for `dtd`) rather than the
  prior-equal-duration of the selected range;
- `series: "daily"` gets an axis **wider** than the pin — the selected range, else the `window` param,
  else a rolling `last_30d` — so the sparkline is a trend rather than a single bucket, and it stays
  answerable even when the headline value is suppressed;
- `ward` / `serviceCode` / `complaintPath` / `hierLevel` still apply: pinning fixes **time**, not filters;
- pinning a boundless window (`all` / `live`) is meaningless — there is no interval to cover and no
  preceding period — and is ignored: such a def takes the ordinary path.

The pinned window is resolved **once** per request and baked into explicit `gte`/`lt` bounds, so the
suppression verdict and the executed SQL are always judged against the same instant.

`suppressed` is a machine-readable reason code on the response, not a rendering: the dashboard
currently falls back to its existing unavailable state for such a tile. Wording the empty state
("No data available with applied filters") and distinguishing it from an ordinary zero is
[#1456](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1456), which this
reason code exists to give the frontend something to key off.

Unpinned defs — every other tile — are completely unchanged.

### `params` — kpiId-by-reference tuning knobs

Instead of an inline grammar body, a query node may reference a stored KPI definition and tune
it: `{ "kpiId": "<id>", "params": { … } }`. The server layers the params onto the def's baked
query (`KpiQueryComposer.mergeParams`); the param vocabulary is fixed (unknown names are
ignored) and every declared param with an `allowed` list is enforced server-side
(`invalid_param` when out of list):

| param | effect |
|---|---|
| `window` | overrides `query.window.name`, preserving `timeRole`/`timeBucket` — **ignored on a pinned window** |
| `dateFrom` + `dateTo` | inclusive ISO dates → half-open range on the grain's time column; removes the base window. **On a pinned window it does not rewrite the predicate** — it only decides whether the tile is answerable |
| `ward` | narrows `ward_code = ?` iff filterable on the grain |
| `serviceCode` | narrows `service_code = ?` iff filterable — the param for complaint-type **leaf** selections (exact match; works on every grain incl. daily) |
| `complaintPath` | narrows to a complaint-hierarchy **interior** node's whole subtree: a delimiter-guarded `subtree` predicate on `complaint_node_path` (`= ? OR LIKE ?\|\|'.%'`) iff the grain carries the path column (facts/events). Value = the node's dot-path (`SANITATION.SEWAGE`); validated against `[A-Za-z0-9._/-]` (max 256 chars) — anything else is `invalid_param`. On the daily grain (no path column) the filter cannot apply and the result envelope reports `paramsIgnored:["complaintPath"]` instead of silently serving unfiltered numbers. Leaf selections keep using `serviceCode`; NULL-path rows (node codes containing `.`, flat tenants) never match a subtree |
| `compare: "prior"` | immediately-preceding equal-duration range — "vs prior period" deltas |
| `series: "daily"` | scalar → daily time series — sparklines |
| `hierLevel` | `"leaf"` (no-op) or `"1"`..`"12"`: re-groups every `service_code` dimension by the Nth segment of the materialized `complaint_node_path` (#1111). The derived expression is a fixed server-side template aliased back `AS service_code` — result columns are unchanged, and aggregates recompute over raw rows (weighted). NULL/empty-path rows fall back to their leaf code; a level deeper than a row's depth clamps to its leaf; grains without the path column (daily) no-op. A `service_group` dimension is dropped at non-leaf levels (it duplicates the level bucket). Note: `avg(sla_target_ms)`-style measures average heterogeneous per-subtype SLAs inside a level bucket — indicative, not a category SLA |

Params can only narrow/re-group: the server-injected RBAC row-scope is layered on top by the
planner and is never widened. Full semantics + catalog cookbook:
`docs/dashboard-configuration.md`.

---

## 5. Response shape

```json
{
  "asOf": 1719820800000,
  "scope": { "tenantId": "pb", "level": "state" },
  "grain": "facts",
  "columns": ["ward_code", "open", "breached"],
  "rows": [ { "ward_code": "…", "open": 15, "breached": 15 } ],
  "rowCount": 1,
  "tookMs": 2
}
```

Batch responses wrap each query under `results.<name>` plus a top-level `partial` flag (one failed
query never blanks the others). `asOf` is the materialized-view refresh instant — data is as fresh
as the last refresh, not real-time. Durations are epoch-milliseconds.

When a supplied param could not be applied to the def's grain **and the caller must know**
(today: `complaintPath` on the path-less daily grain), the per-query result additionally carries
`"paramsIgnored": ["complaintPath"]` — the FE shows a "filter not applied" indicator instead of
presenting an unfiltered number as filtered. The field is absent when every param applied.

---

## 6. Scope, freshness & safety

- **RBAC scope is injected server-side** from `RequestInfo.userInfo` + `tenantId`, never the request
  body. Tenant scope is always applied (state-level → `LIKE` prefix, city-level → `=`); a pure
  citizen is locked to their own records; an employee jurisdiction (boundary subtree) is the
  documented extension point.
- **Authentication:** the endpoint *trusts* gateway-validated `userInfo` (standard DIGIT pattern) and
  does not itself verify a token. **Deploy it behind the API gateway's authentication** so `userInfo`
  is trustworthy; otherwise the citizen-self scope is spoofable. (Tracked as a limitation below.)
- **Injection-safe:** identifiers are whitelisted against the catalog, literals are bound parameters.
- **Freshness:** `complaint_facts`/`complaint_events` are materialized views and
  `complaint_open_state_daily` is appended once per day. Read `asOf` for the as-of time. **Note:** the
  refresh scheduler does not yet refresh the V2 grains (see Limitations) — they are populated at
  migration time and otherwise static until that wiring lands, so `asOf` may lag.

---

## 7. Ten sample KPIs

Each block is the `query` body (wrap in `{ "RequestInfo": {}, "tenantId": "<tenant>", "query": { … } }`,
or place several under `"queries"` for a single batch fetch).

### 1. Headline summary — total, open, closure rate, distinct citizens *(facts, batch dict)*
```json
{ "queries": {
  "headline": { "grain": "facts", "measures": [
    { "name": "total", "agg": "count" },
    { "name": "open", "agg": "count", "filter": { "is_open": true } },
    { "name": "closure_rate", "agg": "ratio",
      "numerator":   { "agg": "count", "filter": { "is_resolved": true } },
      "denominator": { "agg": "count" } },
    { "name": "citizens", "agg": "count_distinct", "column": "account_id" }
  ] }
} }
```

### 2. SLA breach rate *(facts, ratio)*
```json
{ "grain": "facts", "measures": [
  { "name": "breach_rate", "agg": "ratio",
    "numerator":   { "agg": "count", "filter": { "sla_breached": true } },
    "denominator": { "agg": "count" } }
] }
```

### 3. Open backlog by ward, worst first *(facts, group-by + filter + sort)*
```json
{ "grain": "facts", "dimensions": ["ward_code"],
  "measures": [
    { "name": "open", "agg": "count", "filter": { "is_open": true } },
    { "name": "breached", "agg": "count", "filter": { "sla_breached": true } } ],
  "sort": [ { "by": "breached", "dir": "desc" } ], "limit": 10 }
```

### 4. Time-to-resolve — median & p90 *(facts, percentile — not average)*
```json
{ "grain": "facts", "filters": { "is_resolved": true },
  "measures": [
    { "name": "median_ms", "agg": "percentile", "column": "resolution_ms", "p": 50 },
    { "name": "p90_ms",    "agg": "percentile", "column": "resolution_ms", "p": 90 } ] }
```

### 5. Complaint volume by category *(facts, group-by)*
```json
{ "grain": "facts", "dimensions": ["service_code"],
  "measures": [ { "name": "total", "agg": "count" } ],
  "sort": [ { "by": "total", "dir": "desc" } ], "limit": 15 }
```

### 6. Monthly inflow trend *(facts, time-bucket)*
```json
{ "grain": "facts",
  "window": { "name": "ytd", "timeBucket": "month", "timeRole": "filed_at" },
  "measures": [ { "name": "filed", "agg": "count" } ],
  "sort": [ { "by": "bucket", "dir": "asc" } ] }
```

### 7. Channel / source mix *(facts, group-by)*
```json
{ "grain": "facts", "dimensions": ["source"],
  "measures": [ { "name": "total", "agg": "count" } ],
  "sort": [ { "by": "total", "dir": "desc" } ] }
```

### 8. Bottleneck — dwell-in-state *(events, percentile by status)*
```json
{ "grain": "events", "dimensions": ["status"],
  "measures": [
    { "name": "median_dwell_ms", "agg": "percentile", "column": "dwell_ms", "p": 50 },
    { "name": "p90_dwell_ms",    "agg": "percentile", "column": "dwell_ms", "p": 90 },
    { "name": "n", "agg": "count" } ],
  "sort": [ { "by": "p90_dwell_ms", "dir": "desc" } ] }
```

### 9. Per-officer open load *(facts, group-by current owner)*
```json
{ "grain": "facts", "dimensions": ["current_assignee_uuid"],
  "filters": { "is_open": true },
  "measures": [
    { "name": "open_load", "agg": "count" },
    { "name": "breached", "agg": "count", "filter": { "sla_breached": true } },
    { "name": "avg_open_age_ms", "agg": "avg", "column": "open_age_ms" } ],
  "sort": [ { "by": "open_load", "dir": "desc" } ], "limit": 20 }
```
> Names are resolved at the edge — the API returns the UUID, never decrypted PII.

### 10. Backlog & aging trend over time *(daily, point-in-time history)*
```json
{ "grain": "daily", "dimensions": ["snapshot_date"],
  "measures": [
    { "name": "open", "agg": "count" },
    { "name": "breached", "agg": "count", "filter": { "sla_breached": true } } ],
  "sort": [ { "by": "snapshot_date", "dir": "asc" } ] }
```

**More variations** (same grammar): transition matrix
(`events`, `dimensions: ["previous_status","status"]`, `count` + `avg(dwell_ms)`);
escalation volume + timing (`facts`, `escalation_count`/`first_escalation_ms`);
new-vs-repeat complainants (`facts`, `is_first_time_complainant`);
hot-ward this week (`facts`, `window.name: last_7d`, group by `ward_code`).

---

## 8. Extending the catalog

To expose a new dimension or measure:
1. Add the column to the grain's materialized-view body (the migration).
2. Register it in the corresponding set in `AnalyticsCatalog` (`groupable` / `filterable` /
   `measurable` / `distinctable`).
3. It is immediately queryable and appears in `/_schema` — no grammar change, no new endpoint.

A new **grain** is added the same way (a table + a catalog entry); the grammar is grain-generic.

---

## 9. Limitations / not yet implemented

- **MV refresh scheduling** — the migration creates the grains `WITH DATA`, but the dashboard
  refresh scheduler (`DashboardRefreshScheduler.MV_NAMES`) does not yet include `complaint_facts`/
  `complaint_events`, and the daily `complaint_open_state_daily` snapshot insert is not yet wired.
  Until that follow-up, the V2 grains do not refresh and the daily backlog history does not
  accumulate — `asOf` reflects the migration-time (or last manual) refresh.
- **Authentication** — relies on gateway-injected `userInfo`; add the API gateway auth (or the
  standard DIGIT auth filter) so scope is non-spoofable.
- **Employee jurisdiction scope** — the boundary-subtree hook is wired but resolves to tenant-level
  for employees (full HRMS-jurisdiction resolution pending). Citizen-self scope is live.
- **Period-over-period delta** (WoW / MoM / YoY) — time-bucket series works; the lag-over-buckets
  delta layer is not yet implemented.
- **Saved KPI definitions** — queries are inline; a stored, versioned KPI-definition catalog
  (e.g. in MDMS) with a publish/validation pipeline is a follow-up.
- **Cross-grain results** — a multi-measure request spanning grains returns a grain-tagged batch;
  results from different grains are intentionally not merged into one row.
