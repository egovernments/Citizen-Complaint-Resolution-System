# Known issues

Symptoms that have been seen before, with the resolution that worked. Check here **before**
diagnosing — if the symptom is listed, you may not need to investigate at all.

← back to **[Operations handbook](README.md)**

---

## How to use and grow this file

This starts small on purpose. It only contains things that have actually been observed and
resolved — nothing speculative. **Its value comes from your team adding to it**: every time
an incident is diagnosed, the symptom and the fix belong here, so the next occurrence is a
lookup rather than an investigation.

**About the "Applied by" column.** Which tier is permitted to apply which fix is your team's
decision, not ours — it depends on what access L1 has and how you'd rather run things. The
values below are a starting suggestion, assuming L1 has dashboards only and no server
access. Change them to match how you work, and treat the column as authoritative once you
have.

Two markers appear in that column because the fix needs access beyond the dashboards:

- **†** — needs an **admin login to the Configurator or HRMS**. These are screen-based tasks
  — creating users, fixing a role, adding a missing master-data entry — so where a team has
  decided that anything with a UI belongs to first line, they are L1's, and that is the usual
  split. The [first-response checklist](l1-first-response.md) does not *assume* the login
  exists, so confirm your service desk actually has it; without it these fall to L2 by
  default. Work that needs the backend — a database query, a container, a config file — stays
  with L2 regardless.
- **‡** — needs the **notification provider's console** (the SMS/WhatsApp account). Usually
  held by whoever owns the provider contract, which may be neither tier.

Worth settling both before an incident rather than during one.

A good entry has all five: the **symptom as a user describes it**, how to **confirm** it's
this and not something that looks like it, the **resolution**, who **applies** it, and the
**underlying cause** if known.

---

## Browser and account — no server involvement

| Symptom | Confirm it's this | Resolution | Applied by |
|---|---|---|---|
| One user sees errors everywhere, others fine | Works in a private window / on another account | Sign out fully and back in; clear site data for the domain | L1 |
| One user gets "unauthorised" or sees no menu items | Other users with the same role are fine | Check the user's roles and tenant in HRMS / Configurator; missing role assignment | L1 **†** |
| User can log in but their office's complaints are missing | Another user in the same office sees the same gap | Check the employee's jurisdiction/boundary assignment in HRMS | L1 **†** |
| Site "down" for one person only | Loads for you on another network | Their DNS or network. Test with a phone hotspot | L1 |

---

## Configuration and data — no code change

| Symptom | Confirm it's this | Resolution | Applied by |
|---|---|---|---|
| OTP or SMS not delivered, everything else works | Health dashboard *Notifications* green; `novu-worker` logs show a provider rejection | Provider account out of credit, or credentials expired. Check the provider console | L1 **‡** |
| A complaint type, department or locality is missing from a dropdown | Present for another tenant | Master data not seeded for that tenant — add it via the Configurator | L1 **†** |
| Dashboard or reports show nothing | Empty for a second account too, and for a wider date range | Usually a filter or a role scope, not a fault. If the date range is wide and roles are right, escalate | L1 |
| Works in one city, not another | Same action, two tenant codes, different outcome | Tenant configuration or data difference. Diff the two tenants' masters | L2 |

---

## Service-level — needs server access

| Symptom | Confirm it's this | Resolution | Applied by |
|---|---|---|---|
| Complaints are filed successfully but never appear in the inbox | **`DIGIT Kafka Consumer Lag`** shows lag climbing for `egov-indexer` and not draining; complaint exists via API | Indexing pipeline stalled — restart `egov-indexer`, then watch the same panel until lag drains. If "Consumers per group" is `0`, nothing is attached to the queue at all | L2 |
| Nothing is being indexed, notified or persisted — every pipeline at once | `redpanda_storage_disk_free_space_alert` above `0`, or **`Redpanda (Kafka) Broker` → storage** row showing little free | The broker is out of disk and has stopped accepting messages. Reclaim host disk first ([l2-diagnosis](l2-diagnosis.md#container-logs--the-usual-reason-the-disk-fills)); the broker recovers on its own once there is room | L2 |
| Everything is slow, database tiles green | **`PostgreSQL Database`**: Cache Hit Rate falling below ~99%, or Active sessions near Max Connections, or a non-draining Lock tables count | The database is the bottleneck. Which of the three it is decides the fix — see [l2-diagnosis](l2-diagnosis.md#slow-because-of-the-database). A restart clears the symptom, not the cause | L2 |
| One API returns 502/504, the rest are fine | **`Kong API Gateway` → Latencies**: Upstream time high while Kong Proxy Latency stays flat | The gateway is fine; the service behind it is slow or dead. Go to that service — the gateway is not the problem | L2 |
| Inbox unavailable immediately after a from-scratch deployment | Only on a first deploy; `digit-inbox` exited | Known start-order race — `docker start digit-inbox`. Does not recur on later deploys | L2 |
| A service is stuck restarting | `Started .+Application in` repeating for one service | Read that service's log from the *first* boot attempt. If it's an OOM, the heap needs raising — that's a deployment change, escalate | L2 |
| Everything slow, nothing red | `db_client_connections_pending_requests` above 0 | Connection pool exhausted. Identify the slow query or the leak; a restart clears the symptom, not the cause | L2 |
| Disk filling up | `df -h` above 85% | Container logs are the usual cause. Truncate to reclaim now: `sudo find /var/lib/docker/containers -type f -name '*-json.log' -exec truncate -s 0 {} +` (the `find` form is required — a shell glob expands before `sudo` and fails). This deletes logs you may still need. **Then check whether the rotation cap is actually applied** — it only takes effect on containers created after it was set, so long-lived containers can grow without limit. See [l2-diagnosis.md](l2-diagnosis.md#container-logs--the-usual-reason-the-disk-fills) | L2 |
| A monitoring service is down (grafana, prometheus, loki, tempo, gatus) | Its tile or dashboard is unavailable; complaints still work normally | Not a citizen-facing outage — nobody is blocked. But data generated while Loki, Prometheus or Tempo is down is **lost permanently**, so restart it promptly and note the gap. Restarting a monitoring container is safe | L2 |

---

## Not faults — expected behaviour that looks like one

Worth knowing so nobody spends an hour on them.

| Looks like | Actually |
|---|---|
| A whole Grafana dashboard is missing, not just empty — usually **DIGIT — Logs (Loki)** | This deployment runs a reduced **observability level**, so Loki (and possibly Tempo) was never deployed. A deployment decision, not a fault — see [README](README.md#how-much-monitoring-this-deployment-runs) |
| The **PostgreSQL**, **Redpanda** or **Kong** dashboard is a wall of unfamiliar jargon | Those three are imported from the upstream projects, so most of their panels are for tuning that software, not for incidents. [dashboards.md](dashboards.md#dashboards-imported-from-the-community) names the few panels that matter — ignoring the rest is correct, not lazy |
| A query returns "No data" | On error, deadlock, OOM and lag queries that is the **healthy** answer. To tell "zero" from "not collected", run `up` — it names the five collectors that should be reporting |
| A p95 latency panel shows `NaN` | No requests arrived in the window being measured, so there is no distribution to take a percentile of. Widen the time range |
| `Node Exporter Full` dashboard is completely empty | Either `node-exporter` isn't installed (deployments made before 2026-07-22), **or** it is running and Prometheus simply hasn't re-read its config. Not an incident either way — L2 tells them apart in one minute, and the second is fixed by a config reload with no downtime. See [alerts-setup.md](alerts-setup.md#prerequisite--turn-on-host-metrics) |
| An ad-hoc log search for "OutOfMemoryError" returns a hit from `grafana` or `loki` | Those tools log broad search text back into the stream. Filter them out. The **DIGIT JVM Services** OOM panels already restrict their selector to tracked JVM workloads and do not have this false positive |
| Elasticsearch logs mention "out of memory" | Routine circuit-breaker messages, not a crash |
| Every service restarts at the same time overnight | A scheduled redeploy, if this deployment has one. Confirm the window before treating it as an incident |
| PgBouncer green while PostgreSQL is red | Both are checked deliberately — the pooler accepts connections to a database that isn't answering. Treat as Infrastructure red |
| An *API Tests* tile is red while its service tile is green | The process is alive but its API is failing — usually data or configuration, not a crash |

---

## Template for new entries

```markdown
| Symptom as reported | How to confirm it's this one | What fixed it | Which tier |
```

Also record, in the entry or alongside it: **what caused it**, and whether a permanent fix
is outstanding on our side. An entry that keeps getting used is a signal the underlying
defect should be raised with us rather than worked around indefinitely.
