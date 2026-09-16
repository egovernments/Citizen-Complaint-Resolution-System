# Deploying self-hosted Matomo on Kubernetes

Matomo is the analytics destination a CCRS deployment sends portal usage to —
[open-source web analytics](https://matomo.org/), the self-hostable alternative
to Google Analytics. Self-hosting is the point: with Google Analytics, citizen
browsing data leaves the deployment's infrastructure; with Matomo On-Premise the
visit data stays in a database the deployment owns.

This document covers the **Kubernetes / Helm tier** (`devops/deploy-as-code`).
The compose / Ansible tier is packaged separately — see
[`docs/matomo-deployment.md`](matomo-deployment.md), which also carries the
shared material: what to point the portal at, the traps, and how the portal's
analytics shim relates to all this.

## What this is not

Deploying Matomo sends nothing anywhere. It stands up an empty, self-contained
analytics server that no page is yet pointed at.

Pointing the portal at it is a **separate, MDMS-driven step** — configurator →
*System → Analytics Providers* — deliberately so, because it means collection
can be switched on and off without a redeploy.

It is also **not Matomo Cloud**. Matomo On-Premise is free and there is no
account to create anywhere. Matomo *Cloud* is the paid hosted product with a
signup; none of this applies to it.

---

## The chart

Vendored at `devops/deploy-as-code/charts/backbone-services/matomo` — Bitnami
matomo 11.0.0, taken from `DIGIT-DevOps@central-instance-deployment`, which is
what the eGov Matomo install note points at. Its `mariadb` and `common`
subcharts are vendored **unpacked** under `charts/`, matching how the
`postgresql` chart in the same directory is vendored (dependencies retained in
`Chart.yaml`, no `Chart.lock`).

Matomo is PHP + MySQL/MariaDB and cannot use the platform's Postgres, which is
why the chart brings its own database.

## 1. Set the credentials — before the first apply

In `devops/deploy-as-code/charts/environments/env-secrets.yaml`:

```yaml
secrets:
    matomo:
        existingSecret: matomo-admin   # preferred
        password: ""
        dbPassword: ""
        dbRootPassword: ""
```

**`existingSecret` is the preferred path**: name a Kubernetes Secret carrying a
`matomo-password` key, created out of band (sealed-secret / external-secret /
OpenBao-synced), and nothing credential-shaped is committed at all.
`env-secrets.yaml` is committed, unencrypted and not gitignored.

The chart **refuses to render** if neither is usable
(`templates/validate-credentials.yaml`). Two things it rejects, both of which
look harmless:

- **empty** — the chart's fallback is `common.secrets.passwords.manage`, which
  mints a *new* random password on every render, so no operator would ever hold
  a working one. This is the same trap the Grafana block in
  `charts/monitoring/monitoring-helmfile.yaml` documents.
- **a known placeholder** (`change-me-strong` and friends, case-insensitively) —
  a placeholder that survives to a real apply publishes `/matomo` with
  credentials readable straight out of this repository.

"Before the first apply" is not a style preference: the chart installs Matomo
unattended, and its first run is the only moment `matomoPassword` is read.
Fixing it afterwards means resetting the password from inside the pod, because
Matomo owns the hash from that point on. The same is true of
`dbPassword`/`dbRootPassword` — MariaDB bakes them in at initialisation and only
`ALTER USER` changes them.

## 2. Turn it on

In `charts/backbone-services/backboneservices-helmfile.yaml`, flip the `matomo`
release to `installed: true`. That is the only switch — the chart has no second
internal gate, matching `minio`, `postgresql` and `db-seed` above it.

It asks for **two 30 Gi volumes** (Matomo + MariaDB), publishes at
`https://<domain>/matomo` with the deployment's existing `<domain>-tls-certs`,
and runs in the `backbone` namespace.

Unlike the compose tier, **this tier installs Matomo unattended** — Bitnami's
image supports `matomoUsername` / `matomoPassword` / `matomoEmail`, so there is
no browser wizard.

---

## Know what you are running: `bitnamilegacy`

Every image this chart and its mariadb subchart pin is **404 on Docker Hub
today.** Verified against the registry API:

| Pinned by the chart | On Docker Hub | Under `bitnamilegacy/` |
|---|---|---|
| `bitnami/matomo:5.3.2-debian-12-r12` | 404 | present |
| `bitnami/os-shell:12-debian-12-r50` | 404 | present |
| `bitnami/apache-exporter:1.0.10-debian-12-r55` | 404 | present |
| `bitnami/mariadb:12.0.2-debian-12-r0` | 404 | present |
| `bitnami/mysqld-exporter:0.17.2-debian-12-r16` | 404 | present |

Bitnami moved its legacy tags to the `bitnamilegacy/` namespace, so the helmfile
release re-points every one of them there — the same remedy, for the same cause,
as the kafka-kraft exporters a few releases above it. Deployed as the install
note writes it, without those overrides, the release is **ImagePullBackOff on
every pod**, not a partial degradation.

`bitnami/matomo` is not merely missing a tag: the whole repository now carries
**zero** tags, so there is no maintained Bitnami image to move to.

One image could not be fixed from the helmfile: the chart hardcodes
`bitnami/os-shell` inside its `sidecars:` template string, where no values
override reaches it. That one is patched in the vendored `values.yaml` and
carries a `LOCAL MODIFICATION` comment — **re-apply it if the chart is ever
re-vendored from upstream.**

And be clear about what `bitnamilegacy` *means*: those tags are frozen and
receive no further updates, security ones included. For a server holding citizen
browsing data that is a real posture cost. The durable fix is mirroring these
into `egovio/` with version tags, which needs registry push rights this work did
not have — the same follow-up the kafka comment names.

---

## Known gap: visitor IPs

> Tracked as **#1904**. Split out because it is not a Matomo problem — nothing
> sets source-IP handling on the shared ingress-nginx controller, so every
> Ingress in the cluster has the same blind spot.

Matomo here records the **ingress controller's** address, not the visitor's. It
is not only that geolocation reports a single point: Matomo derives visitor
identity partly from IP + user agent, so when every visitor shares one address
**distinct visitors can collapse into a single visit**. And IP anonymisation has
nothing meaningful left to anonymise.

The compose tier does not have this problem — it sets
`General.proxy_client_headers`, measured there as `192.168.0.0` (real visitor)
with it versus `172.19.0.0` (docker bridge gateway) without.

Fixing it is a cluster-topology decision, and both options are wrong in the
other's environment:

| Option | Correct when | Cost |
|---|---|---|
| `controller.config.use-forwarded-headers: "true"` | behind a trusted L7 load balancer that **overwrites** `X-Forwarded-For` | applies to **every** Ingress in the cluster; where pods are reachable without passing the LB, a client can forge its own source IP |
| `controller.service.externalTrafficPolicy: Local` | you want the true source IP with no header trust | drops traffic on nodes running no controller pod; needs an LB that health-checks node ports |

> **Note for anyone copying the eGov install note:** it specifies
> `nginx.ingress.kubernetes.io/use-forwarded-headers: "true"` as a per-Ingress
> annotation. ingress-nginx implements `use-forwarded-headers` only as a
> controller ConfigMap setting, so that annotation is **inert** — it looks like
> the problem is solved and it is not. This chart no longer sets it.

---

## Status of this work

**Verified:**

- `helm lint`, `helm template` and `helmfile template` all clean
- every rendered image resolves to a tag that actually exists
- exactly one `spec.tls` entry — `tls: true` alone already yields
  `<domain>-tls-certs`, and adding an `extraTls` block for the same host (the
  obvious move, copying the kibana release) renders a duplicate
- the credential guard across 8 cases: empty, three placeholder spellings
  (case-insensitive), a real password, and `existingSecret` with both an empty
  and a placeholder password
- `helmfile list` with the `secrets.matomo` block present **and wholly absent** —
  the release reads it with `index`, because helmfile renders with
  `missingkey=error` and the dotted form is a hard parse failure against any
  `env-secrets.yaml` predating these keys, which breaks *every* release in the
  file, not just matomo

**Not verified — no cluster was available.** The chart lints and templates; it
has not been applied. So the unattended install, the two 30 Gi PVCs and the
ingress are all unexercised on a real cluster.
