# L2 — diagnosis

**For:** the engineers who own the deployment. You have server access and can restart
services, read logs across the whole stack, and change configuration.

**Your job:** take what L1 captured and identify **which component is failing and why** —
far enough that the fix is either yours to apply or clearly a product defect to send on.

This assumes [L1 first response](l1-first-response.md) has been worked, or that you're
starting cold and have done it yourself. Every query and panel name here is real and was run
against a live deployment.

← back to **[Operations handbook](README.md)**

---

## Contents

- [How the stack is layered](#how-the-stack-is-layered)
- [Reading the evidence L1 captured](#reading-the-evidence-l1-captured)
- [Going deeper on logs](#going-deeper-on-logs)
- [Is it slow, or is it failing?](#is-it-slow-or-is-it-failing)
- [The host itself](#the-host-itself-cpu-ram-disk)
- [Container logs — the usual reason the disk fills](#container-logs--the-usual-reason-the-disk-fills)
- [Raising CPU or memory for a service](#raising-cpu-or-memory-for-a-service)
- [Symptom → playbook](#symptom--playbook)
- [Working on the server itself](#working-on-the-server-itself)
- [Commands that are destructive](#commands-that-are-destructive)
- [Query cookbook](#query-cookbook)
- [When to escalate to us](#when-to-escalate-to-us)

---

## How the stack is layered

A deployment runs roughly 40 containers. Almost every failure sits in one of five layers,
and the layer tells you where to look:

| Layer | What's in it | Fails as | Look at |
|---|---|---|---|
| **Edge** | nginx (host), Kong gateway | 502 / 504, site won't load, some APIs 404 | Health dashboard → *API Gateway*; nginx + kong logs |
| **Application** | pgr-services, digit-ui, configurator, inbox, dashboard | A screen or action breaks, others fine | Health dashboard → *Application*; that service's logs |
| **Core platform** | user, workflow, mdms, hrms, boundary, localization, idgen, accesscontrol, filestore, persister, indexer | Many features break at once; login fails | Health dashboard → *Core Services* |
| **Backbone** | Postgres, PgBouncer, Redis, Redpanda (Kafka), MinIO, Elasticsearch | Everything degrades or hangs | Health dashboard → *Infrastructure* |
| **Host** | CPU, RAM, disk, network, Docker | Random restarts, OOM kills, "no space left on device" | Node Exporter Full dashboard, or SSH |

**Causation runs downward.** If a Core Service is red, there is little point debugging the
application sitting on top of it — start with the core service. If Infrastructure is red,
nothing above it can be trusted.

---

## Reading the evidence L1 captured

Part A of the report should give you red tiles, restart/OOM findings and a first error. Work
from those before opening anything new.

### Restarts

A service that crashed and restarted shows as a heap line dropping to zero and climbing
again on **`DIGIT JVM Services` → "Heap used (MB) — by service"**. The definitive version is
in the logs:

```logql
{compose_project="digit", compose_service!="loki"} |~ `Started .+Application in`
```

Every Java service logs `Started XyzApplication in N seconds` once per boot. Widen to 24
hours: a service appearing repeatedly is crash-looping, and that is the headline.

Expect one cluster at your deployment window if the deployment redeploys on a schedule.
Restarts outside that window are the interesting ones.

### Memory

- **"OOM events (current range)"** above `0` means a real `OutOfMemoryError` or
  `GC overhead limit exceeded` in the range. The panel below it carries the stack traces.
- **"Right-sizing snapshot"** — headroom below 10% means the service will OOM under load;
  it needs a bigger heap, which is a deployment change.
- **"GC pause time (s/s)"** sustained above ~0.2 means the service spends 20% of its time
  collecting garbage. It will look hung while being technically alive.
- **"Live threads"** climbing without bound is a thread leak, usually caused by something
  downstream being slow or dead.
- **"JVM CPU — recent utilization"** at `1.0` is one full core. Sustained high CPU with no
  traffic is a spin loop.

> **Coverage limit.** JVM metrics exist only for the **16 Java services carrying the
> OpenTelemetry agent**: boundary-service, digit-config-service, egov-accesscontrol,
> egov-enc-service, egov-filestore, egov-hrms, egov-idgen, egov-indexer, egov-persister,
> egov-user, egov-workflow-v2, inbox, mdms-backend, novu-bridge, pgr-services, plus dashboard
> web metrics. **Postgres, Redis, Kafka, Kong, Elasticsearch, nginx, the sign-in service and the Node
> services have no metrics at all** — for those, the health dashboard and the logs are the
> only signals, and both cover them fully.

---

## Going deeper on logs

Logs cover **every container** — all ~44 — including the ones with no metrics.

The method:

1. **Start ten minutes before the symptom**, not at the moment it was noticed.
2. **Read the oldest error in the range.** Failures cascade; everything after the first is
   usually consequence.
3. **Follow the error down a layer.** `pgr-services` reporting
   `Connection refused: egov-workflow-v2` is not a pgr-services bug — read egov-workflow-v2's
   logs for the same minute.
4. **Search by identifier** when one case is broken: put the complaint number in the **q**
   box with service `.+` and you'll see every service that touched it.

Which service is producing the most errors — run this first when the whole system is
unwell, it points straight at the origin:

```logql
sum by (compose_service) (count_over_time({compose_project="digit"} |~ `(?i)error|exception` [5m]))
```

Then narrow:

```logql
{compose_service="pgr-services"} |~ `(?i)error|exception`
{compose_service=~"postgres-db|pgbouncer"} |~ `(?i)fatal|error|too many clients|deadlock|out of memory`
{compose_service="kong"} |~ `(?i)502|503|504|no route|upstream`
{compose_project="digit"} |= `PGR-2026-01-000123`
```

> **Two false-positive traps.** Grafana logs your search text back into the log stream, so a
> search for "OutOfMemoryError" matches Grafana's own line — ignore hits where
> `compose_service` is `grafana` or `loki`. Elasticsearch also uses the phrase "out of
> memory" in routine circuit-breaker messages.

---

## Is it slow, or is it failing?

Different problems, different evidence. Establish which one you have.

### Failing — HTTP 5xx

Grafana → **Explore** → **Prometheus**:

```promql
sum by (service_name) (rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m]))
```

Break it down to the exact endpoint:

```promql
sum by (service_name, http_route, http_response_status_code) (
  rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m])
)
```

### Slow — latency

```promql
histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket[5m])))
histogram_quantile(0.95, sum by (le, service_name, http_route) (rate(http_server_request_duration_seconds_bucket[5m])))
```

### Slow because of the database

The connection pool is the usual cause of "everything hangs but nothing is down":

```promql
db_client_connections_pending_requests          # queued waiting for a connection — should be 0
db_client_connections_usage
db_client_connections_max
rate(db_client_connections_timeouts_total[5m])  # any non-zero = pool exhausted
```

`pending_requests` above zero, or any increase in `timeouts_total`, means the pool is
exhausted — either a query got slow or something leaked connections.

### Slow because of the message queue

Complaints, notifications and indexing move through Kafka. A stuck consumer means complaints
are filed but never appear in the inbox or trigger a notification:

```promql
max by (service_name, client_id) (kafka_consumer_records_lag_max)
```

Lag that climbs without recovering is the signal — `egov-indexer`, `egov-persister` or
`novu-bridge` are the usual candidates.

### Slow — which part of the request?

Grafana → **`DIGIT — Traces (Tempo)`**:

- **"Slow traces — duration > 500ms"** — genuinely slow requests.
- **"Error traces (status = error)"** — requests that failed.

Click any row for the waterfall: which service, and which database call, consumed the time.
**Copy the Trace ID into the report** — it is the most useful single item for a slowness
escalation, and **traces are kept for 24 hours only**.

---

## The host itself (CPU, RAM, disk)

**Grafana → `Node Exporter Full`.**

> ### If this dashboard is empty
>
> Start with:
>
> ```promql
> up
> ```
>
> `job="node"` alongside `job="otel-collector"` means host metrics are fine and the problem
> is elsewhere. If only `otel-collector` comes back, work out which of the two causes you
> have — **check the cheap one first:**
>
> ```bash
> sudo docker ps --filter 'name=node-exporter' --format '{{.Names}}\t{{.Status}}'
> sudo grep -n 'job_name' /opt/digit/otel/prometheus.yml
> ```
>
> **Container up and `job_name: node` present** → Prometheus is running an older copy of its
> config. The file is bind-mounted, so it can change under a running Prometheus without it
> re-reading. Reload it in place — no restart, no downtime (`--web.enable-lifecycle` is
> already enabled):
>
> ```bash
> sudo docker exec digit-grafana curl -sS -XPOST http://prometheus:9090/-/reload
> ```
>
> Give it a few seconds, then re-run `up`. Confirm the target is actually healthy rather than
> merely configured:
>
> ```bash
> sudo docker exec digit-grafana curl -sS 'http://prometheus:9090/api/v1/targets?state=active'
> ```
>
> **No container and no `node` job** → `node-exporter` genuinely isn't installed. It was added
> to the platform on **2026-07-22**; older deployments that were never re-converged lack it.
> That is a redeploy, not a manual step — see
> [alerts-setup.md § Prerequisite](alerts-setup.md#prerequisite--turn-on-host-metrics).
> Until it's done, `df -h` over SSH is your only disk view.

| Panel | Concerning | Why it breaks things |
|---|---|---|
| **CPU Busy** | >90% sustained | Everything slows; health checks time out and services get killed as unhealthy |
| **RAM Used** | >90% | The Linux OOM killer starts killing containers, usually the largest JVM |
| **Swap** | any sustained use | Out of RAM; latency rises by orders of magnitude |
| **Disk Space Used** | >85% warn, >95% critical | **Postgres refuses writes when the disk fills — the most common cause of a total outage.** Docker logs and Elasticsearch indices are the usual culprits |
| **Disk IOPS / IO time** | pegged | Queries queue behind disk |
| **Load average** | above core count, sustained | More work queued than the box can do |

Disk fails slowly and then all at once, and it takes the database with it.

---

## Container logs — the usual reason the disk fills

Container logs are the single largest reclaimable thing on these boxes, and the cap on them
is easy to believe in and not actually have.

### How the cap is supposed to work

The Docker daemon is configured with log rotation in `/etc/docker/daemon.json`:

```json
"log-driver": "json-file",
"log-opts": { "max-size": "100m", "max-file": "10" }
```

That is **1 GB per container** (10 files × 100 MB), oldest rotated out. With ~44 containers
the ceiling is roughly **40 GB even when rotation is working correctly** — worth knowing when
sizing a disk, because it is not a small number.

### The catch: the cap only applies to containers created after it was set

Docker fixes a container's logging options **at creation time**. Changing `daemon.json` — or
restarting the daemon — does **not** retrofit the cap onto containers that already exist, and
neither does `docker restart`, which preserves the container's existing configuration. A
long-lived container created before the setting was applied will grow **without limit**.

Check how many containers are actually capped:

```bash
sudo docker ps -aq | while read c; do
  sudo docker inspect "$c" --format '{{.HostConfig.LogConfig.Config}}'
done | sort | uniq -c
```

`map[]` means **no cap on that container**. `map[max-file:10 max-size:100m]` means capped.

Find the offenders and who owns them:

```bash
# largest log files
sudo find /var/lib/docker/containers -name '*-json.log' -printf '%s\t%p\n' \
  | sort -rn | head -10 | awk -F'\t' '{printf "%8.1f MB  %s\n", $1/1048576, $2}'

# map a container id back to a name
sudo docker inspect <container-id> \
  --format '{{.Name}} created={{.Created}} logopts={{.HostConfig.LogConfig.Config}}'
```

> **This is not hypothetical.** On a box checked while writing this, container logs occupied
> **65 GB of a 301 GB disk** — 30 of 81 containers had no cap, and a single uncapped
> container's log had reached **54 GB** on its own. Reclaiming it moved the disk from 77% to
> around 55%.

### Corrective action

**1 — Reclaim the space now** (safe, and the only thing that is urgent when a disk is
filling). Truncate rather than delete: the file must keep existing for the running container.

```bash
sudo find /var/lib/docker/containers -type f -name '*-json.log' -exec truncate -s 0 {} +
```

Use the `find` form, not a shell glob — see
[Commands that are destructive](#commands-that-are-destructive). Note in your report that you
did this: it removes logs that would otherwise have been read, and anything not already
shipped to Loki is gone for good.

**2 — Make the cap stick.** The container has to be **recreated**, not restarted, for the
daemon's log options to apply. That is a redeploy — it recreates containers — so raise it with
us rather than removing containers by hand. Confirm afterwards with the `uniq -c` check above:
every container should show `max-file:10 max-size:100m`.

**3 — If one service is producing logs far faster than the rest**, that is a finding in its
own right, not just a disk problem. Report which service and the rate:

```logql
sum by (compose_service) (rate({compose_project="digit"}[5m]))
```

A service logging at debug level in production, or looping on an error, will refill the disk
within days of any cleanup.

---

## Raising CPU or memory for a service

When the evidence says a service is starved — OOM events, heap headroom under 10%, sustained
GC above ~0.2 s/s, or CPU pinned at `1.0` with no traffic — the fix is more resources. **This
is a deployment change, not something to apply on the box**, because anything edited under
`/opt/digit` is overwritten on the next deploy.

### What can actually be changed

| Limit | Where it lives | Notes |
|---|---|---|
| **JVM heap** (`-Xmx`) | `JAVA_TOOL_OPTIONS` or `JAVA_OPTS` per service in the compose file | This is the ceiling that actually causes `OutOfMemoryError`. Currently ~6.3 GB of heap is allocated across the JVM services |
| **Container memory** | not set today | The deployed compose has **no `mem_limit` on any container**, so a container can use as much host RAM as it asks for. Only the JVM heap bounds it |
| **Container CPU** | not set today | No `cpus` limit either — services compete freely for host CPU |
| **Host size** | your infrastructure | If the host itself is short of RAM or cores, no per-service change helps |

Two consequences worth understanding before asking for more:

- **Heap is not the whole footprint.** A JVM's actual memory use runs well above `-Xmx` —
  metaspace, thread stacks, code cache and direct buffers typically add a few hundred MB per
  service. Raising every heap by 512 MB costs the host considerably more than the sum of the
  increases.
- **With no container memory limit, a leak takes the host down rather than the container.**
  The Linux OOM killer then picks a victim, usually the largest JVM, which may not be the
  service at fault.

### What to send us

Raising a limit blindly moves the problem rather than fixing it, so include the evidence:

- **Which service**, and the heap figures from the JVM dashboard's *Right-sizing snapshot* —
  current, 1-hour peak, committed, limit, and headroom %.
- **Whether it OOMs or just runs hot.** An `OutOfMemoryError` in the logs is a different case
  from steady 85% heap usage.
- **How long it has been like this**, and whether it correlates with load, a data import, or a
  particular operation.
- **Host headroom** — total RAM and current usage from the Node Exporter dashboard. If the
  host is already at 90%, more heap is the wrong answer.

We will come back with a specific value rather than a guess, and it ships as a normal
redeploy.

---

## Symptom → playbook

| Symptom | Most likely | Check, in this order |
|---|---|---|
| **Site won't load at all** (browser error, not a DIGIT page) | nginx down, TLS certificate expired, DNS | Try the health dashboard URL — if that also fails, it's the edge, not DIGIT. Check certificate expiry in the browser padlock |
| **502 / 504 Bad Gateway** | Kong or the upstream service down or restarting | Health dashboard *API Gateway* + *Application* → restarts → Kong logs |
| **Login fails for everyone** | egov-user, the sign-in service, Redis, or accesscontrol | Health dashboard *Core Services* + the sign-in group → logs for `egov-user` and the sign-in containers |
| **Login fails for one user** | Wrong tenant, disabled account, role missing | Usually a data question rather than an outage — check the user in HRMS/Configurator |
| **OTP not received** | Notification/SMS provider, not DIGIT | Health dashboard *OTP* + *Notifications* → logs for `egov-user-proxy`, `novu-worker`. Check provider credit/credentials |
| **Complaint submit fails** | pgr-services, workflow, idgen, or Postgres | Browser Network tab → failing URL → that service's logs → Health dashboard *Infrastructure* |
| **Complaint filed but not in the inbox** | Indexing pipeline, not the write path | `kafka_consumer_records_lag_max`; logs for `egov-indexer`, `elasticsearch`, `inbox` |
| **Notifications not delivered** | Novu chain or provider | Health dashboard *Notifications* → logs for `novu-bridge`, `novu-worker` → provider console |
| **Dashboard / reports empty** | Analytics query, roles, or no data for the filter | Confirm with a second account and a wider date range first → logs for `pgr-services` → `pgr_analytics_query_duration_ms` |
| **Everything is slow** | Host CPU/RAM/disk, or the DB pool | Host panels → `db_client_connections_pending_requests` → Tempo slow traces |
| **Works for one city, not another** | Tenant configuration or data rather than code | File with both tenant codes so we can diff them |
| **A service restarts every few minutes** | OOM, failed health check, or a bad config/env value | OOM panels → that service's logs from the *first* boot attempt onward |
| **"No space left on device"** anywhere | Disk full — usually container logs | Host panels or `df -h`, then [Container logs](#container-logs--the-usual-reason-the-disk-fills). Postgres may already be refusing writes |
| **Disk climbing steadily with no new usage** | An uncapped container log | [Container logs](#container-logs--the-usual-reason-the-disk-fills) — check which containers lack the rotation cap |
| **A service is starved (OOM, low headroom, GC thrash)** | Under-provisioned heap | [Raising CPU or memory](#raising-cpu-or-memory-for-a-service) — gather the evidence, then raise it with us |

---

## Working on the server itself

The deployment lives in **`/opt/digit`** and runs as Docker Compose project `digit`. These
are the **read-only** commands:

```bash
# Which containers exist, and are any of them restarting?
sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

# Anything not "Up" — all six non-running states, not just the two obvious ones
sudo docker ps -a --filter 'status=created'    --filter 'status=restarting' \
                  --filter 'status=removing'   --filter 'status=paused' \
                  --filter 'status=exited'     --filter 'status=dead'

# Running but failing its own healthcheck — invisible to the command above
sudo docker ps --filter 'health=unhealthy'

# Live CPU / memory per container
sudo docker stats --no-stream

# Why did this container die? (exit code 137 = killed, usually OOM)
sudo docker inspect --format '{{.State.ExitCode}} {{.State.OOMKilled}} {{.RestartCount}}' <container>

# Recent logs from one container
sudo docker logs --tail 200 --timestamps <container>

# Disk
df -h
sudo du -h --max-depth=1 /var/lib/docker/containers | sort -h | tail -10
```

Container names follow two patterns — `digit-egov-user-1` (compose default) and
`boundary-service` (explicitly named). `sudo docker ps` shows the truth.

To restart **one** wedged service, use plain `docker restart` — **not** `docker compose`:

```bash
sudo docker restart <container>       # the name from `docker ps`, e.g. pgr-services
```

`docker restart` stops and starts the container that is already there, with the image,
environment and volumes it already has. It cannot recreate anything with the wrong
configuration, and it needs no knowledge of which compose files this deployment uses. For
"the service is stuck, bounce it" — the only restart an incident normally needs — this is
the right command.

> **Why not `docker compose restart`.** Compose only behaves correctly when handed the
> *exact* file stack the deployment was built with, and that stack varies per box: the
> monitoring overlay only exists on deployments made from 2026-07-22 onward, the fast-path
> overlay only when it was enabled, and some deployments carry a per-tenant overlay as well.
> A hard-coded `-f` list will either fail outright on a missing file or, worse, compute a
> configuration that differs from the one the box is running. If you need to check what this
> deployment actually has:
>
> ```bash
> ls /opt/digit/docker-compose*.y*ml
> ```
>
> Anything that genuinely requires re-reading configuration — an env change, a new image, an
> added container — is a **redeploy**, not a hand-assembled compose command. Raise it with us
> rather than reconstructing the stack by hand.

**Capture the logs before restarting** (`sudo docker logs --tail 500 <container> > /tmp/x.log`).
A restart clears the container's log buffer along with the symptom, and without it the next
step is usually reproducing the failure from scratch.

---

## Commands that are destructive

Worth reading once before working on the server — several of these are easy to reach for
during an incident and have no undo.

| Command | What actually happens |
|---|---|
| `docker compose down -v` | **Deletes every data volume — the entire Postgres database, MinIO files, Grafana dashboards and alert rules.** Complaints, users, everything |
| `docker system prune -a --volumes` | Same outcome by a different route |
| A bare `docker compose up -d` (no service names) | Revives the `default-data-handler` container, which re-seeds master data and can overwrite configuration. Always name the services |
| `docker compose up -d` with a partial `-f` list | Compose recomputes the stack from an incomplete definition and can recreate containers with the wrong image, env or volumes |
| Editing files in `/opt/digit` by hand | Overwritten on the next deployment. Config changes belong in the inventory |
| `rm` anything under `/var/lib/docker/volumes` | Silent, permanent data loss |
| Deleting Postgres WAL files to free space | Corrupts the database |

If a disk is full and you need space immediately, the safe target is Docker's log files
rather than volumes:

```bash
sudo find /var/lib/docker/containers -type f -name '*-json.log' -exec truncate -s 0 {} +
```

Note it in the report — it removes the logs that would otherwise have been read.

> Use the `find` form, not a shell glob. `/var/lib/docker/containers` is not readable by a
> normal user, so `sudo truncate … /var/lib/docker/containers/*/*-json.log` expands the
> wildcard in *your* shell before `sudo` runs, matches nothing, and fails. `find` runs
> under `sudo` and does the matching as root.

---

## Query cookbook

Paste into **Grafana → Explore** with the matching datasource. The fuller list, including
host queries, is in [reference.md](reference.md#query-cookbook).

```promql
# Which services are reporting at all
count by (service_name) (jvm_thread_count)

# Reporting 15 min ago but not now — i.e. something died
count by (service_name) (jvm_thread_count offset 15m) unless count by (service_name) (jvm_thread_count)

# Heap usage % per service
100 * sum by (service_name) (jvm_memory_used_bytes{jvm_memory_type="heap"})
    / sum by (service_name) (jvm_memory_limit_bytes{jvm_memory_type="heap"})

# Time spent in garbage collection (>0.2 = trouble)
sum by (service_name) (rate(jvm_gc_duration_seconds_sum[5m]))

# Server errors by service and endpoint
sum by (service_name, http_route) (rate(http_server_request_duration_seconds_count{http_response_status_code=~"5.."}[5m]))
```

```logql
# Error volume by service
sum by (compose_service) (count_over_time({compose_project="digit"} |~ `(?i)error|exception` [5m]))

# Service starts — repeats mean a restart loop
{compose_project="digit", compose_service!="loki"} |~ `Started .+Application in`

# Genuine out-of-memory events
{compose_project="digit", compose_service!~"grafana|loki"} |~ `(?i)outofmemoryerror|java heap space|gc overhead limit`

# Log rate per service — a spike or a drop to silence are both signals
sum by (compose_service) (rate({compose_project="digit"}[1m]))
```

---

## When to escalate to us

Send **Parts A + B + C** of [incident-report.md](incident-report.md) when:

- The cause is in product code or the data model rather than configuration.
- The fix needs a **deployment change** — more memory for a service, an extra container, a
  configuration value, node-exporter, an SMTP relay, a change to the Gatus catalogue.
- The same failure keeps recurring after a restart.
- You're about to do something on the destructive list above and want a second opinion.

If you worked all the way through and found nothing wrong, say exactly that — "all health
checks green, no ERROR lines in the 30 minutes around 14:05, no restarts in 24h" rules out
a large part of what we would otherwise check.

Anything you diagnose and fix is worth adding to [known-issues.md](known-issues.md) so it
lands with L1 next time.
