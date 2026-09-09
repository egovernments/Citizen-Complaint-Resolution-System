# Reference

Lookup tables for the other documents in this handbook: URLs, what each service does, what
breaks when it stops, what is and is not being watched, retention, and a query cookbook.

The dashboards themselves have their own page — **[dashboards.md](dashboards.md)**.

Written to be readable without prior knowledge of monitoring tools — where a term appears
for the first time it is explained, and the [glossary](#glossary) at the end collects them
all.

← back to **[Operations handbook](README.md)**

---

## Contents

- [URLs](#urls)
- [Credentials — who to ask](#credentials--who-to-ask)
- [The observability stack](#the-observability-stack)
- [Are the monitoring services important to keep up?](#are-the-monitoring-services-important-to-keep-up)
- [Grafana dashboards](#grafana-dashboards) — moved to [dashboards.md](dashboards.md)
- [The health dashboard's groups](#the-health-dashboards-groups)
  - [Why your dashboard has fewer groups](#why-your-dashboard-has-fewer-groups)
- [What each service does](#what-each-service-does)
- [Metric and log coverage — what is and isn't watched](#metric-and-log-coverage--what-is-and-isnt-watched)
- [Data retention](#data-retention)
- [Query cookbook](#query-cookbook)
- [Glossary](#glossary)

---

## URLs

Replace `<your-domain>` with your deployment's domain.

| Path | What it is | When you'd open it |
|---|---|---|
| `/digit-ui/employee` | **The staff app.** Where clerks, supervisors and grievance officers log in to see, assign and resolve complaints | **Most reported problems are here.** Open it first to reproduce what the caller is describing |
| `/digit-ui/citizen` | **The citizen app.** The public-facing site where a member of the public files a complaint and tracks it | When the report comes from a citizen, or is about filing / tracking rather than processing |
| `/status/` | **Health dashboard** (a tool called Gatus). Around 50 automated checks — one per service — re-run every 30 seconds. Green means the service answered, red means it did not | Every incident, first thing. It tells you in one screen whether something is actually down |
| `/grafana/` | **Grafana** — the window onto the system's own data: memory, logs, request timings, and alerts | When the health dashboard is all green but something is still wrong, and you need the error text |
| `/configurator/` | **Configurator** — admin screens for master data (complaint types, departments, localities), branding and notification providers | When a dropdown is missing an option, or something looks mis-configured rather than broken. Needs an admin login |
| `/novu/` | **Notification platform admin** — where SMS / email / WhatsApp delivery is set up and delivery attempts can be inspected | Only on deployments where notifications are enabled, and only for "the SMS never arrived" reports. Needs a login |

`/gatus` is an old address for the health dashboard and 301-redirects to `/status/`. Note
there is **no trailing slash** on the redirect: `/gatus/` returns a 404. Use `/status/`.

**Host ports.** Each service also listens on a port on the server itself. These are not
normally reachable from outside — the web server in front proxies the paths above to them.
You will only need this table if someone on the call refers to a port number.

| Port | Service | Reachable from |
|---|---|---|
| 13000 | Grafana | **loopback only** |
| 18889 | Gatus (health dashboard) | **loopback only** |
| 19090 | Prometheus (metric storage) | **loopback only** |
| 13100 | Loki (log storage) | **loopback only** |
| 13200 | Tempo (trace storage) | **loopback only** |
| 18100 | Kong status / metrics endpoint | **loopback only** |
| 18000 | Kong proxy (the API gateway every request passes through) | the network |
| 18001 | Kong admin API | the network |
| 13101 | MCP (integration tooling) | the network |
| 18080 | esbuild UI (the front-end build server) | the network |
| 19000 | MinIO (file/photo storage) | the network |

> **"Loopback only" means from the server itself, not from your desk.** Those ports are bound
> to `127.0.0.1` deliberately: Prometheus, Loki and Tempo have no authentication of their own,
> and Kong's status port exposes route names and per-route traffic counts unauthenticated. You
> reach all of them through Grafana at `/grafana/`, which does have a login. If someone asks
> you to open one of these ports to the network, raise it with us first.

---

## Credentials — who to ask

**The health dashboard at `/status/` needs no login.** Open the URL and you are in.

**Grafana does need one, and it should be an account of your own.**

A freshly deployed Grafana contains exactly **one** account, `admin`, whose password is
generated on the first deploy and stored in this deployment's OpenBao. That account belongs
to the **system administrator**. Self-registration is disabled (`allow_sign_up = false`), so
there is only one way for the service desk to get in: **the administrator creates a Grafana
account for each L1 and L2 person.** Ask for yours before your first incident rather than
during one.

**What to ask the administrator for**

| | |
|---|---|
| **A named account** — your own username, not the shared `admin` login | Named accounts show who ran which query, and one person changing a password does not lock out the desk |
| **The Editor role** | Grafana assigns new accounts **Viewer** by default, and a Viewer **cannot open Explore** — [Step 4 of first response](l1-first-response.md#step-4--what-does-the-log-say) and most of [L2 diagnosis](l2-diagnosis.md) need it |
| **The dashboard URLs**, if Grafana sits behind a VPN | You may also need to be added to the VPN |

Editor is a safe role to hand out here: it cannot add users, change passwords or edit
datasources, and **nothing in this handbook writes to the system** — Grafana only displays
data. An Editor *can* save changes to a dashboard (the provisioner sets
`allowUiUpdates: true`), so treat the nine shipped dashboards as read-only by convention: if
you want a different view, use **Explore**, or duplicate the dashboard rather than editing
it. They are provisioned from files on disk and re-read every 30 seconds, so a redeploy
overwrites your edits anyway.

Anonymous access is off unless the deployment explicitly turns it on, and even then it grants
**Viewer**, never Admin.

Anything else that asks for a username and password is **not** yours to obtain on your own:

| Needs credentials | Ask |
|---|---|
| **Grafana** (`/grafana/`) | Your system administrator — they create your named account and set it to **Editor**. The `admin` password stays with them |
| Notification platform admin (`/novu/`) | Your system administrator |
| The SMS / WhatsApp / email provider console | Your system administrator — it is usually held by whoever owns the provider contract |
| Configurator admin screens | Your system administrator |
| Server / SSH access | Not applicable to first-line work. This is L2's |

Two rules that do not bend:

- **Never share credentials in a ticket, an email or a chat message**, even internally. If a
  password is needed to progress, hand the task to whoever already holds it.
- **Never ask a caller for their password**, and never accept one if offered. You do not
  need it to investigate anything in this handbook.

---

## The observability stack

> **For L2.** This section explains *how* the monitoring data is collected and where it is
> stored. First-line work never needs it — if you are on the service desk, skip straight to
> **[dashboards.md](dashboards.md)**, which is about *reading* the data rather than plumbing
> it.

Prometheus collects from **five sources**. Four of them are separate exporters that know how
to read one specific piece of software; the fifth is the OpenTelemetry collector, which the
Java services push to.

```
   Java services ──OTLP──▶ otel-collector ──┬──▶ Prometheus  (metrics, 15d)
        (15 of them)                        ├──▶ Tempo       (traces, 24h)
                                            └──▶ Loki        (browser logs)

   The supervisor dashboard in the browser ──▶ otel-collector   (page-load timings)

   node-exporter ─────────scrape────────────▶ Prometheus  (host CPU/RAM/disk)
   postgres-exporter ─────scrape────────────▶ Prometheus  (database internals)
   redpanda:9644 ─────────scrape────────────▶ Prometheus  (broker + consumer lag)
   kong:8100 ─────────────scrape────────────▶ Prometheus  (gateway traffic + latency)

   ALL containers ──stdout──▶ promtail ──────▶ Loki        (logs, 72h)

   Gatus ──HTTP/TCP probes──▶ every service    (health, SQLite on disk)

   Grafana reads Prometheus + Loki + Tempo, and is where alerts are defined.
```

To see which of these are actually reporting on this deployment, run `up` in
**Grafana → Explore → Prometheus**. A healthy full stack answers with five jobs:
`otel-collector`, `node`, `postgres-exporter`, `redpanda` and `kong`.

Two consequences worth remembering:

- **Logs cover every container; metrics cover the Java services plus the four exporters.**
  A container with no metrics is not unmonitored — check Gatus and Loki.
- **The exporters are how the non-Java infrastructure became visible.** Postgres, the message
  broker and the gateway used to be pass/fail tiles on the health dashboard and nothing more.
  They now have real measurements — which is why "everything is slow but nothing is red" is a
  question you can answer.

---

## Are the monitoring services important to keep up?

Short answer: **none of them is citizen- or staff-facing.** If every one stopped at once,
citizens would still file complaints, clerks would still work them, and notifications would
still go out. Nothing anybody does in the product depends on these services.

What you lose is **visibility, not function** — and for most of them, data that cannot be
recovered afterwards.

| Service | What stops working if it goes down | Is data lost? |
|---|---|---|
| **gatus** | The health dashboard at `/status/` is unreachable — you lose the fastest "is anything down" check | **No** — history is on disk (SQLite) and survives the restart. Nothing is probed while it is down, so that window is simply blank |
| **grafana** | You cannot view *anything*: no dashboards, no logs, no metrics. Alert rules stop being evaluated too | **No.** Collection carries on regardless, and everything reappears when Grafana returns |
| **prometheus** | Nothing records measurements — memory, CPU, restarts, request timings | Yes — a permanent gap in the graphs covering the period it was down |
| **loki** | Log messages are not stored | **Yes, and this is the costly one.** Anything written while it is down is gone for good |
| **promtail** | Nothing ships logs into Loki, even though Loki itself is healthy | Yes — same effect as Loki being down |
| **tempo** | Request timings are not recorded | Yes — a gap in traces for that period |
| **otel-collector** | The Java services have nowhere to send metrics and traces, so both stop arriving | Yes — gaps in both metrics and traces |
| **node-exporter** | Machine statistics stop being reported, so the host dashboard goes blank | Yes — a gap in the CPU, memory and disk graphs |
| **postgres-exporter** | Database internals stop being reported, so the PostgreSQL dashboard goes blank. The database itself is completely unaffected | Yes — a gap in the database graphs |

**Why the data loss matters more than the downtime.** Logs, metrics and traces are a running
recording, not a query against something stored elsewhere. Nothing buffers them while the
receiver is away, and they cannot be back-filled later. A monitoring service that was down
for three hours leaves a three-hour hole that nobody can fill in afterwards.

**How to treat it in practice:**

- **On its own, a monitoring service being down is S3.** Nobody is blocked, nothing is broken
  for a citizen or a clerk, and it can wait for working hours.
- **While you are already handling an incident it matters much more**, because losing your
  visibility mid-outage costs you the evidence you need. Say so explicitly in the report —
  "Loki has been down since 09:00, so there are no logs for the window you are asking about"
  is essential context, not a footnote.
- **Restarting one is safe.** It does not touch the product and cannot affect a citizen or a
  clerk. It is L2's call, not first line's.

---

## Grafana dashboards

**Moved.** The dashboard guide — what each of the nine dashboards shows, which panels to
read, and what a reading means — is now its own page:
**[dashboards.md](dashboards.md)**.

It grew too large to sit inside a lookup file when the deployment went from four dashboards
to nine. Quick index:

| Dashboard | URL | Answers |
|---|---|---|
| DIGIT — Logs (Loki) | `/grafana/d/digit-loki-logs/` | What is the actual error? |
| DIGIT JVM Services | `/grafana/d/digit-jvm/` | Did something crash, restart or run out of memory? |
| Node Exporter Full | `/grafana/d/node-exporter-full/` | Is the server itself running out of something? |
| PostgreSQL Database | `/grafana/d/postgres-database/` | Is the database the bottleneck? |
| Kong API Gateway | `/grafana/d/kong-gateway/` | Is it the gateway, or the service behind it? |
| Redpanda (Kafka) Broker | `/grafana/d/redpanda-broker/` | Is the broker healthy, and does it have disk? |
| DIGIT Kafka Consumer Lag | `/grafana/d/kafka-consumer-lag/` | Which pipeline is stuck, and by how much? |
| DIGIT — Traces (Tempo) | `/grafana/d/digit-tempo-traces/` | Why was this slow, and which step took the time? |
| DIGIT — PGR Analytics Queries | `/grafana/d/pgr-analytics/` | Why is the supervisor dashboard slow? |

---

## The health dashboard's groups

The dashboard sorts its checks into **12 groups**. Which group a red tile sits in tells you
how serious it is before you know anything else about it, so read the group first and the
service name second.

The catalogue defines **57 checks**. You will usually see fewer, because most groups are
switched on or off to match what this deployment actually runs — see
[Why your dashboard has fewer groups](#why-your-dashboard-has-fewer-groups) below. The
groups are listed here worst-first, not in dashboard order.

| Group | Checks | What's in it | A red tile here means |
|---|---|---|---|
| **Infrastructure** | 5 | PostgreSQL, PgBouncer, Redis, Redpanda (Kafka), MinIO | **The most serious thing on the page.** Nothing above it can work — treat it as an outage and escalate immediately |
| **API Gateway** | 5 | Kong proxy, Kong admin, Kong status, and the user + workflow proxies. Every API request passes through here | Requests cannot be routed. Users see "502" or a blank screen |
| **Core Services** | 15 | The shared platform: MDMS and MDMS backend, user, workflow, HRMS, boundary and boundary-management, localization, ID generation, access control, encryption, filestore, URL shortening, the persister, and the audit service | A service many features depend on. Expect several unrelated-looking symptoms at once |
| **Application** | 3 | PGR services, the DIGIT UI, and the configurator | The product people actually use |
| **API Tests** | 3 | Real calls against live APIs — different from the rest, see below | Read the note below before acting on it |
| **Keycloak** | 3 | Keycloak, its Postgres, and the token exchange service. *Labelled `Keycloak` on the dashboard; this is the sign-in / identity group* | Signing in fails — but only on deployments that use Keycloak SSO rather than OTP login |
| **Search** | 3 | Elasticsearch, the indexer, the inbox service | Inbox and search break. Filing complaints still works |
| **OTP** | 3 | OTP service, user-OTP, notification-SMS — one-time-password delivery for sign-in | Users cannot receive the code they need to log in |
| **Notifications** | 9 | Novu (API, websocket, dashboard, Mongo), the bridge and its endpoint, the config and user-preferences services, and the OTP publisher | SMS / email / WhatsApp stop going out. Everything else is unaffected |
| **Observability** | 5 | Grafana, Prometheus, Loki, Tempo, the OTel collector | You lose visibility, not function. Nobody is blocked — see [Are the monitoring services important to keep up?](#are-the-monitoring-services-important-to-keep-up) |
| **MCP** | 2 | The MCP server and its Postgres — integration tooling | No effect on citizens or staff using the system |
| **Public Endpoint** | 1 | The TLS certificate on the public domain | The certificate is expiring or already invalid. Browsers will start refusing the site — act *before* it goes red if you can |

### Why your dashboard has fewer groups

Only **Infrastructure**, **Core Services**, **Application** and **API Tests** are always
present. Every other group is gated on a per-deployment toggle, so a group that is absent
usually means that feature was never deployed — not that something is broken:

| Group | Present when |
|---|---|
| Notifications | the Novu notification stack is deployed |
| Observability | the monitoring stack is deployed |
| Keycloak | Keycloak SSO is in use, rather than OTP login |
| Search | Elasticsearch / indexer / inbox are deployed |
| OTP | real OTP delivery is enabled, rather than the mocked local OTP |
| MCP | the MCP integration server is deployed |
| Public Endpoint | the deployment terminates TLS on a real domain |

A few individual checks are gated the same way — the audit service inside Core Services, the
configurator inside Application, and the two proxies inside API Gateway.

**Ask before you chase.** If a whole group has vanished since you last looked, that is a
deployment change, not an outage — raise it with us rather than debugging it.

**API Tests is the group worth understanding.** Every other group asks a service one simple
question — *are you alive?* — by calling its health endpoint. A service can answer that
perfectly while being completely unable to do any real work.

The API Tests group instead makes **genuine API calls**: searching for a tenant, generating a
complaint number, fetching a translated message. That gives it a different meaning:

- **Service tile green but API Tests tile red** — the service is running but cannot do its
  job. This is almost always a **data or configuration** problem rather than a crash, and it
  needs a completely different fix from restarting something.
- It is also the group most likely to catch a failure that every other check misses, because
  it is the only one exercising the real path.

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
| `egov-user` | User accounts and sign-in / identity | Nobody can log in |
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
| **JVM metrics** (via otel-collector) | The **15 instrumented Java services**: `boundary-service`, `digit-config-service`, `egov-accesscontrol`, `egov-enc-service`, `egov-filestore`, `egov-hrms`, `egov-idgen`, `egov-indexer`, `egov-persister`, `egov-user`, `egov-workflow-v2`, `inbox`, `mdms-backend`, `novu-bridge`, `pgr-services` | Every other container. The Node services, the sign-in service and `egov-localization` are not instrumented |
| **Database metrics** (postgres-exporter) | `postgres-db` — sessions, cache hit rate, locks, deadlocks, transactions, temp files, settings | PgBouncer, which is measured only by the pool metrics the Java services report |
| **Broker metrics** (redpanda) | The message broker, **and consumer lag for every consumer group** — including consumers with no Java instrumentation | — |
| **Gateway metrics** (kong) | Every API request through Kong: rate, status code, and latency split into Kong's own time versus the upstream service's | Requests that never reach Kong |
| **Browser metrics** (from the supervisor dashboard) | Real page-load timings in the user's browser: TTFB, first widget visible, all widgets ready, filter apply | Only produced while somebody has the dashboard open |
| **Logs** (Loki) | **Every container** — around 45 of them | Nothing, as long as promtail is running |
| **Traces** (Tempo) | Requests through instrumented Java services and Kong | Direct database or broker activity |
| **Health checks** (Gatus) | up to 57 endpoints across 12 groups, including infrastructure | Anything not in the endpoint catalogue; groups whose feature is switched off on this deployment |
| **Host metrics** (node-exporter) | CPU, RAM, disk, network, filesystem | **Not present on deployments installed before 2026-07-22** |

**Which infrastructure still has no metrics:** `redis`, `elasticsearch`, `minio` and the host
`nginx`. For those four, **Gatus tells you if it is alive and Loki tells you why it isn't** —
there are no metrics-based alerts to be had for them, and that is the whole coverage story.

That list used to be much longer. Postgres, the broker and the gateway were in it until their
exporters were added, so **treat any older note claiming "the database has no metrics" as out
of date** — run `up` and see for yourself.

---

## Data retention

Nothing here is kept for long. Knowing the numbers is what tells you whether a problem
reported today can still be investigated at all.

| Data | Store | Retention |
|---|---|---|
| Metrics | Prometheus | **15 days** |
| Logs — searchable, in Grafana | Loki | **72 hours (3 days)** |
| Traces | Tempo | **24 hours** |
| Health-check history | Gatus | on disk (SQLite), survives restarts; bounded per endpoint at ~100 results and ~50 events |
| Container logs — the raw files on the server | Docker, on disk | Capped by the Docker daemon at **10 files × 100 MB = 1 GB per container**, oldest rotated away first |

Two consequences worth knowing:

- **Promtail refuses log entries older than 7 days**, so old logs cannot be back-filled into
  Loki. If Loki missed something — because it was down, or because the message has aged out —
  it is missed permanently as far as Grafana is concerned.
- **The raw files on the server often outlast Loki's 72 hours.** For a busy service the 1 GB
  cap may hold less than three days; for a quiet one it may hold weeks. So when something has
  aged out of Grafana, L2 can sometimes still find it with `docker logs` on the box. It is
  the only remaining copy, and only until it rotates.

**These figures are deliberate** — short retention is what keeps the monitoring stack from
consuming disk. Changing any of them is a **deployment change**, not something to edit on the
server; anything edited there is overwritten on the next deploy.

| To change | Lives in |
|---|---|
| Loki's log retention | `retention_period` in `otel/loki-config.yaml` |
| Prometheus's metric retention | the `--storage.tsdb.retention.time` flag on the Prometheus container |
| Tempo's trace retention | `block_retention` in `otel/tempo-config.yaml` |
| Docker's per-container log cap | `log-opts` in `/etc/docker/daemon.json` |

Raise it with us if you need longer, and weigh the trade first: **longer retention means more
disk**, and a full disk is the most common cause of a complete outage.

---

## Query cookbook

**Grafana → Explore**, then pick the datasource.

> **Two results that look like a broken query but are not.**
>
> - **"No data"** on an error, deadlock, lag or timeout query means the count is genuinely
>   zero. On a healthy deployment most of the queries below return nothing, and that is the
>   answer you wanted.
> - **`NaN`** on a percentile (`histogram_quantile`) means no requests arrived in the window
>   being measured, so there is no distribution to take a percentile of. Widen the time range
>   rather than concluding the metric is broken.
>
> If you need to tell "zero" apart from "not being collected at all", run `up` — it names the
> five scrape jobs that should be reporting.

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

### Prometheus — the database (postgres-exporter)

`datname="egov"` is the application database; the exporter also reports on `postgres`,
`template0` and `template1`, which you can ignore.

```promql
# Is the exporter reaching the database at all? (1 = yes)
pg_up

# Sessions by state — active, idle, idle in transaction
sum by (state) (pg_stat_activity_count{datname="egov"})

# How close to the connection ceiling, as a percentage
100 * sum(pg_stat_activity_count{datname="egov"}) / on() group_left() pg_settings_max_connections

# Cache hit rate — healthy is above ~99%. A drop means reads are going to disk
100 * sum(pg_stat_database_blks_hit{datname="egov"})
    / (sum(pg_stat_database_blks_hit{datname="egov"}) + sum(pg_stat_database_blks_read{datname="egov"}))

# Deadlocks — should be flat zero. Anything else is a finding
rate(pg_stat_database_deadlocks{datname="egov"}[5m])

# Longest-running transaction, in seconds. A number that keeps growing is a stuck transaction
max(pg_stat_activity_max_tx_duration{datname="egov"})

# Connections held open mid-transaction — a leak in a service, not a database fault
sum(pg_stat_activity_count{datname="egov", state="idle in transaction"})

# Queries spilling to disk because they did not fit in memory
rate(pg_stat_database_temp_bytes{datname="egov"}[5m])

# Locks currently held
sum(pg_locks_count{datname="egov"})

# Rolled-back transactions — a rise means something is failing mid-write
rate(pg_stat_database_xact_rollback{datname="egov"}[5m])
```

### Prometheus — the message broker (redpanda)

```promql
# Disk left for messages. The broker stops accepting writes when this runs out
redpanda_storage_disk_free_bytes
100 * redpanda_storage_disk_free_bytes / redpanda_storage_disk_total_bytes

# The broker's own verdict: 0 = OK, 1 = low space, 2 = degraded
redpanda_storage_disk_free_space_alert

# Partitions with no working copy — anything above 0 is data unavailable
redpanda_cluster_unavailable_partitions

# How many workers are attached to each pipeline. 0 = nothing is processing that queue
redpanda_kafka_consumer_group_consumers

# Broker-side consumer lag, per group. Covers every consumer, instrumented or not
sum by (redpanda_group) (
  max by (redpanda_namespace, redpanda_topic, redpanda_partition) (
    redpanda_kafka_max_offset{redpanda_namespace="kafka"}
  )
  - on(redpanda_topic, redpanda_partition) group_right()
  redpanda_kafka_consumer_group_committed_offset
)
```

### Prometheus — the gateway (kong)

```promql
# Request rate by HTTP status code across the whole gateway
sum by (code) (rate(kong_http_requests_total[5m]))

# Which service behind the gateway is returning server errors
sum by (service) (rate(kong_http_requests_total{code=~"5.."}[5m]))

# How long the service behind the gateway took (usually where the time goes)
histogram_quantile(0.95, sum by (le, service) (rate(kong_upstream_latency_ms_bucket[5m])))

# How long Kong itself took — routing, auth, plugins. Normally a small number
histogram_quantile(0.95, sum by (le) (rate(kong_kong_latency_ms_bucket[5m])))

# Can Kong reach its own configuration store? (1 = yes)
kong_datastore_reachable
```

### Prometheus — the supervisor dashboard

```promql
# Which analytics measurement is slow, by KPI
histogram_quantile(0.95, sum by (kpi_id, le) (rate(pgr_analytics_query_duration_ms_bucket[5m])))

# How much data each measurement is reading
sum by (kpi_id) (rate(pgr_analytics_query_rows_total[5m]))

# What the browser actually experienced — only while somebody has the dashboard open
histogram_quantile(0.95, sum by (le) (rate(dashboard_all_widgets_ready_ms_bucket[5m])))
```

### Loki (logs)

Labels available: `compose_project`, `compose_service`, `container`, `exporter`, `job`,
`level`, `service_name`, `stream`. The two you will use are `compose_service` (which
container) and `level` (`ERROR`, `WARN`, `INFO`).

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
