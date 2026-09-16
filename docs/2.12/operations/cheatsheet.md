# Cheat sheet

One page. Print it, or pin it in the alert channel.

← full handbook: **[README.md](README.md)**

---

## URLs

| | |
|---|---|
| Health dashboard | `https://<your-domain>/status/` — no login |
| Grafana | `https://<your-domain>/grafana/` — **login required**, your own account (admin creates it, Editor role) |
| Logs | `https://<your-domain>/grafana/d/digit-loki-logs/` |
| Service metrics | `https://<your-domain>/grafana/d/digit-jvm/` |

## The other five dashboards (L2)

| Question | Dashboard |
|---|---|
| Is the server out of disk / RAM? | `d/node-exporter-full/` |
| Is the database the bottleneck? | `d/postgres-database/` |
| Gateway, or the service behind it? | `d/kong-gateway/` → **Latencies** row |
| Which pipeline is stuck? | `d/kafka-consumer-lag/` |
| Does the broker have disk? | `d/redpanda-broker/` → **storage** row |
| Why is the supervisor dashboard slow? | `d/pgr-analytics/` |

What each panel means: **[dashboards.md](dashboards.md)**.

---

## The ladder

Steps 0–4 are the [first-response checklist](l1-first-response.md) — browser only, nothing
changes state. Step 5 onward is [diagnosis](l2-diagnosis.md).

```
 0. DETAILS   What action, what happened instead, when, which city, complaint number.
    │
    ▼
 1. SCOPE     Private window + second account + different network.
    │         Works for you? → their machine.  Fails for you too? → continue.
    ▼
 2. HEALTH    /status/     Any red tile? Screenshot it NOW — this page keeps no history.
    │                      Infrastructure red → stop, escalate.
    ▼
 3. RESTARTS  Grafana → DIGIT JVM Services → "OOM events (current range)" above 0?
    │         Then Explore → Loki, the restart query below.
    │         Same service repeating = stuck restarting. Mind the maintenance window.
    │         Record what you saw — reading the heap graphs is L2's job.
    ▼
 4. ERRORS    Grafana → DIGIT — Logs (Loki)
    │         Time range = 10 min BEFORE it started. level = ERROR.
    │         Copy the OLDEST error, not the newest.
    │
    ├──────▶  Known issue? → known-issues.md, resolve, log it.
    └──────▶  Otherwise → hand over Part A of incident-report.md.
    ▼
 5. DEEPER    Layer model, slow-vs-failing, DB pool, Kafka lag, traces  → l2-diagnosis.md
 6. HOST      Grafana → Node Exporter Full   (CPU / RAM / disk)
              Empty dashboard = host metrics not being collected. Not a fault — tell L2.
```

---

## Escalate immediately, don't finish the ladder

- Infrastructure red on the health dashboard
- Nobody can log in, or the site doesn't load
- No complaint can be filed by anyone
- "No space left on device" anywhere

Screenshot the health dashboard first, then hand over.

---

## Queries worth memorising

Grafana → **Explore** → **Loki** (needs `logs` level or higher — see below):

```logql
# Is anything stuck restarting? (one line per service boot)
{compose_project="digit", compose_service!="loki"} |~ `Started .+Application in`

# Which service is producing the most errors right now?
sum by (compose_service) (count_over_time({compose_project="digit"} |~ `(?i)error|exception` [5m]))
```

Grafana → **Explore** → **Prometheus** (works at every observability level):

```promql
# Which collectors are reporting? Expect: otel-collector, node, postgres-exporter, redpanda, kong
up

# Which service died in the last 15 minutes
count by (service_name) (jvm_thread_count offset 15m) unless count by (service_name) (jvm_thread_count)
```

> **"No data" usually means zero, not broken.** On error, deadlock and lag queries a healthy
> deployment returns nothing. `NaN` on a p95 means no requests in that window — widen it.

---

## This deployment's observability level

The level decides which of the above you actually have. **Fill it in.**

| Level | Logs (Loki) | Traces (Tempo) |
|---|---|---|
| `metrics` | ✗ | ✗ |
| `logs` | ✓ | ✗ |
| `traces` *(default)* | ✓ | ✓ |

**Ours is: ______________**  ← ask L2 once, write it here

On `metrics` there is no log search at all: Step 4 of the checklist does not apply, and the
two LogQL queries above will not run. That is a deployment decision, not a fault.

---

## Evidence expires

| Traces | 24 hours |
|---|---|
| **Logs** | **72 hours** |
| **Metrics** | **15 days** |
| **Health-check history** | survives restarts (SQLite); ~100 results / 50 events per endpoint |

---

## Never run

```
docker compose down -v            → deletes the database and every volume
docker system prune -a --volumes  → same
docker compose up -d              → without service names, re-seeds master data
```

---

## Capture before you restart

A restart usually clears the symptom and the logs together.

```bash
sudo docker logs --tail 500 --timestamps <container> > /tmp/evidence.log
```

---

## Where things live

| | |
|---|---|
| L1 checklist | [l1-first-response.md](l1-first-response.md) |
| L2 diagnosis | [l2-diagnosis.md](l2-diagnosis.md) |
| Known issues | [known-issues.md](known-issues.md) |
| Report template | [incident-report.md](incident-report.md) |
| Lookup / glossary | [reference.md](reference.md) |

---

## Fill these in for your deployment

| | |
|---|---|
| Domain | |
| Grafana account created by (admin) | |
| Observability level (`metrics` / `logs` / `traces`) | |
| L2 contact | |
| Escalation channel | |
| Vendor escalation | |
| Deployment / maintenance window | |
