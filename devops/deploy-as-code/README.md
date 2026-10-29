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
    env.yaml                 # template values (non-secret), the `env` environment
    env-secrets.yaml         # template secrets (SOPS-encrypted when real)
    cms-saas.yaml            # cms-saas.digit.org, layered over env.yaml (`-e cms-saas`)
    cms-saas-secrets.yaml    # its real secrets: git-ignored, from scripts/cms-saas-secrets-from-cluster.sh
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

Both `helmfile diff` and `helmfile apply` need the helm-diff plugin
(`helm plugin install https://github.com/databus23/helm-diff`). Create the
[Secrets created out of band](#secrets-created-out-of-band) first: with the
default `env-secrets.yaml`, the releases that read them fail without them.

### cms-saas.digit.org

cms-saas (EKS `ccrs-prod`) is its own environment: `charts/environments/cms-saas.yaml`
holds what is specific to it and every helmfile layers it over `env.yaml`.

```bash
scripts/cms-saas-secrets-from-cluster.sh        # before EVERY apply: refreshes it, or stops on a stale copy
helmfile -f digit-helmfile.yaml -e cms-saas diff
helmfile -f digit-helmfile.yaml -e cms-saas apply
```

The environment lists `cms-saas-secrets.yaml` explicitly, so without it helmfile
stops instead of deploying `env-secrets.yaml`'s placeholders over production.
The identity stack's own Secrets (`identity-secrets`, `pgr-onboarding`) are not
in that file: `identity-bootstrap` creates them in the cluster
([helm-identity.md](../../docs/setup/deployment/helm-identity.md)). cms-saas also
needs the [Secrets created out of band](#secrets-created-out-of-band).

## Monitoring is not installed by default

`digit-helmfile.yaml` ends with:

```yaml
  - path: ./charts/auxiliary-services/auxiliary-helmfile.yaml
#  - path: ./charts/monitoring/monitoring-helmfile.yaml
```

A standard deploy therefore installs **no** Prometheus, Grafana, Loki or Alertmanager — while several charts still ship `ServiceMonitor` and `PrometheusRule` resources that only do something when the operator is running.

**See [`docs/operations/monitoring/enabling-monitoring.md`](../../docs/operations/monitoring/enabling-monitoring.md)** for what each component gives you, what it costs, how to enable it, and what to fix first.

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

### Secrets created out of band

With the default `env-secrets.yaml`, these charts read the Secrets below but
don't create them (`existingSecret` / `adminExistingSecret` name them).
Create each one before the release that reads it. This applies to every
environment, `-e env` included:

| Secret | Keys | Read by | Without it |
|---|---|---|---|
| `novu/novu-secrets` | `jwt-secret`, `store-encryption-key`, `novu-secret-key` | novu (`secrets.novu.existingSecret`) | novu-api, -worker and -ws fail with `CreateContainerConfigError` |
| `monitoring/alertmanager-smtp` | `password` | kube-prometheus-stack (`alertmanagerSpec.secrets`, mounted unconditionally) | Alertmanager stays at `Init:0/1` with no log ([prometheus.yaml](charts/monitoring/values/prometheus.yaml)) |
| `monitoring/grafana-admin` | `admin-user`, `admin-password` | grafana (`adminExistingSecret`) | Grafana fails with `CreateContainerConfigError` |

If you blank `existingSecret` (novu) or `adminExistingSecret` (grafana) and
set the values inline instead, the chart creates its own Secret under the same
name, `<release>-secrets` for novu. Don't also create it by hand: the
install then fails with "exists and cannot be imported into the current
release: invalid ownership metadata".

**Upgrading a release installed before these were external.** Helm deletes
resources that drop out of a chart, and in older installs two of these Secrets
belonged to the chart:

- `novu-secrets` belonged to the novu release, so the next novu upgrade deletes
  it. Before upgrading, hand it over:
  ```bash
  kubectl -n novu annotate secret novu-secrets helm.sh/resource-policy=keep \
    meta.helm.sh/release-name- meta.helm.sh/release-namespace-
  kubectl -n novu label secret novu-secrets app.kubernetes.io/managed-by-
  ```
- Grafana's chart-made `grafana` Secret is deleted by the upgrade. Create
  `grafana-admin` first, or Grafana doesn't start. Grafana only reads the
  Secret when its database is new: on an existing install the admin password
  lives in `grafana.db` on the PVC, so the login stays whatever it was, and a
  different password in `grafana-admin` does nothing. Copy the old values so
  the Secret matches the real login:
  ```bash
  kubectl -n monitoring get secret grafana -o json \
    | jq '{apiVersion, kind, type, data: {"admin-user": .data["admin-user"], "admin-password": .data["admin-password"]}, metadata: {name: "grafana-admin", namespace: "monitoring"}}' \
    | kubectl apply -f -
  ```
  To change the login, reset it in Grafana and then update the Secret to match:
  ```bash
  kubectl -n monitoring exec deploy/grafana -c grafana -- grafana cli admin reset-admin-password '<new-password>'
  ```
