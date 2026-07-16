# Dashboard metrics — server side (#1110, PR2)

> **Merge note:** PR1 of #1110 introduces `docs/observability/dashboard-metrics.md`
> (client-side metrics, delivery path, feature gate). This file is the **server section**
> of that page, kept separate only to avoid cross-PR conflicts — fold it into
> `dashboard-metrics.md` once both PRs have landed.

## What the server emits

`pgr-services` measures every analytics SQL execution behind
`POST /pgr-services/v2/analytics/_query` — each **batch entry**, each **single query**,
and each **SOURCE query of a backend-composed KPI** (composed KPIs like
`dailyAvgFromWeekly` run 1..n source queries; each records its own point, attributed to
its own `kpi_id`).

Instrumentation is `io.opentelemetry:opentelemetry-api` over `GlobalOpenTelemetry`
(no micrometer/actuator). The OTEL **javaagent** the deploy stack attaches
(`JAVA_TOOL_OPTIONS: -javaagent:...`, `OTEL_METRICS_EXPORTER: otlp`,
`OTEL_SERVICE_NAME: pgr-services`) bridges it to its SDK and exports OTLP to the
collector, which Prometheus scrapes on `otel-collector:8889`. **Without the agent every
call is a no-op** — no config change, no compose change, safe in tests/CI.

## Metric names as scraped (Prometheus)

| OTLP instrument | Prometheus series | Type |
|---|---|---|
| `pgr.analytics.query.duration.ms` | `pgr_analytics_query_duration_ms_bucket` / `_sum` / `_count` | histogram |
| `pgr.analytics.query.rows` | `pgr_analytics_query_rows_total` | counter |

Labels on both: `kpi_id` (the KPI id, or `inline` for inline-grammar queries), `grain`
(`facts`/`events`/`daily`/`compose` never appears — sources record their real grain),
`tenant` (the request tenantId). Resource attributes (`service.name="pgr-services"` →
`job`) come from the agent; `resource_to_telemetry_conversion` is enabled on the
collector's prometheus exporter.

Example queries:

```promql
# p95 duration per KPI over 15m
histogram_quantile(0.95,
  sum by (kpi_id, le) (rate(pgr_analytics_query_duration_ms_bucket[15m])))

# slowest KPIs by mean duration
topk(5, sum by (kpi_id) (rate(pgr_analytics_query_duration_ms_sum[15m]))
      / sum by (kpi_id) (rate(pgr_analytics_query_duration_ms_count[15m])))
```

## Per-request slow-query log (Loki)

After every `_query` request, pgr-services logs **one** structured line with the top-3
slowest executed queries of that request (errored entries never execute, so they are
excluded — they have no `tookMs`):

```
analytics.slow_queries traceId=<32-hex-or-header-or--> tenant=<t> total=<n> top=[{name=..., kpiId=..., tookMs=..., rowCount=...}, ...]
```

Promtail ships all container stdout to Loki. Query:

```logql
{compose_service="pgr-services"} |= "analytics.slow_queries"
# only slow loads:
{compose_service="pgr-services"} |= "analytics.slow_queries" | pattern "<_>tookMs=<took>,<_>" | took > 2000
```

## Trace correlation recipe

The trace id in the log line is resolved in this order:

1. **Active span's trace id** — Kong runs the `opentelemetry` plugin (`header_type: w3c`)
   and pgr-services runs the javaagent, so the browser's `traceparent` (PR1 emits one per
   dashboard load) is continued end-to-end. This is the normal case.
2. The literal **`x-trace-id` request header** — fallback for agent-less deployments
   (the `_query` handler accepts it as an optional header; it changes no behaviour).
3. `-` when neither exists.

To go from "the dashboard felt slow" to the exact query:

1. **Prometheus** — find the offending aggregate (p95 spike on
   `pgr_analytics_query_duration_ms` for a `kpi_id`/`tenant`).
2. **Loki** — find affected loads: the FE's `dashboard.load` record (PR1) and the
   server's `analytics.slow_queries` line carry the **same trace id** for one dashboard
   load. Grep either, copy `traceId`.
3. **Tempo** — search that trace id: the full span tree (Kong → pgr-services → JDBC
   spans from the agent's auto-instrumentation) shows exactly where the time went.

## `/packs` additions (`packId`, `persona`, `recordCount`)

`POST /v2/analytics/packs` now returns three additive fields (the FE reads them
defensively; older clients ignore them):

- **`packId`** — the matched `DashboardPack.id`, the FE's `layout_id` tag. `null` when no
  pack matched.
- **`persona`** — the role that made the pack match: the first role in the **pack's**
  declared `roles` list that the caller holds (the server's actual `matchesRoles`
  decision, deterministic in pack order). The FE prefers this over its client-side
  derivation for the `persona` tag.
- **`recordCount`** — the **tenant corpus** size of `complaint_facts`, computed with the
  planner's tenant scope semantics: state-level tenant → `tenant_id LIKE 'ke%'`, city
  tenant → exact match. Cached in-memory for 5 minutes per tenant; `null` on error
  (never fails the response).

  **Semantics — read this:** `recordCount` is the **tenant's data volume**, deliberately
  **NOT the caller's ABAC-visible subset** (department/citizen/boundary scope is not
  applied). It feeds the `record_count_tier` metric tag, which must give render-lag
  comparisons a shared denominator across personas — a department-scoped officer on a
  100k-row tenant is in the `gt100k` tier even if they can see 2k rows. Do not use it as
  a "rows you can query" indicator.

## Validation cheat-sheet

```bash
# metrics appear within one scrape interval of a _query
curl -s http://otel-collector:8889/metrics | grep pgr_analytics_query_duration_ms_count

# slow-query line with a propagated trace id
curl -s -X POST https://<host>/pgr-services/v2/analytics/_query \
  -H 'Content-Type: application/json' -H 'x-trace-id: cafebabecafebabecafebabecafebabe' \
  -d '{"tenantId":"ke","queries":{"open":{"kpiId":"<a PUBLIC kpiId>"}}}'
docker logs pgr-services 2>&1 | grep analytics.slow_queries | tail -1
```
