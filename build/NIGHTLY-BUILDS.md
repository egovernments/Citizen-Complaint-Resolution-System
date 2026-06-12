# Nightly image builds — governance & naming conventions

A fresh `./deploy.sh` should **pull** pre-built images, not build them on the box
at deploy time (slow, non-deterministic, and the source of bomet-vs-fresh drift).
To make that possible every CCRS-owned container service is built nightly from
`develop` and pushed to the registry under a predictable tag.

This document is the single place that defines **what gets built**, **what the
images are named**, and **how a deploy pins them**. The build itself is driven by
[`local-setup/ansible/files/nightly-build-push.sh`](../local-setup/ansible/files/nightly-build-push.sh).

## Single source of truth

The set of CCRS images is **`build/build-config.yml`** — the same manifest the CI
build infra already consumes. The nightly script parses it and builds *every*
entry. There is no second hand-maintained list: to add a service to the nightly,
add it to `build-config.yml` (which you do anyway to get it built in CI).

## Naming convention

| Rule | Value |
|------|-------|
| **Image name** | exactly the `image-name` from `build-config.yml`, which equals the compose **service** name. No channel/variant suffix in the *name*. |
| **Channel** | lives in the **tag**, never the name. |
| **Registry** | `$NIGHTLY_PUSH_REGISTRY` on the build host (e.g. `host:5000/egovio`). Never hard-coded in the repo. |

### Tags

| Tag | Meaning | Mutable? |
|-----|---------|----------|
| `nightly-develop` | rolling pointer to the latest `develop` nightly. Deploys that want "track develop" pin this. | yes (moves every night) |
| `develop-YYYYMMDD` | immutable daily snapshot for rollback / reproducible pins. | no |

So PGR is `…/pgr-services:nightly-develop` and `…/pgr-services:develop-20260612`.

> **Drift note — `pgr-services` vs `pgr-services-dev`.** The `-dev` suffix was an
> artifact of an external preview-registry image and put the *channel in the name*,
> which this convention forbids. The canonical name is **`pgr-services`** (matches
> `build-config.yml` and the compose service); the channel is the `nightly-develop`
> tag. The legacy `pgr-services-dev:latest` remains only as the compose **default
> fallback** until deployments cut their host_vars over to `pgr-services:nightly-develop`,
> after which it can be retired.

## Scope: what this nightly does and does NOT build

**In scope — everything in `build-config.yml`** (CCRS-owned): `pgr-services`,
`novu-bridge`, `digit-config-service`, `digit-user-preferences-service`,
`xstate-chatbot`, `default-data-handler`, `digit-mcp`, `otp-publisher`,
`digit-ui` (legacy micro-ui), `digit-ui-esbuild`, and the `*-db` flyway images.

**Out of scope — DIGIT core platform services** (`egov-*`, `kong`,
`boundary-service`, mdms-v2, etc.). These do **not** live in this repo, so this
nightly does not build them; they are pulled from the registry as today. This
pipeline owns only CCRS-repo services.

**Deferred — `digit-ui-v2` / `configurator`.** Their bundles bake tenant
build-env (`VITE_KEYCLOAK_REALM`, etc.) and neither has a build-arg-parameterized
Dockerfile yet, so a single nightly image can't serve every tenant. Tracked as a
follow-up; they are intentionally absent from `build-config.yml`'s buildable set
until that's solved.

## Build modes (how each entry is built)

Derived from the `build-config.yml` entry, no per-service code:

- **Maven** (`dockerfile: build/maven/Dockerfile`): repo-root context, shared
  Dockerfile, `--build-arg WORK_DIR=<work-dir>`.
- **Plain** (any other / no `dockerfile`): context = `work-dir`, `-f <dockerfile>`
  if given else the `Dockerfile` in `work-dir`. Covers node services, the UIs,
  and the `*-db` flyway images.

All builds are `linux/amd64` (deploy targets are amd64).

## Running it

```bash
# build + push every CCRS image from the current develop checkout
NIGHTLY_PUSH_REGISTRY=host:5000/egovio  REPO_DIR=/opt/ccrs  nightly-build-push.sh

# targeted rebuild (space-separated canonical image names)
NIGHTLY_ONLY="pgr-services digit-mcp"  NIGHTLY_PUSH_REGISTRY=…  nightly-build-push.sh

# build everything except a few
NIGHTLY_SKIP="xstate-chatbot xstate-chatbot-db"  NIGHTLY_PUSH_REGISTRY=…  nightly-build-push.sh
```

On bomet the nightly redeploy wrapper invokes it after the `develop` sync and
before the converge, so the nightly self-builds what it then deploys. Exit code
is non-zero if any target failed; the caller decides whether to proceed on the
prior tags.

## Pinning on a deploy

Each parameterized service reads its image from an env var (set in `host_vars`,
templated through `digit.env.j2`). Pin the nightly like:

```yaml
# host_vars/<tenant>.yml
pgr_services_image: "host:5000/egovio/pgr-services:nightly-develop"
otp_publisher_image: "host:5000/egovio/otp-publisher:nightly-develop"
mcp_image: "host:5000/egovio/digit-mcp:nightly-develop"
ddh_image: "host:5000/egovio/default-data-handler:nightly-develop"
```

Anything left unset keeps the prior compose default — pinning is opt-in, so this
pipeline changes nothing until a deployment opts a service in. More services get
an `*_IMAGE` knob as they're cut over to pull-from-registry.
