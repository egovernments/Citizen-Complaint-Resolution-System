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

## Pinning on a deploy — making the box run the nightly

Each parameterized service reads its image from an env var (set in `host_vars`,
templated through `digit.env.j2`). Two things are required to actually run the
nightly — **both**, or the box silently keeps running something else:

1. **Pin the image** to the `nightly-develop` tag:

   ```yaml
   # host_vars/<tenant>.yml
   pgr_services_image:  "host:5000/egovio/pgr-services:nightly-develop"
   digit_ui_image:      "host:5000/egovio/digit-ui:nightly-develop"
   otp_publisher_image: "host:5000/egovio/otp-publisher:nightly-develop"
   mcp_image:           "host:5000/egovio/digit-mcp:nightly-develop"
   ddh_image:           "host:5000/egovio/default-data-handler:nightly-develop"
   ```

2. **Turn the matching `build_*` flag OFF.** ⚠️ This is the trap. When
   `build_digit_ui` / `build_mcp` / `build_default_data_handler` /
   `build_otp_publisher` is `true`, the deploy builds that service from source
   on the box and tags it `:local`, **overriding the image pin** — so you get an
   on-box build, not the nightly. For a pull-the-nightly deploy these must be
   `false`. (pgr-services has no `build_*` flag; it always pulls its image var.)

Anything left unset keeps the prior compose default — pinning is opt-in, so this
pipeline changes nothing until a deployment opts a service in.

### Verify what's actually running

```bash
docker ps --format '{{.Names}}\t{{.Image}}' \
  | grep -E 'pgr-services|digit-ui|digit-mcp|otp-publisher|default-data-handler'
```

Every line should show your registry + `:nightly-develop` (or a dated
`:develop-YYYYMMDD`). A `…preview…:latest`, a hand tag like `:pgr-fixes`, or a
`:local` means that service is **not** on the nightly — fix its pin and/or
`build_*` flag.

### Frontend caveat

`digit-ui` above is the **legacy micro-ui** container. The modern UI that
bomet/naipepea actually serve is the **`digit-ui-esbuild`** static bundle, either
laid into the container by `build_digit_ui` or served from a host-nginx dir
(`/opt/digit-ui-esbuild/build`). The nightly builds a `digit-ui-esbuild` *image*,
but the deploy does not yet pull-and-extract that bundle into the served dir —
it still rebuilds on the box. Wiring that pull-and-extract path (so the served
frontend is the nightly too) is the open follow-up; until then the modern
frontend is **not** guaranteed to be the nightly even with the pins above.
