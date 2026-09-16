# k3s monitoring stack (#1618)

Until this landed, the **only** observability manifest in `local-setup/k8s/` was
`tools/gatus.yaml`. That was confusing rather than merely incomplete: the Gatus
config is kept byte-identical across tiers with CI enforcing it — signalling
"these tiers should match" — while every other observability component silently
did not exist here.

**Off by default.** Set `MONITORING=true` before `tilt up -f Tiltfile.k8s`.
Never enabled in CI: that run asserts a fixed set of resources come up healthy,
and five more would slow it and broaden what can flake without testing anything
CI exists to test.

## Phase status

| Phase | State |
|---|---|
| 1 · Metrics — Prometheus, node-exporter, Grafana | **done** |
| 2 · Logs — Loki, Promtail | **done** |
| 3 · Traces — otel-collector, Tempo, per-service OTEL env | **not done** |
| 4 · Gatus wire-up — `GATUS_OBSERVABILITY: true` | **blocked** |

### Why phase 3 is not done

Deploying a collector alone yields empty dashboards. `grep OTEL_ k8s/{core,app}-services/*.yaml`
returns nothing, so **no service in this tier emits telemetry**. Making traces
real means adding the javaagent mount plus `OTEL_SERVICE_NAME` /
`OTEL_EXPORTER_OTLP_ENDPOINT` / exporter vars to each of ~20 Deployments,
including the compose tier's deliberate exceptions (`egov-localization` runs
metrics-only to avoid ~200 MB of agent heap; the OTP/SMS services are off
entirely).

That is the same work as #1646 on the production tier and should follow the
same decisions, so it is tracked separately rather than guessed at here. The
Tempo datasource is provisioned and will simply fail queries until then — the
`otel-collector` scrape target likewise shows **down**, which is honest: absent
rather than silently missing.

### Why phase 4 is blocked

`GATUS_OBSERVABILITY` is introduced by #1613 (PR #1636), which is not merged.
When it is, note that **the Gatus endpoints will need namespaced DNS**: Gatus
runs in `digit`, this stack in `monitoring`, so `http://grafana:3000` does not
resolve across namespaces — it needs `grafana.monitoring.svc.cluster.local`.

## Two things that cost real time

**Prometheus and `--web.enable-lifecycle=false`.** Passing it explicitly does
not work: the flag parser rejects it with `unexpected false` and Prometheus
crash-loops. Omission is the only correct spelling, and the default is already
off — which is what we want, since enabling it exposes unauthenticated
`/-/reload` and `/-/quit` (the defect #1608 fixes on the compose tier).

**The 456 KB dashboard cannot be applied client-side.** `kubectl apply` stores a
copy of the whole object in the `last-applied-configuration` **annotation**, and
annotations cap at **256 KiB**:

```
ConfigMap "grafana-dash-node" is invalid: metadata.annotations:
Too long: must have at most 262144 bytes
```

The object is well under the ~1 MiB object limit, so one-ConfigMap-per-dashboard
(#1618 item 4) does **not** avoid this — the single largest dashboard already
exceeds the annotation cap alone. `Tiltfile.k8s` applies that one **server-side**,
which does not use the annotation.

## Config reuse

Everything is generated from `local-setup/otel/` — the same files the compose
tier uses — so the tiers cannot drift. Two deliberate exceptions:

- **Promtail** — the compose config discovers containers over the Docker socket;
  k3s runs containerd. The discovery half is rewritten
  (`kubernetes_sd_configs`, `cri:` pipeline stage); the Loki-facing half and,
  crucially, the `service_name` label the dashboards select on are preserved.
- **Prometheus** — same job *names* so dashboards carry over, but node-exporter
  is discovered as a DaemonSet rather than named, and `kubelet-cadvisor` is
  added because container CPU/memory comes from the kubelet here, not a Docker
  daemon.

Grafana's dashboard ConfigMaps are mounted as **subdirectories of the provider
path**, because Grafana's file provider recurses — that is what lets
`dashboards.yaml` be reused verbatim. Mounting them elsewhere fails *silently*:
Grafana starts happily and shows no dashboards.

## Before enabling

```
kubectl -n monitoring create secret generic grafana-admin \
  --from-literal=password='<choose one>'
```

Grafana requires login here — anonymous access is off and the login form is
enabled, so this tier does not reintroduce what #1602 closed.
