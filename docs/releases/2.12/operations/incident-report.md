# The incident report

One document, filled in three stages. **Part A** travels from L1 to L2, **Part B** is added
during diagnosis, and **Part C** is added when it comes to us. Nothing is re-typed at a
handover, and a blank section shows immediately where the ticket is.

← back to **[Operations handbook](README.md)** · L1 checklist:
**[l1-first-response.md](l1-first-response.md)** · L2 runbook:
**[l2-diagnosis.md](l2-diagnosis.md)**

---

## Why the detail helps

We cannot see your deployment. Every question we have to come back with adds a round trip,
and across timezones that is usually a day. A report carrying Parts A–C is normally enough
for us to identify the cause without a further exchange.

Bear in mind too that **the evidence expires**: traces last 24 hours, logs 72 hours, metrics
15 days. A report filed today with a few gaps beats a thorough one filed next week, when the
logs have rolled off.

---

## Part A — captured at first response

Everything here comes from [l1-first-response.md](l1-first-response.md). This is the
handover to L2, and it is also the top of the report if it later reaches us.

```
SEVERITY: [S1 Critical / S2 Major / S3 Minor / S4 Question]
DEPLOYMENT: [domain, e.g. digit.yourdepartment.gov]
TENANT / CITY: [tenant code(s) affected, e.g. <state>.<city> — or "all"]
LOGGED BY: [name + how to reach you]

--- WHAT ---
1. What action fails:
   [As specific as you can be, e.g. "A citizen taps Submit on the new-complaint
    form." The narrower the action, the faster it can be reproduced.]

2. What happens instead:
   [Exact error text on screen, or "spins forever", or the HTTP status.
    If available from browser dev tools (F12 -> Network): the failing request
    URL and status code.]

3. What should happen:
   [One line.]

--- WHEN ---
4. First noticed:            [date + time + TIMEZONE]
5. Last known working:       [date + time + TIMEZONE, or "unknown"]
6. Still happening now?      [yes / no / intermittent]
7. Reproducible on demand?   [yes — steps below / no / sometimes]
8. Anything change around then?
   [deployment, config change, data import, power/network event, new user batch,
    certificate renewal. "Nothing that we know of" is a valid and useful answer.]

--- WHO ---
9.  Scope:            [one user / one office / one city / everyone]
10. Verified how:     [private window? second account? different network?
                       e.g. "tried 3 accounts in 2 offices, all fail"]
11. Numbers affected: [approximate is fine]

--- WHAT THE DASHBOARDS SHOW ---
12. Health dashboard (/status/):
    [ ] all green   [ ] red tiles: __________________________
13. Restarts in the last 24h ("Started ... Application" query):
    [ ] none        [ ] yes: service ________ at ________
14. OOM events in the range:
    [ ] none        [ ] yes: service ________
15. First ERROR seen in the logs before the symptom:
    [paste 5-20 lines with timestamps, and note the service + time range used.
     The FIRST error, not the last. "No ERROR lines between HH:MM and HH:MM"
     is a useful answer too.]

--- KNOWN ISSUE? ---
16. Checked known-issues.md:  [ ] not listed   [ ] listed, resolution didn't work
                              [ ] listed, needs a tier that can apply it

--- REPRODUCTION (if reproducible) ---
[numbered steps, starting from login, including the role/user type used]

--- ATTACHED ---
[ ] Health dashboard screenshot (if anything is red)
[ ] Screenshot of the failing screen, ideally with dev-tools Network tab open
[ ] Log excerpt as TEXT + the query and time range used
[ ] Complaint number / user ID involved
```

---

## Part B — added during diagnosis

Filled in by whoever works [l2-diagnosis.md](l2-diagnosis.md).

```
--- LAYER ---
17. Which layer:  [ ] edge  [ ] application  [ ] core platform
                  [ ] backbone (db/cache/broker)  [ ] host  [ ] not established

--- FINDINGS ---
18. Suspect service, and why:
    [e.g. "egov-indexer — kafka lag climbing since 09:12, never drains"]

19. First error traced to its origin:
    [the earliest error in the responsible service, with timestamp — not the
     downstream error that surfaced first]

20. Restart / crash history for that service (last 24h):
    [`DIGIT JVM Services` -> "Heap used (MB)", or the "Started ... Application" log query]

21. Memory: heap %, headroom, OOM events:
    [`DIGIT JVM Services` -> "Right-sizing snapshot" + "OOM events (current range)"]

22. Host state:                                    [`Node Exporter Full`]
    [ ] normal  [ ] CPU ____  [ ] RAM ____  [ ] disk ____
    [ ] host metrics unavailable (no `node` job — see l2-diagnosis.md)

23. Database — pool AND server side:
    Pool (what services see):  db_client_connections_pending_requests ____  timeouts ____
    Server (`PostgreSQL Database` dashboard):
      active sessions ____ / max ____ · cache hit ____% · deadlocks ____ · longest tx ____s
    [Both halves matter: a saturated pool with an idle database is a leak, not a slow
     database, and the two have completely different fixes.]

24. Pipelines, if relevant:                        [`DIGIT Kafka Consumer Lag`]
    lagging group ____  lag ____  consumers attached ____
    [Consumers attached = 0 means nothing is processing that queue at all.]
    Broker disk:  redpanda_storage_disk_free_space_alert ____   (0 = OK, 1 = low, 2 = degraded)

25. Gateway, for any 5xx or slowness:              [`Kong API Gateway` -> Latencies]
    upstream p95 ____ms · kong proxy p95 ____ms · failing service/route ____
    [Upstream high with proxy flat = the service is at fault, not the gateway.]

--- ACTIONS TAKEN ---
26. What was tried, with times:
    [Restarting to get users moving is usually the right call — just record it,
     because it changes what the logs show.]

27. Did it resolve the symptom?  [yes / no / temporarily]

28. Anything captured before the restart?  [log files, screenshots — attach them]
```

---

## Part C — added when escalating to us

```
--- HYPOTHESIS ---
29. What you believe is happening, and what rules out the alternatives:

30. Why this needs us rather than a config change:
    [ ] product code / data-model defect
    [ ] deployment change needed (heap size, extra container, env value,
        node-exporter, SMTP relay, Gatus catalogue)
    [ ] recurs after restart, cause not found
    [ ] not sure — need a second opinion

--- EVIDENCE ---
31. Trace ID(s), for anything about speed:      [within 24h or they're gone]
32. Failing endpoint (http_route) + status code:
33. Log excerpts, as text, with time ranges:
34. Grafana panel screenshots for anything anomalous:
    [Name the dashboard and the time range on each one. The panels we ask for most:
     `DIGIT JVM Services` right-sizing snapshot, `Node Exporter Full` disk,
     `PostgreSQL Database` cache hit + deadlocks, `Kong API Gateway` latencies,
     `DIGIT Kafka Consumer Lag` total lag. See dashboards.md]

--- IMPACT ---
35. Business impact:
    [One or two lines. "The central office cannot register walk-in complaints;
     ~40 citizens turned away since 09:00." This is what tells us how to
     prioritise it.]

36. Workaround in place?  [what it is, and what it costs]
```

---

## The evidence checklist

Attach **text**, not photographs of screens — text can be searched.

### Always

1. **Health dashboard screenshot** — if something is red. Gatus keeps its history on disk
   now, so it survives a restart, but it only holds about the last 100 results per endpoint
   — on a flapping check that is a couple of hours. Capture it while you can see it.
2. **The failing request** — browser F12 → **Network** → reproduce → click the red row →
   screenshot showing the **URL, status code and response body**. This one attachment
   identifies the responsible service more often than anything else.
3. **The log excerpt** — see below.

### The log excerpt (how to get it as text)

In Grafana → **Explore** → datasource **Loki**:

1. Set the time range to **10 minutes before** the symptom through **5 minutes after**.
2. Run the query — start broad, narrow if it is too much:
   ```logql
   {compose_project="digit"} |~ `(?i)error|exception|timeout|refused`
   ```
   or for one service:
   ```logql
   {compose_service="pgr-services"} |~ `(?i)error|exception`
   ```
3. Use the **Download logs** button (top right of the logs panel) → **txt**, or select and
   copy the lines.
4. **Send the query and the time range you used**, along with the output. If the query found
   nothing, that is a finding — send it so we know what was ruled out.

Rules of thumb: **the first error, not the last** (everything after the first is usually
cascade). **20 lines of context around it**, not 5000 lines of everything. **Timestamps
included** — a log line without a timestamp is nearly useless.

### For "it's slow" reports

**Answer "which half?" first** — it decides everything else, and it takes one panel:

- **`Kong API Gateway` → Latencies row.** Send both numbers: **Upstream time** (the service
  behind the gateway) and **Kong Proxy Latency** (the gateway itself). Upstream high with
  proxy flat means the service is at fault; both flat means the delay is not in the API layer
  at all.
- **`PostgreSQL Database`** — cache hit rate, active sessions vs Max Connections, and the
  Conflicts/Deadlocks panel. This is what tells a genuinely busy database apart from a leaked
  connection pool.
- A **Trace ID** from Grafana → `DIGIT — Traces (Tempo)` → **Slow traces** panel → click a
  row → copy the ID. Within 24 hours, or it is gone.
- Screenshot of the **95th-percentile latency** query from
  [l2-diagnosis.md](l2-diagnosis.md#slow--latency).
- `db_client_connections_pending_requests` — the current value.

### For "it saved but never appeared" reports

Complaint filed and confirmed, but not in the inbox / no notification / not in reports. The
write path worked and a background pipeline did not, so the evidence is different:

- **`DIGIT Kafka Consumer Lag`** — which group is behind, whether the lag is climbing or
  draining, and **"Consumers per group"** (zero means nothing is processing that queue).
- The **complaint number**, and the output of tracing it across services: paste it into the
  **q** box on `DIGIT — Logs (Loki)` with service `.+`.
- `redpanda_storage_disk_free_space_alert` — if the broker is out of disk, every pipeline
  stalls at once and the individual consumer is not the fault.

### For "the supervisor dashboard is slow" reports

- **`DIGIT — PGR Analytics Queries` → "Slowest KPIs by mean duration"** — which measurement,
  and for which tenant and grain.
- **"Rows scanned per second"** — this says whether the query got worse or the city simply
  got bigger, which are different problems with different answers.

### For "the site is down" reports

- Does `https://<your-domain>/status/` load at all? (If not, it is the edge or the network,
  not DIGIT.)
- The output of, from any machine:
  ```bash
  curl -sS -o /dev/null -w 'http=%{http_code} dns=%{time_namelookup}s connect=%{time_connect}s total=%{time_total}s\n' https://<your-domain>/
  ```
- Certificate expiry — click the padlock in the browser. An expired certificate looks
  exactly like an outage to users.

### For "notifications not delivered"

- Which channel (SMS / email / WhatsApp), which recipient (**redacted** — see below), which
  complaint number, what time.
- `novu-bridge` and `novu-worker` logs for that minute.
- Whether the provider account still has credit and valid credentials. Worth checking first
  — expired credentials and exhausted credit account for a good share of these reports.

### If you have server access — the one-shot evidence bundle

Read-only. Produces one tarball to attach. Run it while the problem is happening, and
**before** any restart:

```bash
#!/usr/bin/env bash
# DIGIT evidence bundle — read-only, safe to run during an incident.
set -u
OUT="/tmp/digit-evidence-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
{
  date -Is
  echo "--- uptime/load ---";        uptime
  echo "--- disk ---";               df -h
  echo "--- inodes ---";             df -i
  echo "--- memory ---";             free -h
  echo "--- top ---";                top -b -n1 | head -25
} > "$OUT/host.txt" 2>&1

sudo docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' > "$OUT/containers.txt" 2>&1
sudo docker stats --no-stream                                          > "$OUT/stats.txt" 2>&1

# Exit code, OOM flag and restart count for every container
for c in $(sudo docker ps -aq); do
  sudo docker inspect --format \
    '{{.Name}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} started={{.State.StartedAt}}' \
    "$c"
done > "$OUT/container-state.txt" 2>&1

# Last 30 minutes of logs from every container
mkdir -p "$OUT/logs"
for c in $(sudo docker ps -a --format '{{.Names}}'); do
  sudo docker logs --since 30m --timestamps "$c" > "$OUT/logs/$c.log" 2>&1
done

if ! tar czf "$OUT.tar.gz" -C /tmp "$(basename "$OUT")"; then
  echo "FAILED to create the evidence bundle. Raw files left in: $OUT" >&2
  exit 1
fi
rm -rf "$OUT"
echo "Attach this file: $OUT.tar.gz"
```

**Read the logs before sending them** — see redaction below.

---

## Redaction — what not to send us

This is a citizen complaint system. Its logs and screens contain **personal data of members
of the public**: names, phone numbers, addresses, national ID numbers, and the text of
complaints, which can be sensitive in itself. Incident handling sits inside your data
protection obligations, not outside them, so a little care with attachments goes a long way.

| Keep it — we need it | Redact it |
|---|---|
| Complaint numbers (`PGR-2026-...`) | Citizen names |
| User **UUIDs** | Phone numbers, email addresses |
| Tenant / city codes | Physical addresses, GPS coordinates |
| Service names, timestamps, stack traces | National ID / passport numbers |
| HTTP status codes, URLs, trace IDs | The complaint description text |
| Error messages and exception classes | Photographs attached to complaints |

Replace rather than delete, so the flow is still followable:
`phone=+254712345678` → `phone=<REDACTED-1>`, using the same placeholder for the same value
throughout.

Two specific traps:

- **Screenshots leak more than you think** — a browser tab bar, an inbox behind a modal, a
  name in the corner. Crop, or blur.
- **OTP and login flows log phone numbers.** If you are sending `egov-user` or `novu-worker`
  logs, scan for them.

**Never send us:** passwords, API keys, `.env` files, database dumps, or any service's client
secrets. If you think we need a credential to diagnose something, say so and we will arrange
a proper channel — do not paste it into a ticket or a chat.

---

## Where to send it

1. **The agreed support channel**, with the severity in the subject line:
   `[S1] <city> — complaint submission failing for all users since 09:15 EAT`.
2. **For S1, also use the escalation phone path.** Outside working hours a chat message on
   its own may not be seen for some time.
3. **One thread per incident.** Add updates to the same thread rather than opening new ones
   — recovery, workarounds tried, changes in scope.

Tell us in the thread when it **resolves on its own**, too. A problem that fixed itself is
still a problem, and it is much easier to diagnose while the logs still exist.

---

## What happens next

We will normally come back with one of:

- **A diagnosis and a fix** — a configuration change, a restart with specific instructions,
  or a code change scheduled for a release.
- **A workaround plus a longer fix** — so users are unblocked meanwhile.
- **A request for one specific extra thing.** If we find ourselves asking for more than one,
  this template has a gap — tell us and we'll fix the document.

What helps us most, in rough order:

1. The **exact time with timezone**, and whether it still happens.
2. The **first** error line, with its timestamp.
3. The **failing request** from the browser Network tab.
4. Confirmation of **scope** — tested with more than one account.
5. The trace ID, for anything about speed.

And what tends to add a round trip: log excerpts sent as photographs rather than text (we
can't search them), reports where the evidence was captured after a restart, and reports
that arrive several days later, once the logs have rolled off. None of these are blockers —
send what you have and we'll work with it.

Once an incident is closed, if the cause and fix are worth remembering, add them to
[known-issues.md](known-issues.md).
