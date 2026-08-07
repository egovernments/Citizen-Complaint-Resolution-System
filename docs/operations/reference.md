# Reference

Lookup tables for the other documents in this handbook: URLs, what each service does, what
breaks when it stops, retention, and a query cookbook.

← back to **[Operations handbook](README.md)**

---

## Contents

- [URLs](#urls)
- [The observability stack](#the-observability-stack)
- [Grafana dashboards](#grafana-dashboards)
- [What each service does](#what-each-service-does)
- [Metric and log coverage — what is and isn't watched](#metric-and-log-coverage--what-is-and-isnt-watched)
- [Data retention](#data-retention)
- [Query cookbook](#query-cookbook)
- [Glossary](#glossary)

---

## URLs

Replace `<your-domain>` with your deployment's domain.

| Path | What it is | Notes |
|---|---|---|
| `/` | Citizen / employee UI | |
| `/status/` | **Gatus health dashboard** | ~50 endpoint checks, 30s interval. `/gatus/` redirects here |
| `/grafana/` | **Grafana** | Metrics, logs, traces, alerting |
| `/configurator/` | Configurator (masters, branding, providers) | |
| `/citizen` | Citizen-facing entry point | |
| `/auth/` | Keycloak authentication | |
| `/novu/` | Notification platform admin | Only where notifications are enabled |

**Host ports** (not normally exposed publicly — nginx proxies them):

| Port | Service |
|---|---|
| 13000 | Grafana |
| 18889 | Gatus |
| 18000 | Kong gateway |
| 13100 | Loki |
| 13101 | MCP |
| 18080 | esbuild UI |
| 19000 | MinIO |

---

## The observability stack

```
   Java services ──OTLP──▶ otel-collector ──┬──▶ Prometheus  (metrics, 15d)
        (16 of them)                        └──▶ Tempo       (traces, 24h)

   ALL containers ──stdout──▶ promtail ──────▶ Loki        (logs, 72h)

   node-exporter ────────────────────────────▶ Prometheus  (host CPU/RAM/disk)
        (only on deployments from 2026-07-22 onward)

   Gatus ──HTTP/TCP probes──▶ every service    (health, in-memory)

   Grafana reads Prometheus + Loki + Tempo, and is where alerts are defined.
```

The consequence worth remembering: **metrics cover the Java services; logs cover
everything.** If a container has no metrics, that does not mean it is unmonitored — check
Gatus and Loki.

---

## Grafana dashboards

| Dashboard | URL | Use it for |
|---|---|---|
| **DIGIT JVM Services** | `/grafana/d/digit-jvm/` | Heap, restarts, OOM, GC, threads, JVM CPU |
| **DIGIT — Logs (Loki)** | `/grafana/d/digit-loki-logs/` | Error text, per-service log volume, free-text search |
| **DIGIT — Traces (Tempo)** | `/grafana/d/digit-tempo-traces/` | Slow requests, error traces, per-request waterfall |
| **Node Exporter Full** | `/grafana/d/node-exporter-full/` | Host CPU, RAM, disk, network — **empty unless node-exporter is installed** |

Panels worth knowing by name:

| Panel | Dashboard | Answers |
|---|---|---|
| Right-sizing snapshot | JVM | Which service is close to its heap limit |
| OOM events (current range) | JVM | Did anything run out of memory |
| Heap used (MB) — by service | JVM | Did anything crash and restart (line drops to zero) |
| GC pause time (s/s) | JVM | Is a service thrashing rather than working |
| Errors / Exceptions (current range) | Logs | How bad is it, right now |
| Log volume by service | Logs | Which service suddenly went quiet or loud |
| Slow traces — duration > 500ms | Traces | Which requests are slow, and where the time goes |
| Error traces (status = error) | Traces | Which requests failed |

---

## What each service does

Grouped as the health dashboard groups them.

### Infrastructure — everything depends on these

| Service | Role | When it's down |
|---|---|---|
| `postgres-db` | The database | Total outage. Nothing works |
| `pgbouncer` (alias `postgres`) | Connection pooler in front of Postgres | Services cannot get connections; looks like a total outage |
| `redis` | Cache and session store | Logins and cached lookups fail |
| `redpanda` | Kafka-compatible message broker | Writes still succeed, but indexing, notifications and persistence stall |
| `minio` | Object storage for complaint photos and documents | Uploads and attachment downloads fail |
| `elasticsearch` | Search index behind the inbox | Inbox and search break; filing complaints still works |

> `postgres` is a network alias for **PgBouncer**, not for the database. The database is
> `postgres-db`. Gatus checks both, so a dead database cannot hide behind a healthy pooler.

### Core platform

| Service | Role | When it's down |
|---|---|---|
| `egov-user` | User accounts, authentication | Nobody can log in |
| `keycloak` + `token-exchange-svc` | Identity provider | Login flows fail |
| `egov-workflow-v2` | Complaint state machine | Complaints cannot change state or be assigned |
| `egov-mdms-service` / `mdms-backend` | Master data (complaint types, departments, config) | Forms come up empty; most services fail to start |
| `egov-hrms` | Employees, departments, reporting hierarchy | Assignment and inbox visibility break |
| `boundary-service` / `egov-bndry-mgmnt` | Wards, localities, jurisdictions | Location pickers empty; inbox filtering breaks |
| `egov-localization` | UI translations | Screens show raw message codes |
| `egov-idgen` | Complaint number generation | New complaints cannot be created |
| `egov-accesscontrol` | Role/action authorisation | Users get "unauthorised" everywhere |
| `egov-enc-service` | Encryption of personal data | Reads/writes of protected fields fail |
| `egov-filestore` | File metadata in front of MinIO | Attachments fail |
| `egov-persister` | Kafka → Postgres writer | Complaints appear to save but never persist |
| `egov-indexer` | Kafka → Elasticsearch writer | Complaints exist but never appear in the inbox |
| `egov-url-shortening` | Short links in notifications | Links in SMS break |
| `audit-service` | Audit trail | Audit history stops recording |

### Application

| Service | Role | When it's down |
|---|---|---|
| `pgr-services` | The complaint service itself — filing, search, inbox, analytics | The core product is down |
| `digit-ui` | The web frontend | Blank or unreachable UI |
| `configurator` + `digit-config-service` | Admin configuration screens | Admins cannot change configuration; runtime unaffected |
| `inbox` | Aggregated inbox queries | Inbox screen fails; complaints still exist |
| `kong` | API gateway — every API call passes through it | 502s everywhere |

### Notifications

| Service | Role |
|---|---|
| `novu-api`, `novu-worker`, `novu-mongo`, `novu-ws` | Notification platform; `novu-worker` is what actually calls the SMS/email/WhatsApp provider |
| `novu-bridge` | Consumes complaint events from Kafka and triggers notifications |
| `digit-user-preferences-service` | Per-user notification consent |

If notifications stop, check in this order: the provider account (credit, credentials) →
`novu-worker` logs → `novu-bridge` logs → Kafka lag.

---

## Metric and log coverage — what is and isn't watched

| Signal | Covers | Does not cover |
|---|---|---|
| **JVM metrics** (Prometheus) | The 16 instrumented Java services: `boundary-service`, `digit-config-service`, `egov-accesscontrol`, `egov-enc-service`, `egov-filestore`, `egov-hrms`, `egov-idgen`, `egov-indexer`, `egov-persister`, `egov-user`, `egov-workflow-v2`, `inbox`, `mdms-backend`, `novu-bridge`, `pgr-services`, plus dashboard web metrics | Postgres, Redis, Kafka, Kong, Elasticsearch, Keycloak, MinIO, nginx, Node services |
| **Logs** (Loki) | **Every container** — around 44 of them | Nothing, as long as promtail is running |
| **Traces** (Tempo) | Requests through instrumented Java services and Kong | Direct database or broker activity |
| **Health checks** (Gatus) | ~50 endpoints across every group, including infrastructure | Anything not in the endpoint catalogue |
| **Host metrics** (node-exporter) | CPU, RAM, disk, network, filesystem | **Not present on deployments installed before 2026-07-22** |

The practical takeaway: for the non-Java containers, **Gatus tells you if it is alive and
Loki tells you why it isn't.** There are no metrics-based alerts to be had for them.

---

## Data retention

| Data | Store | Retention |
|---|---|---|
| Metrics | Prometheus | **15 days** |
| Logs | Loki | **72 hours** |
| Traces | Tempo | **24 hours** |
| Health-check history | Gatus | in-memory; lost when the container restarts |

Promtail also refuses log entries older than 7 days, so back-filling old logs is not
possible.

---

## Query cookbook

**Grafana → Explore**, then pick the datasource.

### Prometheus (metrics)

```promql
# Which services are reporting at all
count by (service_name) (jvm_thread_count)

# Which services were reporting 15 min ago and are not now  (i.e. something died)
count by (service_name) (jvm_thread_count offset 15m) unless count by (service_name) (jvm_thread_count)

# Heap usage % per service
100 * sum by (service_name) (jvm_memory_used_bytes{jvm_memory_type="heap"})
    / sum by (service_name) (jvm_memory_limit_bytes{jvm_memory_type="heap"})

# CPU per service (1.0 = one full core)
sum by (service_name) (jvm_cpu_recent_utilization_ratio)

# Garbage-collection time (>0.2 s/s means trouble)
sum by (service_name) (rate(jvm_gc_duration_seconds_sum[5m]))

# Server errors, by service and endpoint
sum by (service_name, http_route) (rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m]))

# 95th-percentile latency
histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket[5m])))

# Database connection pool
db_client_connections_pending_requests
db_client_connections_usage
db_client_connections_max
rate(db_client_connections_timeouts_total[5m])

# Kafka consumer lag
max by (service_name, client_id) (kafka_consumer_records_lag_max)

# Host metrics — only if node-exporter is installed
100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)
100 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"} * 100)

# Which scrape jobs exist (tells you whether node-exporter is present)
up
```

### Loki (logs)

Labels available: `compose_project`, `compose_service`, `container`, `service_name`,
`stream`.

```logql
# Error volume by service — run this first when everything feels wrong
sum by (compose_service) (count_over_time({compose_project="digit"} |~ `(?i)error|exception` [5m]))

# Everything erroring, most recent first
{compose_project="digit"} |~ `(?i)error|exception|timeout|refused`

# One service
{compose_service="pgr-services"} |~ `(?i)error|exception`

# Service starts — one line per boot; repeats mean a restart loop
{compose_project="digit", compose_service!="loki"} |~ `Started .+Application in`

# Genuine out-of-memory events (excluding tools that echo the search text)
{compose_project="digit", compose_service!~"grafana|loki"} |~ `(?i)outofmemoryerror|java heap space|gc overhead limit`

# Follow one complaint / user / request through every service
{compose_project="digit"} |= `<paste the identifier>`

# Database
{compose_service=~"postgres-db|pgbouncer"} |~ `(?i)fatal|error|too many clients|deadlock`

# Gateway / 502s
{compose_service="kong"} |~ `(?i)502|503|504|no route|upstream`

# Grafana's own alerting problems (why didn't my alert send?)
{compose_service="grafana"} |~ `(?i)alerting|notifier|contact|webhook|error`

# Log rate per service — a sudden spike or a drop to silence are both signals
sum by (compose_service) (rate({compose_project="digit"}[1m]))
```

### Tempo (traces)

```traceql
{ duration > 2s }
{ status = error }
{ resource.service.name = "pgr-services" && duration > 1s }
```

---

## Glossary

| Term | Meaning |
|---|---|
| **Container** | One running service. ~44 of them make up a deployment |
| **Compose / Docker Compose** | What starts and stops the containers on a single-server deployment |
| **Gatus** | The health dashboard at `/status/` |
| **Grafana** | The UI where metrics, logs, traces and alerts live |
| **Prometheus** | Stores numeric metrics; queried with PromQL |
| **Loki** | Stores logs; queried with LogQL |
| **Tempo** | Stores traces; queried with TraceQL |
| **Promtail** | Ships every container's output into Loki |
| **OTEL / OpenTelemetry** | The instrumentation standard; the collector receives metrics and traces from the Java services |
| **node-exporter** | Reports host CPU/RAM/disk to Prometheus |
| **Trace / Trace ID** | The record of one request as it passes through several services, and its identifier |
| **Heap** | The memory a Java service is allowed to use. Full heap → `OutOfMemoryError` → crash |
| **OOM** | Out of memory. Either the JVM hit its heap limit, or Linux killed the container |
| **GC** | Garbage collection. Excessive GC makes a service appear hung |
| **Kafka lag** | How far behind a consumer is. Growing lag = a stuck pipeline |
| **Connection pool** | The fixed set of database connections shared by a service. Exhaustion looks like "everything is slow but nothing is down" |
| **Tenant** | A city or administrative unit within the deployment |
| **MDMS** | Master Data Management Service — complaint types, departments, configuration |
| **PGR** | Public Grievance Redressal — the complaint service |
| **HRMS** | The employee, department and reporting-hierarchy service |
| **Pending period** | How long an alert condition must hold before the alert fires |
| **Contact point** | Where Grafana sends an alert (Slack, email, webhook…) |
| **Notification policy** | The rules deciding which alert goes to which contact point |
| **Silence / mute timing** | One-off vs. recurring suppression of notifications |
