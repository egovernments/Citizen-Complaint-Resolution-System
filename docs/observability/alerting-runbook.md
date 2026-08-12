# Alerting runbook

What alerts exist, what each one means, and what to do when one fires.

Alerting ships **off**. Nothing here sends anything until someone sets a webhook — see [Turning it on](#turning-it-on). That is deliberate: an alert channel nobody reads is worse than no alerting, because it looks like coverage.

> **The rules this documents are not merged yet.** `local-setup/otel/grafana/provisioning/alerting/`
> (`rules.yaml`, `contactpoints.yaml`, `policies.yaml`) and
> `local-setup/tests/static/grafana-alerting.test.ts` arrive with **#1673**, stacked on
> **#1609** — a different branch chain from this one, so they are not in this PR's tree
> and will not be until both land. Every threshold, `noDataState` and `isPaused` value
> below was read off #1673's `rules.yaml`; the file paths are where those files will be.

---

## Who receives these

**Undecided at the time of writing.** No team or channel has been named.

That is a real gap, not a formality: every rule below assumes a human eventually looks. #1601 calls it a hard blocker in as many words — *"an alert stream with no named owner gets muted within a week"* — and names where it gets settled: **#1609 needs two decisions before it ships, which Slack channel and webhook, and who triages per tenant. #1611 reuses the same channel — decide once, in #1609.**

So the next step is not a new issue, it is **#1609**, and this page is where the answer lands:

- [ ] Owner / triage rota decided in **#1609**, then written into the table below.

| Tier | Channel | Owner | Decided in |
|---|---|---|---|
| Compose | *unset* | *unset* | #1609 |
| Ansible (per tenant) | *unset* | *unset* | #1609 |
| k3s | *unset* | *unset* | #1609 |

Do not turn alerting on for a tenant while those rows are empty — an unowned stream gets muted, and a muted channel silently disables every rule on this page, not just the noisy one.

There is no channel name anywhere in the repo, and there should not be. The channel is chosen by whoever mints the webhook; only the *owner* belongs in the table.

---

## Two engines, deliberately

| | Gatus | Grafana |
|---|---|---|
| Answers | *is it up?* | *is it about to stop being up?* |
| Source | HTTP/TCP checks | Prometheus + Loki |
| Fires on | a service not responding | disk, memory, CPU, JVM heap, Kafka lag, error floods |

**Gatus owns up/down. Grafana deliberately has no service-down rule.** Duplicating it would mean two messages per incident, which teaches people to ignore both. A test enforces this rather than trusting the comment.

---

## Turning it on

The webhook URL is a **credential** — anyone holding it can post into the channel. It is read from the environment in every tier and never committed.

**Compose**
```bash
# in .env
GATUS_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
GRAFANA_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

**Ansible** — set one value; Grafana falls back to the Gatus webhook, so a tenant picks a channel once:
```yaml
# host_vars/<tenant>.yml — prefer sourcing from OpenBao
gatus_slack_webhook_url: "https://hooks.slack.com/services/..."
```

**k3s** — an optional Secret; create it to switch alerting on, no manifest edit:
```bash
kubectl -n digit create secret generic gatus-alerting \
  --from-literal=slack-webhook-url='https://hooks.slack.com/services/...'
```

### Two behaviours that differ, and matter

**Gatus fails open.** An unset webhook becomes an empty string, Gatus logs `Ignoring provider=slack due to error=webhook-url not set`, drops the provider and keeps serving. Verified at runtime.

**Grafana fails closed.** It expands `$VAR` with no `${VAR:-default}` support, and treats provisioning it cannot validate as **fatal at startup**. An empty webhook makes it exit 1 with `recipient must be specified when using the Slack chat API` — it does not start.

That is why the Compose default is an unreachable `https://example.invalid/...` URL rather than an empty string. **Do not "tidy" it to empty.** If you see Grafana crash-looping after touching alerting config, this is the first thing to check.

---

## Gatus alerts

One alert per monitored endpoint, after **3 consecutive failures** (~90s at the 30s interval) — long enough that a single dropped check or a rolling restart does not page anyone. A recovery message follows.

**When one fires:** the alert names the endpoint and group. Check the Gatus board first (`/status/`) to see whether it is one service or many — many at once usually means the box, not the service.

---

## Grafana alerts

### Host disk low · `< 15% free on /` for 10m · warning

Fine until it abruptly is not: a full root filesystem takes down every service at once, and Postgres in particular fails in ways needing manual recovery.

Usual causes: Docker image/volume churn, and container logs if rotation is not capped.

```bash
df -h /
docker system df
du -sh /var/lib/docker/containers/* | sort -h | tail
```

### Host memory low · `< 10% available` for 5m · **critical**

Critical rather than warning because **these boxes have no swap**. The kernel does not degrade gracefully under pressure — it goes straight to OOM-killing, and it kills whichever JVM is largest, not whichever is least important. There is no slow middle ground between "tight" and "a service died".

```bash
free -m
docker stats --no-stream
dmesg -T | grep -i 'killed process'   # confirm whether it has already happened
```

### Host CPU saturated · `> 90%` for 15m · warning

Sustained, not a spike — 15 minutes rules out a deploy, a batch index or a JVM warming up. Past this point request latency is already degraded even though every health check still answers, so nothing else will tell you.

### JVM heap headroom low · `> 90% of limit` for 10m · warning

A service climbing toward its ceiling will eventually die and restart, dropping in-flight requests. Ten minutes above 90% means steady pressure rather than a GC sawtooth.

**Reading this one carefully:** the ratio is against `jvm_memory_limit_bytes`, so a service that never publishes a heap limit produces **no series and cannot trigger the rule**. Absence of this alert is not proof of headroom — check the *DIGIT JVM Services* dashboard.

### Kafka consumer lag high · `> 10k` for 15m · warning

The failure Gatus structurally cannot see: `egov-persister` falls behind, the API keeps returning 200, every check stays green, and complaints are **never written to the database**.

First question is *slow or gone*, and a dead consumer needs the opposite fix from a slow one.

**Neither the data nor the dashboard exists yet — both are #1623.** The rule's own description sends you to the *Consumers per group* panel on a *DIGIT Kafka Consumer Lag* board. That board arrives with **#1678**; `local-setup/otel/grafana/provisioning/dashboards/` currently holds only `jvm-services`, `node-exporter-full`, `loki-logs` and `tempo-traces` (plus `pgr-analytics`, once #1634 lands). The `redpanda_*` series it queries arrive with **#1628**, the Redpanda scrape job.

Read that order carefully, because it is the one place on this page where `noDataState: OK` lies. Until #1628 lands, this rule evaluates an empty vector and reports a healthy **ok** that is indistinguishable from "lag is fine" when it actually means *nothing is being measured*. It ships unpaused anyway, deliberately, so it starts working the moment the scrape job appears rather than waiting on someone remembering to unpause it — but do not read a green Kafka rule as evidence the persister is keeping up until #1628 is in the tree.

Meanwhile, answer *slow or gone* from the broker instead — the same call `digit-mcp`'s `kafka_lag` tool makes:

```bash
docker exec digit-redpanda rpk group describe egov-persister
```

`LAG` per partition, and an empty member list means gone. Lag concentrated on a single partition usually means a poison record, not an undersized consumer.

10k/15m is deliberately loose — bulk seeding and migrations move real backlogs through legitimately, and they drain.

### Log error spike · **ships paused**

Catches a service answering `/health` perfectly while failing every real request — green dashboard, nothing works.

**It is paused on purpose and must be tuned before use.** Its threshold cannot be derived from first principles: DIGIT services log exception stack traces during entirely normal operation. Shipped live with a guessed number it would either cry wolf until someone mutes the channel — silently disabling every *other* rule for that person — or never fire, which looks exactly like "no errors".

**To enable:**
1. On a real tenant, watch for about a week:
   ```
   sum by (service_name) (count_over_time({service_name=~".+"} |~ "(?i)ERROR|Exception" [5m]))
   ```
2. Take the observed p95 and set the threshold comfortably above it.
3. Set `isPaused: false` in `local-setup/otel/grafana/provisioning/alerting/rules.yaml`.

Do not skip step 1.

---

## Why every rule reports OK on missing data

`noDataState: OK` throughout. node-exporter ships in the `docker-compose.monitoring.yml` **overlay**, JVM metrics need the OTEL pipeline, and below `observability_level: metrics` several of these components are not deployed at all — so "no data" usually means *this deployment does not run that component*, a valid configuration rather than an incident.

Alerting on it would put a permanent, unfixable alert in the channel, and a channel with a permanent alert gets muted — which disables every other rule too.

**The cost of that choice: an OK is not a positive signal.** A rule reading ok means *either* healthy *or* not measured, and nothing distinguishes them from the channel. The Kafka lag rule is the live example — see above; it will report ok until #1628 gives it data. Confirm a rule has series behind it before treating its silence as reassurance.

**And nothing catches a monitoring component that has genuinely died.** That is meant to be Gatus's job, but Gatus does not check any of them: `grafana`, `prometheus`, `loki`, `tempo`, `otel-collector`, `node-exporter` and `promtail` are all exempted in `.github/scripts/check-gatus-coverage.py` as observability plumbing. Closing that is **#1613**, which has no PR. Today a dead Prometheus is discovered by noticing the graphs stopped.

`execErrState` stays at `Alerting`: a query that *errors* is a broken rule, and that is worth surfacing.

---

## Changing the rules

They are provisioned files, so they are **read-only in the Grafana UI** — edit `local-setup/otel/grafana/provisioning/alerting/rules.yaml` and redeploy.

Two traps:

- **Provisioning the policy tree replaces it wholesale.** Anything created through the UI is overwritten on restart.
- **A malformed rule file does not degrade alerting — it stops Grafana starting.** There is no `grafana --check-config`, which is why `local-setup/tests/static/grafana-alerting.test.ts` asserts the invariants in CI. Run it before deploying:
  ```bash
  cd local-setup/tests && npx jest static/grafana-alerting
  ```

---

## Related

- `enabling-monitoring.md` — which components to deploy and how
- `dashboard-metrics.md` — what the dashboard instrumentation measures
