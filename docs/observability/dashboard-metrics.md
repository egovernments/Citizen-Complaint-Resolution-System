# Dashboard render-lag metrics (issue #1110 — PR1, client side)

Production instrumentation for the supervisor dashboard
(`digit-ui-esbuild/products/dashboard/`). A dependency-free ~4KB module
(`products/dashboard/src/services/dashboardMetrics.js`) measures the load
lifecycle in the browser and ships hand-rolled OTLP/HTTP **JSON** to the
existing otel-collector through a same-origin Kong route:

```
browser ──POST /otel/v1/metrics──▶ Kong ──▶ otel-collector:4318 ──deltatocumulative──▶ prometheus exporter :8889 ──▶ Prometheus
        ──POST /otel/v1/logs────▶ Kong ──▶ otel-collector:4318 ──▶ Loki
        ──traceparent on API calls──▶ Kong otel plugin + pgr javaagent ──▶ Tempo
```

## Metrics

All names surface from the collector's prometheus exporter with dots → underscores
(histograms add `_bucket`/`_sum`/`_count`, monotonic sums add `_total`). The
emitter deliberately sets **no OTLP `unit`** — the names already carry their unit
(`.ms`/`.bytes`/`.count`, exactly as the #1110 table) and the exporter would
otherwise append a unit suffix (validated live: `unit:"ms"` scraped as
`dashboard_..._ms_milliseconds_*`).

| OTLP name | Type | Prometheus name | What it measures |
|---|---|---|---|
| `dashboard.ttfb.ms` | histogram | `dashboard_ttfb_ms_*` | Navigation TTFB (`navigationEntry.responseStart`). **Hard navigations only** — absent on in-app (soft) navs. |
| `dashboard.first_widget_visible.ms` | histogram | `dashboard_first_widget_visible_ms_*` | t0 → first tile painting non-skeleton content (post-paint, double-rAF). Fires on the error / "No data" paint path too, so failed loads still measure. |
| `dashboard.all_widgets_ready.ms` | histogram | `dashboard_all_widgets_ready_ms_*` | t0 → the analytics batch settling + paint. The dashboard resolves ALL widgets in one `/pgr-services/v2/analytics/_query` batch today, so this ≈ first_widget_visible; both are kept so the metrics survive a per-widget fetch refactor. |
| `dashboard.filter_apply.ms` | histogram | `dashboard_filter_apply_ms_*` | Filter interaction → re-queried batch settled + painted (interaction window, below). |
| `dashboard.persona_switch.ms` | histogram | `dashboard_persona_switch_ms_*` | Same window for a persona change. **Expected ~empty**: no in-app persona switch exists — a persona change today is a re-login, i.e. a fresh load with a different `persona` tag. |
| `dashboard.slow_api_calls.count` | sum (counter) | `dashboard_slow_api_calls_count_total` | Dashboard API calls (analytics / boundary-service / MDMS) taking > 2000 ms inside the load window. |
| `dashboard.transfer.bytes` | sum (counter) | `dashboard_transfer_bytes_total` | Σ resource-timing `transferSize` of those calls in the load window. **Ticket-name alias**: the #1110 table calls this `total_payload.bytes`; renamed because `transferSize` is network transfer *including headers* and reads **0 on cache/service-worker hits** — "transfer" is the honest name. |
| `dashboard.error_widgets.count` | sum (counter) | `dashboard_error_widgets_count_total` | Errored tiles at load settle. Companion refs (`__prior`/`__series`/`__pins`) collapse to their base kpiId so one broken tile counts once; a whole-batch failure counts every laid-out tile. |

Histogram bucket bounds (ms), agreed with #1109:

```
[250, 500, 1000, 2000, 3000, 5000, 8000, 13000, 21000]
```

All datapoints use **delta temporality** (browsers are ephemeral emitters); the
collector's `deltatocumulative` processor accumulates them for the prometheus
exporter.

### Tags (datapoint attributes)

Per D6 the OTLP *resource* carries only `service.name=dashboard-web`
(`resource_to_telemetry_conversion` is on — per-session resource attributes
would explode Prometheus label cardinality). Every variable tag is a
**datapoint attribute**:

| Tag | Values | Source |
|---|---|---|
| `tenant` | tenant code | `globalConfigs STATE_LEVEL_TENANT_ID` |
| `persona` | role code / `other` | The matched pack's role from `/packs` (PR2); until then the first caller role present in `DASHBOARD_ROLES` (array order — deterministic, mirrors the BE first-match). |
| `layout_id` | pack id, `+custom` suffix, `unknown` | Pack `packId` from `/packs` (PR2; `unknown` until then). `+custom` when the persisted local layout override exists. **Coarse on purpose**: the storage key (`ccrs.dashboard.catalog-layout.v1`) is global — not per-pack/tenant/user — so `+custom` means "this browser has *a* saved layout", not "this pack was customised". |
| `record_count_tier` | `lt10k` / `10k-50k` / `50k-100k` / `gt100k` / `unknown` | `recordCount` from `/packs` (PR2; `unknown` until then). Describes the **tenant corpus size**, not the caller's ABAC-visible subset. |
| `ua_family` | Edge / Chrome / Firefox / Safari / Other, `+mobile` suffix | UA regex |
| `nav_type` | `hard` / `soft` | Hard = the browser navigation landed directly on `/employee/dashboard` (t0 = navigation start). Soft = in-app route change (t0 = dashboard mount). **Soft-nav t0 excludes the pre-mount `Module.js` localization-gate wait** — the host chrome shows a loader while locale bundles land, and the dashboard cannot observe that span. |

## Interaction windows (filter_apply / persona_switch)

State machine (review round R6):

1. A filter change / persona-relevant refetch records a **pending intent**
   (timestamped; repeated interactions reset the timestamp — measured from the
   *last* user action).
2. The window **opens** only when the batch effect actually issues a new
   request while an intent is pending. An intent unconsumed for **5 s** expires
   silently (e.g. re-selecting "all" — refsKey unchanged, nothing re-queries,
   nothing is recorded).
3. The window **closes** on batch settle **for the same request id** (the
   component's staleness guard is respected), post-paint. Superseded batches
   discard their window; a **30 s** absolute expiry discards dangling windows.

## Flush cadence & delivery

- **Quiesce flush** ~2 s after the load settles (lets buffered resource-timing
  entries land): load histograms + counters + the `dashboard.load` log record.
- **Interaction flush**, debounced 5 s after each closed interaction window.
- **60 s periodic flush** while dirty (long-lived tabs).
- **pagehide backstop** via `navigator.sendBeacon` (JSON `Blob`).

Each flush sends **two separate OTLP payloads**: `resourceMetrics` →
`POST /otel/v1/metrics` and `resourceLogs` → `POST /otel/v1/logs` (never a
combined body). Primary transport is `fetch({keepalive:true})`.

Failure policy: every failed POST logs a `console.warn` (config errors stay
visible even when invisible in metrics). A **4xx** (route missing / auth
misconfig) mutes the session after ONE failure; network errors / 5xx back off
1 s / 10 s / 60 s and mute after **3 consecutive** failures, attempting a
best-effort `dashboard.metrics.selfmute` log record first. On installs without
the observability stack the cost is ≤ 3 failed POSTs per page load.

## Trace correlation

`beginLoad()` mints a 128-bit trace id per dashboard load. The dashboard's own
fetch call sites — `analyticsService`, `boundaryService`,
`complaintHierarchyService` — attach:

```
traceparent: 00-<traceId>-<freshSpanId>-01     (W3C)
x-trace-id:  <traceId>                          (ticket's literal contract / agent-less installs)
```

Kong's `opentelemetry` plugin (`header_type: w3c`) and the pgr-services
javaagent continue the browser's trace id end-to-end, so the load's API calls
land in Tempo under it with zero backend plumbing. **Scope**: only those three
dashboard services carry the headers; other digit-ui traffic is out of scope.

### Finding a load: Prometheus → Loki → Tempo

p50/p95/p99 of all-widgets-ready over 15 min:

```promql
histogram_quantile(0.50, sum(rate(dashboard_all_widgets_ready_ms_bucket[15m])) by (le))
histogram_quantile(0.95, sum(rate(dashboard_all_widgets_ready_ms_bucket[15m])) by (le))
histogram_quantile(0.99, sum(rate(dashboard_all_widgets_ready_ms_bucket[15m])) by (le, tenant, persona))
```

Slow-call and error rates:

```promql
sum(rate(dashboard_slow_api_calls_count_total[1h])) by (tenant)
sum(rate(dashboard_error_widgets_count_total[1h])) by (tenant, persona)
```

Per-load drill-down in Loki (Grafana → Explore → Loki) — the collector's loki
exporter maps `service.name` to the `job` label:

```logql
{job="dashboard-web"} |= "dashboard.load"
{job="dashboard-web"} |= "dashboard.interaction"
```

Each `dashboard.load` record carries `trace_id` plus all metric values and
tags for that load. Pivot to Tempo by that trace id (Grafana → Explore →
Tempo → TraceQL `<trace_id>`) to see the load's API calls as spans
(Kong → pgr-services → JDBC).

## Feature gate & rollback

Gate key: `DASHBOARD_METRICS_ENABLED` (globalConfigs), **default ON** —
disabled only when explicitly `false`. Build-time override:
`REACT_APP_DASHBOARD_METRICS=true|false` (esbuild define; empty = defer to the
runtime gate). OTLP ingest base: `REACT_APP_OTEL_BASE` (default `/otel`).

Kill switch (no rebuild):

- **Deployed boxes (ansible)**: set `dashboard_metrics_enabled: false` in the
  tenant's host_vars and re-render `globalConfigs.js` (the nightly redeploy
  also picks it up). The rendered file must never be edited directly.
- **Local compose**: flip `dashboardMetricsEnabled` in
  `local-setup/nginx/globalConfigs.js`.
- Reverting the Kong route alone also works: the emitter warns and self-mutes.

## Performance budget

< 50 ms per load (ticket AC); actual cost is a handful of `performance.now()`
calls and Map writes during the load window — the PerformanceObserver
subscription and flush machinery defer to `requestIdleCallback`
(`setTimeout` fallback on Safari), serialization is a single
`JSON.stringify` per flush, and the module adds zero dependencies to the
bundle.

## Scope notes

- **Server-metric scope correction (D14)**: this dashboard feeds exclusively
  from `pgr-services /v2/analytics/_query|/packs|/catalog/_search` (+
  boundary-service geojson and one MDMS master). The ticket's minimum set
  (PGR `_search`, MDMS, DSS) is stale for this dashboard; PR2 instruments the
  analytics endpoints. MDMS/boundary durations are already visible as
  javaagent spans. Acked by the issue owner on #1110.
- **Map-tile paint excluded from `all_widgets_ready`** (batch-settle + paint
  definition, keeps #1109 comparability); the async geojson/boundary fetches
  still count toward `slow_api_calls`/`transfer.bytes` when they land inside
  the load window. Acked by the issue owner on #1110.
- Ad/privacy blockers may block `/otel/v1/metrics` (path contains "metrics") —
  acceptable for office-machine supervisors.
- Non-goals (PR1): Grafana boards/alerts (follow-up issue), citizen UI, the
  legacy `frontend/micro-ui` dashboard, any RUM beyond the metrics above.
