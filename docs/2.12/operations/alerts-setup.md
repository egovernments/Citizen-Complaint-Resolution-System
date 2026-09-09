# Setting up alerts

How to make the system tell you it is unwell, before a citizen does.

← back to **[Operations handbook](README.md)** · where alerts are delivered:
**[alert-channels.md](alert-channels.md)**

---

## Contents

- [Before you start](#before-you-start)
- [Prerequisite — turn on host metrics](#prerequisite--turn-on-host-metrics)
- [How Grafana alerting fits together](#how-grafana-alerting-fits-together)
- [Creating your first rule, click by click](#creating-your-first-rule-click-by-click)
- [The rule catalogue](#the-rule-catalogue)
  - [Host alerts](#host-alerts-cpu-ram-disk)
  - [Service alerts](#service-alerts-crashes-memory-restarts)
  - [Application alerts](#application-alerts-errors-latency-queues)
  - [Infrastructure alerts](#infrastructure-alerts-database-broker-gateway)
  - [Synthetic alerts](#synthetic-alerts-and-the-dead-mans-switch)
- [Getting "No Data" right](#getting-no-data-right-the-mistake-everyone-makes)
- [Shipping alerts as code](#shipping-alerts-as-code-so-they-survive-a-rebuild)
- [Avoiding alert fatigue](#avoiding-alert-fatigue)
- [Testing that alerting actually works](#testing-that-alerting-actually-works)

---

## Before you start

**Current state on a stock deployment**, verified against a running instance:

- Grafana **11.4.0** with unified alerting available.
- **Zero alert rules configured.** Nothing is watching anything today.
- One contact point exists — `email receiver` pointing at the literal placeholder
  `<example@email.com>`. It cannot deliver.
- The default notification policy routes everything to `grafana-default-email`.
- **No SMTP server is configured** (`GF_SMTP_*` is unset), so email alerts will not send
  even after you fix the address. Start with a chat webhook instead —
  see [alert-channels.md](alert-channels.md).

So: everything in this document is something you are creating from scratch. That is
expected.

**Two things to know about access:**

- **You need a Grafana login before you start.** The login form is enabled
  (`GF_AUTH_DISABLE_LOGIN_FORM: "false"`), the user is `admin`, and the password is
  generated on the first deploy and stored in OpenBao — your system administrator can
  read it back with
  `bao kv get -field=grafana_admin_password kv/digit/<deployment>`. Get it before you
  invest an afternoon in building rules.
  - **Anonymous access is a separate, off-by-default switch.** `GF_AUTH_ANONYMOUS_ENABLED`
    follows the deployment's `grafana_anonymous_enabled`, which defaults to `false`, and
    the anonymous role is pinned to **Viewer** in the compose file. A Viewer cannot create
    alert rules, so if you are browsing without logging in, Save will be rejected — log in
    rather than working around it.
  - **Create named accounts before the desk starts using this — that is your job, not
    ours.** A fresh deployment holds exactly one account, `admin`, and self-registration is
    off, so unless you act everyone shares one login and Grafana cannot record who created,
    edited or silenced a rule. Create a Grafana user for each **L1 and L2** person:
    **Administration → Users and access → Users → New user** (Grafana 11.4). Set the
    password on that screen and hand it over directly — **do not use Invite**, because SMTP
    is not configured here (`smtp.enabled = false`) and the invitation email is never sent.
    New users are created as **Viewer**: change each one to **Editor**, because a Viewer
    cannot open **Explore**, which first response and L2 diagnosis both depend on. Keep
    `admin` for yourself, and keep a written change log for rule edits regardless.
  - **If the instance is reachable from the public internet**, ask us to put it behind your
    VPN or an authenticating proxy — and note that a Viewer can run arbitrary Loki queries,
    which is why anonymous access is not a safe default here.
- Rules you create in the UI are stored in Grafana's own database inside the
  `grafana_data` Docker volume. They survive restarts and redeployments. They do **not**
  survive `docker compose down -v` — which is one more reason that command appears on the
  destroy-list in [l2-diagnosis.md](l2-diagnosis.md#commands-that-are-destructive).
  For rules that must survive anything, see
  [Shipping alerts as code](#shipping-alerts-as-code-so-they-survive-a-rebuild).

---

## Prerequisite — turn on host metrics

**Most of the alerts you want — 90% CPU, 90% RAM, disk filling up — need the
`node-exporter` container.** Check whether you have it. Grafana → **Explore** →
datasource **Prometheus** → run:

```promql
up
```

A healthy full stack answers with **five** jobs:

| Job | Feeds |
|---|---|
| `otel-collector` | JVM metrics from the 15 instrumented Java services, plus browser metrics |
| `node` | host CPU / RAM / disk — **the host alerts below** |
| `postgres-exporter` | database internals — the database alerts below |
| `redpanda` | broker health and consumer lag — the broker alerts below |
| `kong` | gateway traffic, status codes and latency — the gateway alerts below |

| Result | Meaning |
|---|---|
| `job="node"` present | Host metrics available. Skip to the next section. |
| `job="node"` missing | **No host metrics right now.** The `Node Exporter Full` dashboard will be empty and the host alerts below cannot be created. Two different causes — see below. |
| Some other job missing | That exporter is not running on this deployment. Its dashboard will be blank and the matching rules below cannot be created — raise it with us |

**Missing `node` has two causes, and they need different fixes.** Check them in this order,
because the second is a one-minute fix and the first is a redeploy:

1. **Prometheus is running an older copy of its configuration.** The scrape job is in the
   file on disk, but Prometheus has not re-read it since it was added. This is easy to hit,
   because the config is bind-mounted — the file can change under a running Prometheus
   without it noticing. **Confirm:** the file `/opt/digit/otel/prometheus.yml` contains a
   `job_name: node`, and `docker ps` shows a `node-exporter` container up. If both are true,
   this is your case. **Fix:** L2 reloads the config in place, no restart and no downtime —
   see [l2-diagnosis.md](l2-diagnosis.md#the-host-itself-cpu-ram-disk).
2. **`node-exporter` genuinely isn't there.** It was added to the platform on
   **2026-07-22**; deployments installed before that date and never re-converged do not have
   it. **Confirm:** no `node-exporter` container in `docker ps -a`, and no `node` job in the
   config file. **Fix:** ask us — it is a redeploy with `docker-compose.monitoring.yml`
   layered in, plus the `node` scrape job in `otel/prometheus.yml`; both already ship with
   the platform. Naming them in the request makes it quick.

Re-run `up` after either fix; `job="node"` at value `1` means you are done.

Until then you have the **service, application and synthetic alerts only**: service crashes, OOM, restarts, error rates and
latency — which is still most of what actually pages you. Disk filling up, however, is the
single most common cause of a total outage, and you cannot alert on it without this. Treat
it as a priority.

---

## How Grafana alerting fits together

Five pieces. You will meet all of them in the UI:

```
  Rule                Evaluation group        Labels          Notification policy     Contact point
  ────                ────────────────        ──────          ───────────────────     ─────────────
  a query +      →    how often it's     →    severity=  →    routing rules      →    Slack / email /
  a threshold         checked, and how        critical        match on labels         webhook / etc.
                      long it must stay
                      true before firing
```

- **Rule** — a query (PromQL or LogQL) plus a threshold. Fires when the threshold is
  breached.
- **Pending period** (`for`) — how long the breach must persist before the alert fires. This
  is your main defence against noise. A CPU spike for 40 seconds is normal; for 15 minutes
  it is not.
- **Evaluation group** — a folder + interval. Rules in a group are evaluated together, e.g.
  every 1 minute.
- **Labels** — key/value tags on the alert, most importantly `severity`. Routing is done on
  labels, so **set `severity` on every rule** or your routing has nothing to work with.
- **Notification policy** — matches labels and decides which contact point receives it, plus
  grouping and repeat intervals. Covered in [alert-channels.md](alert-channels.md).
- **Contact point** — Slack, Google Chat, Teams, webhook, email, PagerDuty.

Set up **one contact point first** ([alert-channels.md](alert-channels.md)) so your first
rule has somewhere to go, then come back here.

---

## Creating your first rule, click by click

We will build **HostDiskSpaceCritical** — the alert that matters most. If you do not have
host metrics yet, build **ServiceOutOfMemory** from [Service alerts](#service-alerts-crashes-memory-restarts)
instead; the steps are identical.

1. Go to `https://<your-domain>/grafana/` → **Alerting** → **Alert rules** → **+ New alert rule**.

2. **Name**: `HostDiskSpaceCritical`. Use the exact names from the catalogue below — when
   an alert reaches us, a consistent name tells us immediately what it means.

3. **Define query and alert condition**
   - Datasource: **Prometheus**
   - Query **A**, switch to **Code** mode, paste:
     ```promql
     100 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"}
            / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"} * 100)
     ```
   - Set the **threshold** to `IS ABOVE` `95`.
   - If you are in the advanced/expression view, the shape is: `A` (query) →
     `B` = **Reduce**, function `Last`, input `A` → `C` = **Threshold**, input `B`, above `95`,
     and `C` is the alert condition.
   - Click **Preview** — you should see one row per mounted filesystem with its current
     percentage. If you see nothing, your query is wrong or node-exporter is missing.

4. **Set evaluation behaviour**
   - **Folder**: create one called `DIGIT Alerts` and keep everything in it. The folder name
     becomes the `grafana_folder` label, which the default policy groups on.
   - **Evaluation group**: create `1m` (evaluated every minute).
   - **Pending period**: `5m`. Disk does not un-fill itself, so a short pending period is
     fine and buys you five extra minutes of warning.
   - **Configure no data and error handling** → set **"Alert state if no data"** to
     **`OK`** for this rule. (Read
     [Getting "No Data" right](#getting-no-data-right-the-mistake-everyone-makes) before you
     accept the default on any rule.)

5. **Configure labels and notifications**
   - Add label `severity` = `critical`.
   - Add label `team` = `ops` (useful later for routing).
   - Choose your contact point, or leave it to the notification policy.

6. **Add annotations**
   - **Summary**: `Disk {{ $labels.mountpoint }} is {{ humanize $values.B }}% full on {{ $labels.instance }}`
   - **Description**: `Postgres will refuse writes when the disk fills. Check large Docker log files and Elasticsearch indices. Runbook: https://<your-runbook-host>/operations/l2-diagnosis#the-host-itself-cpu-ram-disk`
   - **Always put the runbook link in the description**, and make it an **absolute URL the
     recipient can click**. A repository-relative path like `docs/2.12/operations/…` is not a
     link in Slack, email or a paging app, and the person on call may not have the repo
     checked out. Substitute wherever your team actually hosts this handbook — an internal
     wiki, a docs site, or the file's permalink on your git host. At 3am, the person
     reading the alert is not the person who wrote it.

7. **Save rule and exit.** It appears under **Alerting → Alert rules** with its current
   state (`Normal`, `Pending`, `Alerting`, `No Data`).

---

## The rule catalogue

Suggested thresholds and durations. They are deliberately conservative — better to start
here and tighten once you know what your box's normal looks like.

**Severity convention used below** — `critical` = wake someone up; `warning` = look at it
during working hours.

### Host alerts (CPU, RAM, disk)

*Requires node-exporter — see [Prerequisite](#prerequisite--turn-on-host-metrics).*
Datasource: **Prometheus**.

| Rule name | Query | Fires when | Pending | Severity |
|---|---|---|---|---|
| **HostCpuHigh** | `100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)` | `> 90` | **15m** | warning |
| **HostCpuCritical** | same as above | `> 95` | **30m** | critical |
| **HostMemoryHigh** | `100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)` | `> 90` | **10m** | critical |
| **HostSwapping** | `100 * (1 - node_memory_SwapFree_bytes / node_memory_SwapTotal_bytes)` | `> 10` | **15m** | warning |
| **HostDiskSpaceWarning** | `100 - (node_filesystem_avail_bytes{fstype!~"tmpfs\|overlay\|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs\|overlay\|squashfs"} * 100)` | `> 85` | **10m** | warning |
| **HostDiskSpaceCritical** | same as above | `> 95` | **5m** | critical |
| **HostDiskWillFillIn4h** | `predict_linear(node_filesystem_avail_bytes{fstype!~"tmpfs\|overlay\|squashfs"}[6h], 4*3600)` | `< 0` | **30m** | critical |
| **HostInodesLow** | `100 * (node_filesystem_files_free / node_filesystem_files)` | `< 10` | **15m** | warning |
| **HostLoadHigh** | `node_load15 / count without (cpu, mode) (node_cpu_seconds_total{mode="idle"})` | `> 1.5` | **15m** | warning |
| **HostDown** | `up{job="node"}` | `< 1` | **5m** | critical |

Notes worth reading:

- **`HostDiskWillFillIn4h` is the best alert on this page.** It looks at the last six hours
  of free space, extrapolates, and tells you *before* you hit 95% — often a day early on a
  slow leak. `predict_linear` returning a negative value means "projected to hit zero inside
  the window".
- **The `fstype` exclusions matter.** Without them you will alert on Docker's overlay layers
  and tmpfs mounts, which are meaningless and always noisy. If you still get noise, add the
  specific `mountpoint` to the exclusion.
- **Why 15 minutes for CPU?** Deployments, database migrations and nightly jobs legitimately
  peg the CPU for several minutes. Anything shorter and you will be paged by your own
  maintenance.
- **`HostMemoryHigh` uses `MemAvailable`, not `MemFree`.** Linux uses free RAM as cache;
  `MemFree` is near zero on a healthy box and would alert constantly.
- **`HostSwapping` does nothing on a box with no swap.** Several of these deployments have
  none configured, so `SwapTotal` is `0` and the expression evaluates to `NaN` rather than a
  number — it will never fire and its preview will look broken. Check with
  `node_memory_SwapTotal_bytes` before building it; if that returns `0`, skip the rule
  instead of trying to fix it.

### Service alerts (crashes, memory, restarts)

*Works on every deployment today.* Datasource as noted.

| Rule name | Datasource | Query | Fires when | Pending | Severity |
|---|---|---|---|---|---|
| **ServiceHeapHigh** | Prometheus | `100 * sum by (service_name) (jvm_memory_used_bytes{jvm_memory_type="heap"}) / sum by (service_name) (jvm_memory_limit_bytes{jvm_memory_type="heap"})` | `> 90` | **10m** | warning |
| **ServiceGcThrashing** | Prometheus | `sum by (service_name) (rate(jvm_gc_duration_seconds_sum[5m]))` | `> 0.25` | **10m** | warning |
| **ServiceStoppedReporting** | Prometheus | `count by (service_name) (jvm_thread_count offset 15m) unless count by (service_name) (jvm_thread_count)` | `>= 1` | **5m** | critical |
| **ServiceThreadLeak** | Prometheus | `sum by (service_name) (jvm_thread_count)` | `> 400` | **30m** | warning |
| **ServiceOutOfMemory** | Loki | `sum by (compose_service) (count_over_time({compose_project="digit", compose_service!~"grafana\|loki"} \|~ "(?i)outofmemoryerror\|java heap space\|gc overhead limit" [5m]))` | `> 0` | **0m** | critical |
| **ServiceRestarted** | Loki | `sum by (compose_service) (count_over_time({compose_project="digit", compose_service!="loki"} \|~ "Started .+Application in" [10m]))` | `> 0` | **0m** | warning |
| **ServiceRestartLoop** | Loki | same query with `[1h]` | `> 3` | **0m** | critical |
| **ErrorLogSpike** | Loki | `sum by (compose_service) (count_over_time({compose_project="digit"} \|~ "(?i)error\|exception" [5m]))` | `> 50` | **10m** | warning |

Notes:

- **`ServiceStoppedReporting` is your "a service died" alert.** All metrics are pushed
  through the OpenTelemetry collector, so `up` only ever tells you about the collector
  itself — a dead service simply stops producing series. This query says "which services
  were reporting 15 minutes ago and are not reporting now", which is exactly the signal you
  want, and it needs no per-service configuration.
- **`ServiceRestarted` deserves a maintenance window.** Every Java service logs
  `Started XyzApplication in N seconds` once per boot, so a deployment fires this for every
  service at once. Suppress it during your deployment window with a Grafana
  **mute timing** — see [alert-channels.md](alert-channels.md#quiet-hours-maintenance-windows-and-silences).
- **`ServiceRestartLoop` is the one that matters.** Four boots of the same service in an
  hour means it is crash-looping and is not going to recover on its own.
- **Exclude `grafana` and `loki` from the OOM rule.** Both log your search text back into
  the log stream, so an un-excluded rule alerts on its own query. Elasticsearch also uses
  the phrase "out of memory" in routine circuit-breaker messages — if it becomes noisy, add
  `compose_service!="elasticsearch"`.
- **`ErrorLogSpike`'s threshold of 50 is a placeholder.** Before enabling it, run the query
  in Explore over a normal week and set the threshold above the observed peak. A deployment
  with a chatty service will need a higher number, or a per-service threshold.
- **`ServiceHeapHigh` will not fire for every service.** One of the sixteen instrumented
  services does not report a heap limit, so it is silently excluded. That is acceptable —
  `ServiceOutOfMemory` catches it after the fact.

### Application alerts (errors, latency, queues)

Datasource: **Prometheus**.

| Rule name | Query | Fires when | Pending | Severity |
|---|---|---|---|---|
| **Http5xxRate** | `sum by (service_name) (rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m]))` | `> 0.1` | **10m** | warning |
| **Http5xxRateCritical** | same | `> 1` | **5m** | critical |
| **LatencyP95High** | `histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket[5m])))` | `> 3` | **15m** | warning |
| **DbPoolSaturated** | `db_client_connections_pending_requests` | `> 0` | **5m** | critical |
| **DbConnectionTimeouts** | `rate(db_client_connections_timeouts_total[5m])` | `> 0` | **5m** | critical |
| **KafkaConsumerLag** | `max by (service_name, client_id) (kafka_consumer_records_lag_max)` | `> 1000` | **15m** | warning |
| **KafkaConsumerStalled** | `max by (service_name, client_id) (kafka_consumer_records_lag_max)` | `> 10000` | **10m** | critical |

Notes:

- **`> 0.1` errors per second is roughly six failed requests a minute** — low enough to
  catch a genuine regression, high enough to ignore a single user's bad request.
- **`DbPoolSaturated` deserves the critical label** even though nothing is "down". Requests
  queuing for a database connection is what "the whole system is slow but everything is
  green" looks like from the inside.
- **Kafka lag thresholds are volume-dependent.** On a quiet deployment, a lag of 1000 means
  something is stuck. On a busy one during bulk import it is normal. Watch
  `kafka_consumer_records_lag_max` for a week before committing to a number — and remember
  that lag *trending upward without recovering* is the real signal, which is what the
  15-minute pending period approximates.
- Consider adding **`PgrAnalyticsSlow`** if supervisors complain about the dashboard:
  `histogram_quantile(0.95, sum by (le) (rate(pgr_analytics_query_duration_ms_bucket[5m]))) > 5000`.

### Infrastructure alerts (database, broker, gateway)

These became possible when the database, broker and gateway got their own exporters. They
cover the failures that used to be invisible until a user reported them — and unlike the
health checks, they fire while the service is still answering.

*Requires the matching scrape job — check with `up`.* Datasource: **Prometheus**.

**Database** (`job="postgres-exporter"`):

| Rule name | Query | Fires when | Pending | Severity |
|---|---|---|---|---|
| **PostgresDown** | `pg_up` | `< 1` | **2m** | critical |
| **PostgresConnectionsHigh** | `100 * sum(pg_stat_activity_count{datname="egov"}) / on() group_left() pg_settings_max_connections` | `> 80` | **10m** | warning |
| **PostgresCacheHitLow** | `100 * sum(pg_stat_database_blks_hit{datname="egov"}) / (sum(pg_stat_database_blks_hit{datname="egov"}) + sum(pg_stat_database_blks_read{datname="egov"}))` | `< 95` | **15m** | warning |
| **PostgresDeadlocks** | `rate(pg_stat_database_deadlocks{datname="egov"}[5m])` | `> 0` | **5m** | warning |
| **PostgresLongTransaction** | `max(pg_stat_activity_max_tx_duration{datname="egov"})` | `> 300` | **5m** | warning |
| **PostgresIdleInTransaction** | `sum(pg_stat_activity_count{datname="egov", state="idle in transaction"})` | `> 5` | **15m** | warning |

**Message broker** (`job="redpanda"`):

| Rule name | Query | Fires when | Pending | Severity |
|---|---|---|---|---|
| **BrokerDiskLow** | `redpanda_storage_disk_free_space_alert` | `> 0` | **5m** | critical |
| **BrokerDiskFreePercent** | `100 * redpanda_storage_disk_free_bytes / redpanda_storage_disk_total_bytes` | `< 15` | **15m** | warning |
| **BrokerPartitionsUnavailable** | `redpanda_cluster_unavailable_partitions` | `> 0` | **5m** | critical |
| **ConsumerGroupEmpty** | `redpanda_kafka_consumer_group_consumers` | `< 1` | **10m** | critical |
| **ConsumerLagHigh** | the broker-side lag expression in [reference.md](reference.md#prometheus--the-message-broker-redpanda) | `> 5000` | **15m** | warning |

**Gateway** (`job="kong"`):

| Rule name | Query | Fires when | Pending | Severity |
|---|---|---|---|---|
| **KongUpstream5xx** | `sum by (service) (rate(kong_http_requests_total{code=~"5.."}[5m]))` | `> 0.1` | **10m** | warning |
| **KongUpstreamSlow** | `histogram_quantile(0.95, sum by (le, service) (rate(kong_upstream_latency_ms_bucket[5m])))` | `> 3000` | **15m** | warning |
| **KongProxySlow** | `histogram_quantile(0.95, sum by (le) (rate(kong_kong_latency_ms_bucket[5m])))` | `> 100` | **10m** | warning |
| **KongDatastoreUnreachable** | `kong_datastore_reachable` | `< 1` | **5m** | critical |

Notes:

- **`ConsumerGroupEmpty` is the best rule in this section.** Zero consumers attached to a
  queue means that pipeline has stopped entirely — complaints stop being indexed, or
  notifications stop being sent — while every service tile stays green. Nothing else catches
  it.
- **`BrokerDiskLow` reads the broker's own verdict** rather than a threshold you picked, so
  it needs no tuning. `0` is OK, `1` is low space, `2` is degraded.
- **`PostgresCacheHitLow` at 95% is deliberately below the healthy figure** (~99%+ on these
  deployments). Set it just under what your box actually runs at, after watching for a week.
- **`KongProxySlow` and `KongUpstreamSlow` are the same shape but mean opposite things.**
  Proxy-slow says the gateway is at fault; upstream-slow says the service behind it is.
  Routing them to the same channel is fine — the rule name carries the distinction.
- **`PostgresDown` and the Gatus PostgreSQL check overlap.** Keep whichever your team will
  act on; do not run both into the same channel.
- **These thresholds are starting points.** Run each query in Explore over a normal week
  before committing to a number.

### Synthetic alerts and the dead-man's switch

**Endpoint checks — do this before anything on this page.** The Gatus health dashboard at
`/status/` probes up to 57 endpoints every 30 seconds. **Alerting on those checks already
ships, already has every endpoint opted in, and already has sensible thresholds** — 3
consecutive failures (~90 seconds) before it fires, 2 passes before it says recovered, and
recovery messages on. It is off only because no webhook URL is set.

That means "service X is down" notifications across the whole catalogue cost you **one
value**, not one rule at a time — and Gatus is the only thing that watches **Redis,
Elasticsearch, MinIO and nginx**, which still have no metrics for a Grafana rule to read. See
[alert-channels.md § Gatus](alert-channels.md#option-b--gatus-native-alerting-endpoint-down).

Everything in the catalogue above stays worth building afterwards: Gatus tells you a service
stopped answering, Grafana tells you about the hour before that — the disk filling, the heap
creeping, the lag climbing. **Do not write Grafana rules that duplicate Gatus's endpoint
checks.**

**Who watches the watcher?** If the whole box dies, Grafana dies with it and you get
silence — which looks exactly like "everything is fine". The fix is a **dead-man's switch**:

1. Create an always-firing rule, `Watchdog`: Prometheus query `vector(1)`, condition
   `IS ABOVE 0`, pending `0m`, severity `watchdog`.
2. Route `severity=watchdog` to a heartbeat monitor (Healthchecks.io, Better Stack,
   Uptime Kuma — all have free tiers) with a repeat interval of 5 minutes.
3. Configure that monitor to alert you when the heartbeat **stops**.

Now silence itself is an alarm. Pair it with an **external** uptime check on
`https://<your-domain>/status/` from outside the network, so you also learn about DNS, TLS
expiry and network failures that no on-box alert can see.

---

## Getting "No Data" right (the mistake everyone makes)

When a service dies, its metrics do not go to zero — **they disappear**. Grafana then puts
the rule into `No Data`, not `Alerting`. If you leave the default, your "service down"
alert stays silent at exactly the moment it is needed.

Each rule has **"Configure no data and error handling"**. Set it deliberately:

| Rule kind | "Alert state if no data" | Why |
|---|---|---|
| Down/absence detection (`ServiceStoppedReporting`, `HostDown`) | **Alerting** | Missing data *is* the failure |
| Threshold on a always-present metric (CPU, RAM, disk, heap) | **OK** or **No Data** | Missing data means a scrape hiccup, not an incident. `OK` keeps it quiet; `No Data` surfaces it as a distinct, non-paging state |
| Loki count rules (`ServiceOutOfMemory`, `ServiceRestarted`) | **OK** | "No matching log lines" is the healthy case and must not alert |

The Loki ones are the easiest to get wrong: a rule counting OOM messages reports `No Data`
whenever there are no OOMs — i.e. nearly always — so setting that to `Alerting` produces an
alarm that fires when everything is fine, and the channel quickly stops being read.

Set **"Alert state if execution error"** to `Alerting` on critical rules — a rule that
cannot run is not a rule that passed.

---

## Shipping alerts as code (so they survive a rebuild)

UI-created rules live in the `grafana_data` volume. That is fine for most purposes, but
rules that matter should live in the platform repository, where they are version-controlled,
reviewed, and reapplied on every deployment.

Grafana reads provisioning files from `/etc/grafana/provisioning`, which is bind-mounted
read-only from **`otel/grafana/provisioning/`** in the repo. Datasources and dashboards are
already provisioned this way; alerting slots in beside them:

```
otel/grafana/provisioning/
├── dashboards/     ← already there
├── datasources/    ← already there
└── alerting/       ← add this
    ├── rules.yaml
    ├── contact-points.yaml
    └── policies.yaml
```

A worked example — `rules.yaml`, one rule, the disk-critical one:

```yaml
apiVersion: 1
groups:
  - orgId: 1
    name: host-1m
    folder: DIGIT Alerts
    interval: 1m
    rules:
      - uid: host-disk-critical
        title: HostDiskSpaceCritical
        condition: C
        for: 5m
        data:
          - refId: A
            relativeTimeRange: { from: 300, to: 0 }
            datasourceUid: prometheus
            model:
              refId: A
              instant: true
              expr: >-
                100 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"}
                / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"} * 100)
          - refId: C
            datasourceUid: __expr__
            model:
              refId: C
              type: threshold
              expression: A
              conditions:
                - evaluator: { type: gt, params: [95] }
        noDataState: OK
        execErrState: Alerting
        labels:
          severity: critical
          team: ops
        annotations:
          summary: 'Disk {{ $labels.mountpoint }} above 95% on {{ $labels.instance }}'
          description: 'Postgres refuses writes when the disk fills. Runbook: https://<your-runbook-host>/operations/l2-diagnosis'
```

The fastest way to author these is to **build the rule in the UI first, confirm it fires,
then export it**: Alerting → Alert rules → the rule's **⋮** menu → **Export** → **YAML**.
Paste the result into the file.

Two caveats:

- **Provisioned rules are read-only in the UI.** That is the point, but it surprises people
  — you can no longer edit or delete them from Grafana, only from the file.
- **Never commit webhook URLs or SMTP passwords.** A Slack webhook URL is a credential:
  anyone holding it can post into your channel. Reference an environment variable
  (`url: ${SLACK_WEBHOOK_URL}`) and keep the value in the deployment's `.env`.

Send us the files and we will fold them into the deployment, or keep them locally and apply
them yourself — either works.

---

## Avoiding alert fatigue

An alert nobody reads is worse than no alert, because it creates the *belief* that something
is watching. Rules that hold up in practice:

1. **Turn on Gatus alerting first** — one webhook URL, and it covers every health check
   ([alert-channels.md](alert-channels.md#option-b--gatus-native-alerting-endpoint-down)).
   Then **start with five Grafana rules, not thirty.** In order of value:
   `HostDiskSpaceCritical`, `ConsumerGroupEmpty`, `ServiceOutOfMemory`, `HostMemoryHigh`,
   `ServiceRestartLoop`. Live with them for two weeks. Add more only when an incident happens
   that they did not catch — that incident tells you exactly which rule was missing.
   (`ServiceStoppedReporting` is the sixth; Gatus already covers most of what it catches.)
2. **Every `critical` must be actionable at 3am.** If the honest response is "look at it
   tomorrow", it is a `warning`. Route the two severities to different places
   ([alert-channels.md](alert-channels.md)).
3. **Tune the pending period, not the threshold.** Most noise is transient spikes. Making
   the threshold higher hides real problems; making the duration longer only hides brief
   ones.
4. **Every alert needs a runbook link in its description.** No exceptions.
5. **Review monthly.** For each alert that fired: was it real, and did anyone act? An alert
   that fires often and is always ignored should be deleted or fixed the same day you notice
   the pattern.
6. **Suppress your own maintenance.** Deployments cause restarts, CPU spikes and brief
   outages. Set a mute timing for the deployment window instead of retraining the team to
   ignore alerts.

---

## Testing that alerting actually works

An untested alert path is an assumption. Test it the day you set it up, and again after
any change to the deployment.

1. **Test the contact point.** Alerting → Contact points → your contact point →
   **Test**. A message should arrive within seconds; if it doesn't, fix this before going
   any further, since every rule depends on it.
2. **Test a real rule end to end.** Temporarily lower a threshold so it must fire — e.g.
   set `HostDiskSpaceWarning` to `> 1` — save, wait for the pending period, and confirm the
   notification arrives in the channel with the summary text you wrote. **Then put the
   threshold back.** Note the round trip: rules and thresholds are easy to change back, but
   write down what you changed before you change it.
3. **Check the resolved message arrives too.** A channel that reports failures but never
   recoveries trains people to ignore it.
4. **Confirm severity routing.** Fire one `warning` and one `critical` and check they land
   in different places, if that is how you configured it.
5. **Record the result** — date, who tested, what arrived where. When an incident is missed
   six months later, this is the first thing anyone will want to see.
