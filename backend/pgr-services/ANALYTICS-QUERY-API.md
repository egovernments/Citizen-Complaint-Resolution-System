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

UUID/PII-adjacent columns (e.g. `account_id`, `current_assignee_uuid`) are **group-by-able and
distinct-countable but not filterable** — arbitrary UUID probing is rejected.

### Window

```json
"window": { "name": "last_30d", "timeBucket": "month", "timeRole": "filed_at" }
```

- `name`: `all` | `live` | `last_<N>d` | `wtd` | `mtd` | `qtd` | `ytd` (computed in EAT/UTC+3).
- `timeBucket`: `day` | `week` | `month` | `quarter` | `year` — adds a `bucket` group-by column.
- `timeRole`: a named time column for the grain (e.g. facts: `filed_at`, `resolved_at`;
  events: `event_at`; daily: `snapshot_date`). Defaults per grain.

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
- **Freshness:** facts/events are materialized views (refresh on a schedule); the daily table is
  appended once per day. Read `asOf` for the as-of time.

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
