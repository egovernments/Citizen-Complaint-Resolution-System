# Enabling monitoring

How much monitoring to run, what each part costs, and how to turn parts on and off — on both deployment tiers.

Written for the question an operator actually has: **"how much can I afford, and what do I lose if I skip a piece?"**

> **One thing here has not merged yet.** Grafana alert *rules*, contact points and the
> alerting test (`local-setup/otel/grafana/provisioning/alerting/`) arrive with **#1673**,
> stacked on **#1609**. Until that lands, a deployed Grafana has **zero alert rules** and one
> placeholder contact point — see
> [../2.12/operations/alerts-setup.md](../2.12/operations/alerts-setup.md) for what to build in the
> meantime, and note that **Gatus endpoint alerting has shipped** and needs only a webhook
> URL.
>
> Everything else described below is on `master`: `observability_level` and the `obs-*`
> compose profiles (#1657), the CI helm-values check (#1652), and the Kubernetes tier's
> wired-in helmfile with its `monitoring.*` toggles (#1675).

---

## The two tiers are different

| | Ansible / Docker Compose | `deploy-as-code` (Helm) |
|---|---|---|
| Used for | **small-scale** deployments, one tenant per box | **large-scale**, production Kubernetes |
| Lives in | `local-setup/` | `devops/deploy-as-code/` |
| Monitoring is | **on by default**, sized by `observability_level` | **off by default** — six per-component booleans, all `false` |

If you only run one of them, read only that section.

---

## What each component gives you

The same components appear on both tiers under different names. What matters is what each answers, and what you give up without it.

| Component | Answers | Without it |
|---|---|---|
| **Gatus** (compose) / **blackbox** (k8s) | Is it up? Can a citizen reach it? | You find out from users |
| **Prometheus** + **node-exporter** | Is the box healthy? Is something leaking memory? Is the disk filling? | No capacity signal and no trend — you see the outage, never the run-up to it |
| **Grafana** | Somewhere to look | The data exists and nobody can read it |
| **Loki** + **Promtail** | What did it actually say when it broke? | Errors are unreachable without SSH |
| **OTEL collector** + **Tempo** | Where did this request spend its time, across services? | Cross-service latency is guesswork |

Two things worth knowing before you choose:

- **The collector is not only for traces.** JVM metrics travel OTLP → collector → `:8889`, which is what Prometheus scrapes, so it is not something a metrics-only site can skip — which is why the Ansible tier runs it unconditionally rather than putting it in a level. **Tempo** is the only traces-exclusive component.
- **Gatus tells you *that* something is down; the rest tell you *why*.** Uptime checks alone are a smoke alarm with no thermometer.

---

## Ansible tier: `observability_level`

Set it in `host_vars/<tenant>.yml`. Levels are **cumulative** — each includes the one above.

| Level | Adds | Footprint |
|---|---|---|
| `metrics` | Prometheus, node-exporter, Grafana | ~1.2 GB |
| `logs` | + Loki, Promtail | ~1.8 GB |
| `traces` **(default)** | + Tempo | ~2.2 GB |

**Gatus and the OTEL collector are not in any level — they always run.** Gatus is the
uptime board and is cheap; the collector is the pipeline every instrumented service
emits *into*, so it is needed at every level, and profiling it was reverted in #1687
(see below). The levels gate what *consumes* telemetry, not what receives it. Their
cost (~384 MB of the ~1.2 GB above) is therefore a floor, not something a level can
remove.

```yaml
# host_vars/mytenant.yml — keep metrics, skip log and trace storage
observability_level: metrics
```

**Why this knob exists.** These boxes are small. 29 services declare roughly **12.8 GB** of configured JVM heap on machines that are commonly 16 GB, and the boxes have **no swap** — so memory pressure means the kernel starts killing processes rather than slowing down. Log and trace storage is where the observability cost concentrates, and skipping it is a legitimate choice.

**Footprints are budgets on paper, not measurements — and not yet enforced.** They are
the sum of the per-container caps **proposed** in #1612. That issue is still open, so
no observability container in `local-setup/` carries a `mem_limit` today; every one of
them runs uncapped. Read the numbers as "what this tier is meant to be allowed", not as
what it will use, and not as a limit the box imposes.

<details>
<summary>These numbers differ from the ones in #1601 — why</summary>

The umbrella issue quotes *uptime ~64 MB, +metrics ~900 MB, +logs ~1.5 GB, +traces
~2.2 GB*. Both sets add up the same #1612 caps; they disagree about which tier the OTEL
collector (320 MB) belongs to.

#1601 counted it under *traces*, the natural assumption. #1657 moved it to *metrics*,
because JVM metrics travel OTLP → collector → `:8889` and Prometheus scrapes that — a
site on `metrics` needs the collector or it gets no per-service metrics at all. That one
reclassification is the whole gap: 896 + 320 = 1216 (~1.2 GB) instead of ~900 MB, and
1536 + 320 = 1856 (~1.8 GB) instead of ~1.5 GB. The endpoints match because the total
is unchanged (2240 MB) and *uptime* contains neither.

**#1687 then moved it out of the tiers entirely** — see below. The three numbers in the
table are unaffected, because the collector is included at every one of them either way.
The `uptime` figure is the casualty: a Gatus-only level would still run the collector,
so its floor is ~384 MB, not ~64 MB.

</details>

**There is still no Gatus-only level**, and the reason has changed. It *was* that 16
application services declare `depends_on: otel-collector`, so a level omitting the
collector risked failing the deploy rather than shrinking it. #1687 removed the
collector's profile altogether — 12 of those 16 dependents are themselves unprofiled,
and Compose rejects the entire project when a selected service depends on one excluded
by a profile, which broke every ad-hoc `docker compose` command (`config`, `ps`, `logs`,
`up`) for anyone who had not exported `COMPOSE_PROFILES`. So the deploy risk is gone,
but so is most of the saving: an `uptime` level would still run the collector.

### Verifying it did what you asked

```bash
docker compose ps --format '{{.Name}}' | sort     # which containers actually started
grep -E 'OTEL_(TRACES|METRICS)_EXPORTER' /opt/digit/.env
```

Expect `digit-gatus` and `digit-otel-collector` at every level; Prometheus, Grafana and
node-exporter from `metrics` up; Loki and Promtail from `logs` up; Tempo only at
`traces`.

At `metrics` and `logs`, `OTEL_TRACES_EXPORTER` is set to `none` — otherwise every Java service would keep shipping spans to a Tempo that is not running, and the collector would log export failures on a loop.

**Lowering the level removes containers, as of #1687.** Compose profiles only decide
what to *start*; on their own they leave anything already running untouched, so before
#1687 dropping a tenant from `traces` to `metrics` left Tempo, Loki and Promtail running
and the operator saw no change. The playbook now tears down the tiers the tenant no
longer runs.

---

## Kubernetes tier: wired in, every component off by default

> **This section describes #1675, which has not merged.** On `monitoring-fix` today
> the helmfile line is still commented out and `charts/environments/env.yaml` has no
> `monitoring:` block, so the toggles below do not exist yet. #1675 and this PR both
> target `monitoring-fix` and neither depends on the other's merge, so whichever lands
> first, expect a window where the tree and this page disagree. Nothing here is wrong
> about the intended shape — it is the timing that is unsettled.

`devops/deploy-as-code/digit-helmfile.yaml` lists the tiers to install. The monitoring line **used to be commented out entirely**; #1675 makes it present, and gates each component instead:

```yaml
  - path: ./charts/auxiliary-services/auxiliary-helmfile.yaml
  - path: ./charts/monitoring/monitoring-helmfile.yaml
```

A standard deploy still installs **no** Prometheus, Grafana, Loki or Alertmanager — the path being listed changes nothing on its own, because every release defaults to `installed: false`.

### Why it was commented out

Not a decision anyone here took. `deploy-as-code` was imported wholesale from upstream `egovernments/DIGIT-DevOps`, and the line **arrived already commented** — directly beside `#  - path: ./charts/sanitation/sanitation-helmfile.yaml`, an unrelated business module. The file's convention is "commented = a module this deployment does not use", and monitoring was categorised the same way and never revisited.

The practical consequence was that every monitoring fix in the tree edited files nothing deployed.

That history also explains values you will find pointing at other environments (`unified-qa`, `unified-uat.digit.org`, `urban-lts.digit.org`, a `#unified-qa-alerts` Slack channel): they came in with the import and were never adapted.

### Enabling it

Set the toggles in `devops/deploy-as-code/charts/environments/env.yaml`:

```yaml
monitoring:
  metrics: true      # kube-prometheus-stack — Prometheus, Alertmanager, node-exporter
  dashboards: true   # Grafana
  logs: true         # Loki + Promtail
  probes: false      # blackbox-exporter — external HTTP/TLS probing
  traces: false      # Jaeger — needs an Elasticsearch backend; much the most expensive
  kafkaUi: false     # Kafka admin console — see the warning below
```

### Running a subset

Rough order of value if you are picking only some:

1. **`metrics`** — without it nothing else has data to work from
2. **`dashboards`** — makes the metrics legible; on its own it has nothing to query
3. **`logs`** — answers *why*, once metrics tell you *what*
4. **`probes`** — catches TLS expiry and outside-in failures
5. **`traces`** — only worth it when chasing latency across services

`kafkaUi` is not observability at all: it is a **write-capable Kafka admin console**, published with no authentication. Treat enabling it as an access-control decision.

### Known gaps before you enable it

Each is tracked:

- **No application metrics** until the OTEL agent work lands (#1646) — you get cluster and infra views, not per-service ones
- Prometheus and Alertmanager persistence (#1645) — without it, metrics vanish on every pod restart
- Alertmanager email needs its SMTP secret created first (#1640):
  ```
  kubectl -n monitoring create secret generic alertmanager-smtp \
    --from-literal=password='<smtp-app-password>'
  ```

---

## What is deliberately not monitored

Being explicit, because a gap you chose is different from one you missed.

**Ansible tier — nothing monitors the monitoring.** Not just Promtail and node-exporter:
Gatus has no check for **any** of the seven observability services. `grafana`,
`prometheus`, `loki`, `tempo`, `otel-collector` and `node-exporter` are all exempted in
`.github/scripts/check-gatus-coverage.py` as *"observability plumbing … not a serving
dependency"*, and `promtail` additionally exposes no HTTP listener to check. The
reasoning is that these failing costs visibility, not service — but the consequence is
that the stack telling you about outages cannot tell you about its own. That is a
deliberate gap with a real edge, and it is tracked as **#1613**, which has no PR yet.
Until it does, a dead Prometheus is discovered by noticing the graphs stopped.

The exemption list carries a reason per entry, and CI fails if a new service is added
without either a check or an entry — so the gap stays visible rather than growing
quietly.

**Kubernetes tier** — pod health is covered natively by liveness and readiness probes plus the `kubernetesApps` alert rules, which is why there is no Gatus equivalent. What blackbox adds is the outside view: DNS, ingress, TLS and routing, which no in-cluster probe exercises.

---

## Related

- `alerting-runbook.md` — what each alert means, what to do when it fires, and how to turn alerting on
- `dashboard-metrics.md` — what the dashboard instrumentation measures, client and server side
- `local-setup/README.md` — what the Ansible playbook deploys
- `local-setup/ansible/README.md` — deploy stages, including the health gates
