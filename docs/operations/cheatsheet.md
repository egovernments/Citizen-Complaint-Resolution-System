# Cheat sheet

One page. Print it, or pin it in the alert channel.

← full handbook: **[README.md](README.md)**

---

## URLs

| | |
|---|---|
| Health dashboard | `https://<your-domain>/status/` |
| Grafana | `https://<your-domain>/grafana/` |
| Logs | `https://<your-domain>/grafana/d/digit-loki-logs/` |
| Service metrics | `https://<your-domain>/grafana/d/digit-jvm/` |

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
              Empty dashboard = host metrics not installed. Not a fault.
```

---

## Escalate immediately, don't finish the ladder

- Infrastructure red on the health dashboard
- Nobody can log in, or the site doesn't load
- No complaint can be filed by anyone
- "No space left on device" anywhere

Screenshot the health dashboard first, then hand over.

---

## Two queries worth memorising

Grafana → **Explore** → **Loki**:

```logql
# Is anything stuck restarting? (one line per service boot)
{compose_project="digit", compose_service!="loki"} |~ `Started .+Application in`

# Which service is producing the most errors right now?
sum by (compose_service) (count_over_time({compose_project="digit"} |~ `(?i)error|exception` [5m]))
```

---

## Evidence expires

| Traces | 24 hours |
|---|---|
| **Logs** | **72 hours** |
| **Metrics** | **15 days** |
| **Health-check history** | **lost on restart — screenshot it** |

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
| L2 contact | |
| Escalation channel | |
| Vendor escalation | |
| Deployment / maintenance window | |
