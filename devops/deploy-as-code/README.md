# deploy-as-code

Helm charts and helmfiles for **large-scale production deployments** of DIGIT on Kubernetes.

This is the production path. The Ansible / Docker Compose tier under `local-setup/` is for **small-scale** deployments — one tenant per box. They are separate deployment models, not alternatives at the same scale.

## Where this came from

Imported from upstream [`egovernments/DIGIT-DevOps`](https://github.com/egovernments/DIGIT-DevOps) and pruned. Worth knowing, because it explains two things that otherwise look like mistakes:

**Some values name other environments.** `unified-qa`, `unified-uat.digit.org`, a `#unified-qa-alerts` Slack channel, a `pgr-demo-db` RDS host. These came in with the import and were never adapted. Treat any such value as unreviewed rather than intentional.

**Monitoring is commented out of the entrypoint** (see below). Also inherited, not a local decision.

The import also deleted the original README, which is why this file exists.

## Layout

```
digit-helmfile.yaml          # entrypoint — lists the tiers to install
charts/
  environments/
    env.yaml                 # per-deployment values (non-secret)
    env-secrets.yaml         # per-deployment secrets (SOPS-encrypted)
  common/                    # library chart every DIGIT service builds on
  backbone-services/         # kafka, redis, elasticsearch, ingress-nginx, ...
  core-services/             # user, workflow, mdms, idgen, ...
  urban/ common-services/ analytics/ auxiliary-services/
  monitoring/                # prometheus, grafana, loki — NOT installed by default
```

## Deploying

```bash
helmfile -f digit-helmfile.yaml -e env apply
```

That is what `.github/workflows/digit_install.yml` runs (manually triggered).

## Monitoring is not installed by default

`digit-helmfile.yaml` ends with:

```yaml
  - path: ./charts/auxiliary-services/auxiliary-helmfile.yaml
#  - path: ./charts/monitoring/monitoring-helmfile.yaml
```

A standard deploy therefore installs **no** Prometheus, Grafana, Loki or Alertmanager — while several charts still ship `ServiceMonitor` and `PrometheusRule` resources that only do something when the operator is running.

**See [`docs/observability/enabling-monitoring.md`](../../docs/observability/enabling-monitoring.md)** for what each component gives you, what it costs, how to enable it, and what to fix first.

## Two things to know before changing anything here

**Values are injected wholesale into every release.** Each release passes `{{ .Values | toYaml }}`, so the *entire* merged `env.yaml` + `env-secrets.yaml` tree reaches every chart. A top-level key intended for one chart can land in another that happens to read the same name — `controller:` is read by both `ingress-nginx` and `kafka-kraft`, and `metrics:` by the `common` library chart used by all 41 services. **Prefer a release-scoped `set:` block over a new top-level key.**

**A mis-pathed values key is silent.** Helm ignores values nothing reads: no warning, no exit code, and `helm template` will not catch it either — it fails only on template errors, `required`/`fail`, or a `values.schema.json` violation, and these charts ship no schema. So a key at the wrong depth looks exactly like working configuration.

Two long-lived defects came from precisely this (#1645 and #1648), which is why `.github/scripts/check-helm-values-paths.py` fails CI on any values key the target chart cannot read.

> **Not merged yet.** That guard and its `deploy-as-code validation` workflow arrive with
> **#1652**; `.github/scripts/` currently holds only the flyway, gateway-whitelist and
> gatus-coverage checkers. Until #1652 lands, **nothing** in CI validates this directory
> beyond `gateway-whitelist-parity`, which reads exactly two list keys out of `env.yaml`.
> Assume a mis-pathed key here reaches production unremarked.

## Secrets

`charts/environments/env-secrets.yaml` is SOPS-encrypted (`charts/.sops.yaml`). Secrets belong there and nowhere else — the encryption rule matches that one file, so a credential placed in a chart's values file is committed in the clear.
