# Vendored Grafana dashboards

These JSON files were previously fetched from GitHub `master` at pod start
(#1650). That meant `master` was mutable so two deployments a week apart could
differ and neither could be rebuilt as it was; an init container fetched and
applied-as-config whatever those URLs returned; three boards came from an
account outside this organisation; and dashboard changes reached production
without passing through this repo.

They are now vendored here, rendered into ConfigMaps labelled
`grafana_dashboard` by `templates/configmap.yaml`, and picked up by Grafana's
dashboard sidecar (`sidecar.dashboards.enabled: true` in
`../values/grafana.yaml`). No network fetch at pod start.

## Provenance

Captured **2026-08-07** from these upstream commits, not from `master`, so the
snapshot is attributable and re-fetchable:

| Source repo | Commit |
|---|---|
| `dotdc/grafana-dashboards-kubernetes` | `7fc1dc8ccd23eeb8c58ddd8be2a122922d424937` |
| `egovernments/configs` | `6b8e739d26288ce60c77d9efe7985fda47c5b5d3` |

| File | Upstream path |
|---|---|
| `k8s-views-global.json` | dotdc · `dashboards/k8s-views-global.json` |
| `k8s-views-namespaces.json` | dotdc · `dashboards/k8s-views-namespaces.json` |
| `k8s-views-nodes.json` | dotdc · `dashboards/k8s-views-nodes.json` |
| `k8s-views-pods.json` | egovernments/configs · `monitoring-dashboards/Kubernetes-Views-Pods.json` |
| `ingress-dashboard.json` | egovernments/configs · `monitoring-dashboards/k8s-ingress-dashbaord.json` |
| `Loki-Logs.json` | egovernments/configs · `monitoring-dashboards/loki.json` |
| `BlackBox.json` | egovernments/configs · `monitoring-dashboards/blackbox.json` |
| `persistent-volumes.json` | egovernments/configs · `monitoring-dashboards/kubernetes-persistent-volumes.json` |

Content is byte-for-byte upstream — deliberately not reformatted, so a future
`diff` against a newer upstream commit shows only real changes.

## Licensing

`dotdc/grafana-dashboards-kubernetes` is Apache-2.0, Copyright 2020 David
Calvert. Apache-2.0 §4(a) asks a redistributor to hand recipients a copy of the
licence, not just point at it, so the upstream `LICENSE` is vendored verbatim
at [`third-party/LICENSE.dotdc-grafana-dashboards-kubernetes`](third-party/LICENSE.dotdc-grafana-dashboards-kubernetes)
— fetched from the same pinned commit as the boards. Upstream ships no `NOTICE`
file, so §4(d) does not apply. The three files are unmodified, so there is
nothing to mark under §4(b):

- `k8s-views-global.json`
- `k8s-views-namespaces.json`
- `k8s-views-nodes.json`

The remaining boards come from `egovernments/configs` (MIT, same organisation
and same licence as this repo), so they carry no separate redistribution
obligation.

## Updating one

Fetch from a specific commit (never `master`), replace the file, and update the
table above. Re-pin rather than tracking a branch: the whole point is that a
given commit of this repo produces the same dashboards every time.

## Note on `ingress.json`

`../values/ingress.json` used to sit beside these, referenced by nothing. It was
the *same* board as `ingress-dashboard.json` — identical `uid`
(`k8s-nginx-ingress-prometheus-ng`) and all 16 panels, differing only in title
and description. It was an orphaned duplicate and has been deleted.
