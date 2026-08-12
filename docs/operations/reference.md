# Reference

Lookup tables for the other documents in this handbook: URLs, what the dashboards show and
what the readings mean, what each service does, what breaks when it stops, retention, and a
query cookbook.

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
- [Grafana dashboards — what each one shows](#grafana-dashboards--what-each-one-shows)
- [The health dashboard's groups](#the-health-dashboards-groups)
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

`/gatus/` is an old address for the health dashboard and redirects to `/status/`.

**Host ports.** Each service also listens on a port on the server itself. These are not
normally reachable from outside — the web server in front proxies the paths above to them.
You will only need this table if someone on the call refers to a port number.

| Port | Service |
|---|---|
| 13000 | Grafana |
| 18889 | Gatus (health dashboard) |
| 18000 | Kong (the API gateway every request passes through) |
| 13100 | Loki (log storage) |
| 13101 | MCP (integration tooling) |
| 18080 | esbuild UI (the front-end build server) |
| 19000 | MinIO (file/photo storage) |

---

## Credentials — who to ask

**Grafana and the health dashboard need no login.** On these deployments they are open to
anyone who has the URL, so you can start work immediately. Nothing you do on either page
changes the system — they only display data.

Anything else that asks for a username and password is **not** yours to obtain on your own:

| Needs credentials | Ask |
|---|---|
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
> [Grafana dashboards](#grafana-dashboards--what-each-one-shows), which is about *reading*
> the data rather than plumbing it.

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

## Are the monitoring services important to keep up?

Short answer: **none of them is citizen- or staff-facing.** If every one stopped at once,
citizens would still file complaints, clerks would still work them, and notifications would
still go out. Nothing anybody does in the product depends on these services.

What you lose is **visibility, not function** — and for most of them, data that cannot be
recovered afterwards.

| Service | What stops working if it goes down | Is data lost? |
|---|---|---|
| **gatus** | The health dashboard at `/status/` is unreachable — you lose the fastest "is anything down" check | Yes — its history is held in memory only, so the record of what was red is gone |
| **grafana** | You cannot view *anything*: no dashboards, no logs, no metrics. Alert rules stop being evaluated too | **No.** Collection carries on regardless, and everything reappears when Grafana returns |
| **prometheus** | Nothing records measurements — memory, CPU, restarts, request timings | Yes — a permanent gap in the graphs covering the period it was down |
| **loki** | Log messages are not stored | **Yes, and this is the costly one.** Anything written while it is down is gone for good |
| **promtail** | Nothing ships logs into Loki, even though Loki itself is healthy | Yes — same effect as Loki being down |
| **tempo** | Request timings are not recorded | Yes — a gap in traces for that period |
| **otel-collector** | The Java services have nowhere to send metrics and traces, so both stop arriving | Yes — gaps in both metrics and traces |
| **node-exporter** | Machine statistics stop being reported, so the host dashboard goes blank | Yes — a gap in the CPU, memory and disk graphs |

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

## Grafana dashboards — what each one shows

### First, the words you will see on every screen

Grafana is one website showing several different collections of data. A few terms recur, and
knowing them makes every dashboard readable:

| Term | What it means |
|---|---|
| **Dashboard** | One page of charts about one subject. You pick it from the menu or open it by URL |
| **Panel** | One box on that page — a single chart, number or table. Each panel answers one question |
| **Time range** | **Top right of every dashboard.** Everything on the page describes the window you choose here — "Last 6 hours", "Last 24 hours", or a specific start and end. **Getting this right matters more than anything else**: if the problem happened at 09:15 and your range is "Last 5 minutes", every panel will look perfectly healthy |
| **Datasource** | Where a panel's numbers come from. Three exist: **Prometheus** (measurements over time), **Loki** (log messages), **Tempo** (request timings). You rarely pick one on a dashboard; you do in Explore |
| **Explore** | A menu item in the left sidebar. A blank page where you pick a datasource and run one query, instead of viewing a pre-built dashboard. Used when this handbook gives you a query to paste |
| **Refresh** | Dashboards do not update by themselves unless set to. Use the refresh icon beside the time range if you are watching something live |

**Panel shapes**, because the same data looks different depending on the shape:

| Shape | Looks like | Read it as |
|---|---|---|
| **Stat** | One big number | A total or current value for the whole time range. Fast to read, no detail |
| **Timeseries** | A line graph, time along the bottom | How something changed. One coloured line per service, named in the legend |
| **Table** | Rows and columns | One row per service, several values side by side. Best for comparing services |
| **Logs** | Scrolling text lines with timestamps | The actual messages the software wrote |

**Jargon that appears in the panel names themselves:**

- **JVM** — the Java runtime. Most services here are Java programs, and each runs inside its
  own JVM.
- **Heap** — the pool of memory a Java service is allowed to use for its work. Every service
  is given a fixed ceiling. Normal behaviour is for heap use to rise and fall repeatedly.
- **OOM ("out of memory")** — the service needed more memory than its heap ceiling allowed
  and **crashed**. Not a slowdown; a stop.
- **GC ("garbage collection")** — the JVM periodically clears out memory it no longer needs.
  This is routine and constant. It only matters when a service spends so much time doing it
  that it has little time left to serve requests — then it *looks* frozen while technically
  alive.
- **Thread** — one unit of work happening inside a service. Many run at once.
- **Trace** — the complete record of one request as it travelled through several services,
  showing how long each step took.

---

### DIGIT JVM Services — `/grafana/d/digit-jvm/`

**What it is:** the memory and health of the Java services, one line or row per service.

**The question it answers:** *did something crash, restart, or run out of memory — and
when?*

**Who uses it:** L1 reads two panels from it (see
[l1-first-response.md](l1-first-response.md)). L2 uses the rest.

| Panel | Shape | What it shows and what the reading means |
|---|---|---|
| **OOM events (current range)** | Stat | A count of out-of-memory crashes in your chosen time range. **`0` is the healthy answer.** Anything above `0` means a service ran out of memory and crashed during that window. This is the single easiest panel on the dashboard to read |
| **Incidents — OOM / heap-space errors (last range)** | Logs | The actual crash messages behind the number above, naming the service. If the stat panel is above zero, this is where you copy the evidence from |
| **Right-sizing snapshot — heap profile per service (heap, MB)** | Table | One row per service: memory in use now, its peak in the last hour, and its ceiling. The **headroom** column is the useful one — the percentage of its allowance still free. Low headroom means the service is close to crashing. This is a capacity judgement, so it is L2's to act on |
| **Heap used (MB) — by service** | Timeseries | Memory in use over time, one line per service. A healthy line **rises and falls repeatedly** — that is normal. A line that **drops to zero and then climbs again from the bottom** is a service that crashed and restarted at that moment. Reading this correctly needs to know what that service normally looks like, so it is L2's panel |
| **Heap committed vs used (MB) — by service** | Timeseries | Two lines per service: memory reserved versus actually used. When "used" sits right against "committed" for a long time, the service is under real pressure |
| **JVM CPU — recent utilization (ratio)** | Timeseries | How much processor each service is consuming. **`1.0` means one whole CPU core.** `0.05` is idle chatter. A service sitting high with no users on the system is stuck in a loop |
| **GC pause time (s/s)** | Timeseries | Seconds per second spent on garbage collection. `0.05` is routine. **Sustained above about `0.2`** means the service is spending a fifth of its life tidying memory rather than working — users experience this as the system hanging |
| **Live threads** | Timeseries | How many pieces of work are in flight. A steady number is fine. A line **climbing and never coming back down** means work is piling up, usually because something it depends on is slow or dead |
| **Loaded classes** | Timeseries | How much program code the service has loaded. Rarely useful in an incident; it flattens out shortly after start-up |

---

### DIGIT — Logs (Loki) — `/grafana/d/digit-loki-logs/`

**What it is:** the messages the software itself writes as it runs — the closest thing to
the system explaining what went wrong, in its own words.

**The question it answers:** *what is the actual error?*

**Who uses it:** everyone. This is the most valuable dashboard on the system, and unlike the
JVM dashboard it covers **every** container, not just the Java ones.

**Three controls sit across the top of the page.** You do not need to write a query — set
these and read the result:

| Control | What to do with it |
|---|---|
| **service** | Choose which service's messages to show. Leave it as `.+` to see all of them at once |
| **level** | How serious a message is. Set it to **`ERROR`** to hide routine chatter and see only failures. `WARN` is "worth noticing", `INFO` is normal running commentary |
| **q** | A free-text filter. Paste a complaint number or a user ID here to follow one specific case across every service that touched it |

| Panel | Shape | What it shows and what the reading means |
|---|---|---|
| **Log lines (current range)** | Stat | How many messages were written in your time range. Context only — a large number is not itself a problem |
| **Errors / Exceptions (current range)** | Stat | How many of those were failures. **This is the "how bad is it" number.** Compare it against a quiet period to judge whether it is unusual |
| **Log volume by service (rate / sec)** | Timeseries | How talkative each service is over time. **Both directions are signals**: a sudden spike means something started failing repeatedly; a line **dropping to silence** means a service stopped running altogether |
| **Logs** | Logs | The messages themselves, newest at the top. **Scroll to the oldest one in your range and read that first** — when something breaks, everything downstream fails afterwards, so the earliest error is the cause and the rest are consequences |

---

### DIGIT — Traces (Tempo) — `/grafana/d/digit-tempo-traces/`

**What it is:** timings for individual requests. A **trace** follows one click — one complaint
submission, say — through every service it touched, and shows how long each step took.

**The question it answers:** *why was this slow, and which step took the time?*

**Who uses it:** mainly L2. L1's involvement is usually to copy a **Trace ID** into the
ticket, which is enormously useful and takes seconds.

| Panel | Shape | What it shows and what the reading means |
|---|---|---|
| **Services with traces (last 30m)** | Stat | How many services are currently reporting timings. A sanity check that trace collection is working at all |
| **Recent traces** | Table | The most recent requests. Click any row to open its breakdown |
| **Slow traces — duration > 500ms (last range)** | Table | Requests that took longer than half a second. **This is the panel to use for a "the system is slow" report.** Click a row and you see which service and which database call consumed the time |
| **Error traces (status = error)** | Table | Requests that failed outright rather than merely being slow |
| **Trace by ID** | Trace view | Paste a Trace ID here to see one specific request laid out as a waterfall — each service as a bar, its width being time spent |

> **Traces are kept for 24 hours only.** A slowness report raised on Monday about something
> that happened on Friday cannot be answered from traces. If you have one, copy the Trace ID
> into the ticket the same day.

---

### Node Exporter Full — `/grafana/d/node-exporter-full/`

**What it is:** the health of the physical machine everything runs on — processor, memory,
and above all **disk space** — as opposed to the individual services.

**The question it answers:** *is the server itself running out of something?*

**Who uses it:** L2.

> **If this dashboard is completely empty, that is not a fault and not an incident.** Either
> the component that reports machine statistics (`node-exporter`) isn't installed — it was
> added to the platform on **2026-07-22**, so older installations lack it — or it is running
> and the collector simply hasn't picked it up yet. Both are known, both are for L2 to sort
> out, and neither is worth a ticket on its own. Mention it if you were asked to check CPU,
> memory or disk and couldn't. See
> [alerts-setup.md](alerts-setup.md#prerequisite--turn-on-host-metrics).

When it does have data, the readings that matter:

| Reading | Concerning when | Why it matters |
|---|---|---|
| **CPU Busy** | Above 90% for a sustained period | Everything slows down; health checks start timing out and services get killed for being unresponsive |
| **RAM Used** | Above 90% | The operating system begins killing containers to reclaim memory, usually the largest one, without warning |
| **Swap** | Any sustained use | The machine has run out of real memory and is using disk as a substitute. Everything becomes dramatically slower |
| **Disk Space Used** | Above 85% (warning), above 95% (critical) | **The most common cause of a complete outage.** The database refuses to accept new data when the disk fills, so complaints stop saving |
| **Load average** | Higher than the number of CPU cores, sustained | More work is queued than the machine can get through |

---

## The health dashboard's groups

The health dashboard sorts its ~50 checks into ten groups. Which group a red tile sits in
tells you how serious it is before you know anything else about it.

| Group | What's in it | A red tile here means |
|---|---|---|
| **Infrastructure** | Database, connection pooler, cache, message broker, file storage | **The most serious thing on the page.** Nothing above it can work — treat it as an outage and escalate immediately |
| **Core Services** | The shared platform: user accounts, workflow, master data, employees, boundaries, translations, ID generation, authorisation, encryption, file metadata, and the two Kafka writers | A service many features depend on. Expect several unrelated-looking symptoms at once |
| **API Gateway** | Kong and its proxies — every API request in the system passes through here | Requests cannot be routed. Users see "502" or a blank screen |
| **Application** | The complaint service itself and the web front end | The product people actually use |
| **Search** | Elasticsearch, the indexer and the inbox service | Inbox and search break. Filing complaints still works |
| **Notifications** | The notification platform, its bridge, and the config and preference services | SMS / email / WhatsApp stop going out. Everything else is unaffected |
| **OTP** | One-time-password delivery for sign-in | Users cannot receive the code they need to log in |
| **Sign-in / identity** | The identity provider, its database, and the token exchange service | Signing in fails |
| **MCP** | Integration tooling | No effect on citizens or staff using the system |
| **API Tests** | Real calls against live APIs — different from the rest, see below | Read the note below before acting on it |

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
| **JVM metrics** (Prometheus) | The 16 instrumented Java services: `boundary-service`, `digit-config-service`, `egov-accesscontrol`, `egov-enc-service`, `egov-filestore`, `egov-hrms`, `egov-idgen`, `egov-indexer`, `egov-persister`, `egov-user`, `egov-workflow-v2`, `inbox`, `mdms-backend`, `novu-bridge`, `pgr-services`, plus dashboard web metrics | Postgres, Redis, Kafka, Kong, Elasticsearch, MinIO, nginx, the sign-in / identity service, Node services |
| **Logs** (Loki) | **Every container** — around 44 of them | Nothing, as long as promtail is running |
| **Traces** (Tempo) | Requests through instrumented Java services and Kong | Direct database or broker activity |
| **Health checks** (Gatus) | ~50 endpoints across every group, including infrastructure | Anything not in the endpoint catalogue |
| **Host metrics** (node-exporter) | CPU, RAM, disk, network, filesystem | **Not present on deployments installed before 2026-07-22** |

The practical takeaway: for the non-Java containers, **Gatus tells you if it is alive and
Loki tells you why it isn't.** There are no metrics-based alerts to be had for them.

---

## Data retention

Nothing here is kept for long. Knowing the numbers is what tells you whether a problem
reported today can still be investigated at all.

| Data | Store | Retention |
|---|---|---|
| Metrics | Prometheus | **15 days** |
| Logs — searchable, in Grafana | Loki | **72 hours (3 days)** |
| Traces | Tempo | **24 hours** |
| Health-check history | Gatus | in-memory; lost the moment the container restarts |
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
