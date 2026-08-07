# Enabling monitoring

How much monitoring to run, what each part costs, and how to turn parts on and off — on both deployment tiers.

Written for the question an operator actually has: **"how much can I afford, and what do I lose if I skip a piece?"**

> Describes the state of the `monitoring-fix` branch. Some knobs referenced here
> (`observability_level`, the Gatus observability checks) arrive with that work.

---

## The two tiers are different

| | Ansible / Docker Compose | `deploy-as-code` (Helm) |
|---|---|---|
| Used for | **small-scale** deployments, one tenant per box | **large-scale**, production Kubernetes |
| Lives in | `local-setup/` | `devops/deploy-as-code/` |
| Monitoring is | **on by default**, sized by `observability_level` | **off by default** — one commented line |

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

- **The collector is not only for traces.** JVM metrics travel OTLP → collector → `:8889`, which is what Prometheus scrapes. Drop the collector and you lose per-service JVM metrics too. **Tempo** is the only traces-exclusive component.
- **Gatus tells you *that* something is down; the rest tell you *why*.** Uptime checks alone are a smoke alarm with no thermometer.

---

## Ansible tier: `observability_level`

Set it in `host_vars/<tenant>.yml`. Levels are **cumulative** — each includes the one above.

| Level | Adds | Footprint |
|---|---|---|
| `metrics` | Gatus, Prometheus, node-exporter, Grafana, collector | ~1.2 GB |
| `logs` | + Loki, Promtail | ~1.8 GB |
| `traces` **(default)** | + Tempo | ~2.2 GB |

```yaml
# host_vars/mytenant.yml — keep metrics, skip log and trace storage
observability_level: metrics
```

**Why this knob exists.** These boxes are small. 29 services declare roughly **12.8 GB** of configured JVM heap on machines that are commonly 16 GB, and the boxes have **no swap** — so memory pressure means the kernel starts killing processes rather than slowing down. Log and trace storage is where the observability cost concentrates, and skipping it is a legitimate choice.

**Footprints are ceilings, not measurements.** They come from the per-container `mem_limit` values, so treat them as a budget rather than expected usage.

**There is no Gatus-only level yet.** It would be the cheapest (~64 MB), but 16 application services declare `depends_on: otel-collector`, so a level omitting the collector risks failing the deploy rather than shrinking it. Removing that dependency is the fix, and it is tracked separately.

### Verifying it did what you asked

```bash
docker compose ps --format '{{.Name}}' | sort     # which containers actually started
grep -E 'OTEL_(TRACES|METRICS)_EXPORTER' /opt/digit/.env
```

At `metrics` and `logs`, `OTEL_TRACES_EXPORTER` is set to `none` — otherwise every Java service would keep shipping spans to a Tempo that is not running, and the collector would log export failures on a loop.

---

## Kubernetes tier: wired in, every component off by default

`devops/deploy-as-code/digit-helmfile.yaml` lists the tiers to install. The monitoring line **used to be commented out entirely**; as of #1675 it is present, and each component is gated instead:

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

**Ansible tier** — `promtail` and `node-exporter` have no Gatus check: Promtail exposes no HTTP listener, and a dead node-exporter surfaces as a stale Prometheus target rather than a missing check. `.github/scripts/check-gatus-coverage.py` keeps the full list with a reason for each entry, and CI fails if a new service is added without either a check or an entry.

**Kubernetes tier** — pod health is covered natively by liveness and readiness probes plus the `kubernetesApps` alert rules, which is why there is no Gatus equivalent. What blackbox adds is the outside view: DNS, ingress, TLS and routing, which no in-cluster probe exercises.

---

## Related

- `alerting-runbook.md` — what each alert means, what to do when it fires, and how to turn alerting on
- `dashboard-metrics.md` — what the dashboard instrumentation measures, client and server side
- `local-setup/README.md` — what the Ansible playbook deploys
- `local-setup/ansible/README.md` — deploy stages, including the health gates
