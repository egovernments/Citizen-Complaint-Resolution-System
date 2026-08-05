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

## Drivers

The manifest above is consumed by the **GitHub Actions build pipeline**
(develop-daily + on-release), the **on-box script**, and the **local helper** —
all reading the same `build/build-config.yml`. The two GitHub Actions triggers
share one reusable workflow
([`.github/workflows/build-images.yml`](../.github/workflows/build-images.yml))
that enumerates the manifest, builds each service **multi-arch (amd64 + arm64)**
on native runners, and stitches the manifests; the trigger files below just call
it with different refs/tags.

1. **GitHub Actions — `develop`, daily (the canonical public build).**
   [`.github/workflows/nightly-build-develop.yml`](../.github/workflows/nightly-build-develop.yml).
   Cron `30 13 * * *` — **19:00 IST / 13:30 UTC** — plus `workflow_dispatch`.
   Scheduled workflows fire only from the **default branch**, so the file must
   live there; the reusable build checks out `ref: develop` regardless, so it
   always builds `develop`. Pushes `egovio/<image-name>` under both
   `nightly-develop` (rolling) and `develop-<short-sha>` (immutable — the first
   8 hex chars of the commit it built), then prunes to the **5 most recently
   pushed** snapshot tags per image. This is the public source the compose
   defaults and `local-setup/local-deploy.sh` pull from.

2. **GitHub Actions — on release published.**
   [`.github/workflows/release-build.yml`](../.github/workflows/release-build.yml).
   Fires on `release: [published]` (also a default-branch workflow). Builds the
   exact commit the release tag points at and publishes
   `egovio/<image-name>:<release-tag>` — the **same tag as the GitHub release**
   (e.g. a `v2.13.0` release → `egovio/pgr-services:v2.13.0`). No rolling tag and
   no prune: release tags are immutable and retained indefinitely.

3. **On-box `nightly-build-push.sh` — the pre-existing VPC-registry driver.**
   [`local-setup/ansible/files/nightly-build-push.sh`](../local-setup/ansible/files/nightly-build-push.sh).
   Unchanged — **including its `develop-YYYYMMDD` immutable tag**, which the
   GitHub Actions nightly no longer mints (see *Tags* below); the two drivers
   push to different registries, so they do not collide.
   Runs on the build host, pushes to `$NIGHTLY_PUSH_REGISTRY` (the
   internal VPC registry, never hard-coded in the repo), and is **amd64-only**
   (its deploy targets are `linux/amd64`). Invoked by the bomet nightly redeploy
   wrapper after the `develop` sync and before the converge.

For local work, **`local-setup/local-deploy.sh`** reuses this same manifest to
build a chosen subset from local source while pulling the rest — see
[`docs/LOCAL-DEPLOY.md`](../docs/LOCAL-DEPLOY.md).

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
| `develop-<short-sha>` | immutable snapshot naming the **commit** it was built from — the first 8 hex chars of that SHA. Minted by the GitHub Actions nightly and by a `build.yml` dispatch on `develop`. | no |
| `develop-YYYYMMDD` | **legacy.** Still minted by the on-box `nightly-build-push.sh` into the VPC registry. The GitHub Actions nightly no longer creates these; existing ones on Docker Hub stay prune-eligible and age out. | no |

So PGR is `…/pgr-services:nightly-develop` and `…/pgr-services:develop-84f88837`.

> **Drift note — `pgr-services` vs `pgr-services-dev`.** The `-dev` suffix was an
> artifact of an external preview-registry image and put the *channel in the name*,
> which this convention forbids. The canonical name is **`pgr-services`** (matches
> `build-config.yml` and the compose service); the channel is the `nightly-develop`
> tag. The legacy `pgr-services-dev:latest` remains only as the compose **default
> fallback** until deployments cut their host_vars over to `pgr-services:nightly-develop`,
> after which it can be retired.

#### Why the commit, not the day

A date names *when a build ran*, which is not the same fact as *what it built*.
A re-run later the same day overwrote an "immutable" `develop-20260612` with
different code, and two nights on an unmoved `develop` minted two tags for one
commit. The tag is now sliced from the exact SHA the pipeline resolves once
(`enumerate.outputs.sha`) and every build leg checks out, so the tag is
checkable: `git show 84f88837` **is** the code in `…:develop-84f88837`. A
nightly on an unchanged `develop` re-pushes that same tag instead of
accumulating a new one, so "keep 5" now means the last five *distinct develop
commits built*, not the last five calendar days.

Retention therefore can no longer sort by tag name — hashes have no intrinsic
order, where `develop-YYYYMMDD` gave newest-first for free. The prune reads
Docker Hub's per-tag `last_updated` and keeps the five most recently pushed.
Its pattern is `develop-` + **8 or more** hex chars, which deliberately:

- still matches legacy `develop-YYYYMMDD` (8 digits are 8 hex chars), so those
  age out rather than leaking now that nothing on Docker Hub mints them; and
- does **not** match the 7-char `develop-70916ea`-style pins that
  `local-setup/docker-compose*.yml` and `devops/deploy-as-code/**/values.yaml`
  carry as image defaults — a `{7,}` bound would have pruned live pins.

## Scope: what this nightly does and does NOT build

**In scope — everything in `build-config.yml`** (CCRS-owned): `pgr-services`,
`novu-bridge`, `digit-config-service`, `digit-user-preferences-service`,
`xstate-chatbot`, `default-data-handler`, `digit-mcp`, `otp-publisher`,
`digit-ui` (legacy micro-ui), `digit-ui-esbuild`, `configurator`, `digit-ui-v2`,
and the `*-db` flyway images.

**Out of scope — DIGIT core platform services** (`egov-*`, `kong`,
`boundary-service`, mdms-v2, etc.). These do **not** live in this repo, so this
nightly does not build them; they are pulled from the registry as today. This
pipeline owns only CCRS-repo services.

### Vite SPAs — `configurator` and `digit-ui-v2`

Both now have build-arg-parameterized Dockerfiles and are built nightly. They
differ in how much they bake:

- **`configurator`** reads no `VITE_*` build-env (only `import.meta.env.MODE`),
  so **one image serves every tenant** — configuration is runtime (login + tenant
  pick). Its `nightly-develop` image is fully deployable as-is.
- **`digit-ui-v2`** (citizen SPA) bakes a tenant env contract — the relative
  values (`/auth`, `/token-exchange`) are tenant-neutral, but `VITE_KEYCLOAK_REALM`
  / `VITE_CITIZEN_*` are tenant-specific. The Dockerfile exposes them as
  build-args (defaults match the playbook contract), so the nightly builds a
  **tenant-neutral reference image**. A deploy that needs baked Keycloak SSO
  either rebuilds with the realm/tenant build-args or awaits the runtime-config
  follow-up (config injected at container start so one image truly serves every
  tenant). Both Vite builds mirror their proven on-box recipe: file: sub-packages
  (`data-provider`) built first; configurator uses `vite build` directly (its
  root `tsc -b` has upstream type errors), v2 uses the package.json build.

## Build modes (how each entry is built)

Derived from the `build-config.yml` entry, no per-service code:

- **Maven** (`dockerfile: build/maven/Dockerfile`): repo-root context, shared
  Dockerfile, `--build-arg WORK_DIR=<work-dir>`.
- **Plain** (any other / no `dockerfile`): context = `work-dir`, `-f <dockerfile>`
  if given else the `Dockerfile` in `work-dir`. Covers node services, the UIs,
  and the `*-db` flyway images.

The **on-box `nightly-build-push.sh`** builds `linux/amd64` only (its deploy
targets are amd64). The **GitHub Actions nightly** builds every entry **multi-arch
(amd64 + arm64)** on native runners and stitches a multi-arch manifest per tag.

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

Every line should show your registry + `:nightly-develop` (or an immutable
snapshot pin — `:develop-<short-sha>` from Docker Hub, `:develop-YYYYMMDD` from
the on-box VPC registry). A `…preview…:latest`, a hand tag like `:pgr-fixes`, or
a `:local` means that service is **not** on the nightly — fix its pin and/or
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
