# Local deploy — `local-setup/local-deploy.sh`

Bring up the standalone DIGIT compose stack **on your own machine**, pulling every
image from Docker Hub except the handful of CCRS-owned services you explicitly
choose to build from your local source tree. It is the local counterpart to the
nightly image pipeline: same manifest, same image names, no on-box guesswork.

> This has **nothing to do with server deploys.** `deploy.sh` / the Ansible
> playbook are untouched and remain the only way a server is provisioned. See
> [What this does NOT touch](#what-this-does-not-touch).

## TL;DR

```bash
cd local-setup

# Pure pull — every service comes from the registry as the compose file declares.
./local-deploy.sh

# Build pgr-services from your local checkout, pull everything else.
./local-deploy.sh --build pgr-services

# Build several; names are a space-separated set (repeatable).
./local-deploy.sh --build "pgr-services digit-ui"

# See what is buildable and whether it is a service in this compose.
./local-deploy.sh --list

# Generate the override but don't start anything (inspect it first).
./local-deploy.sh --build pgr-services --no-up
```

## How it works

**`build/build-config.yml` is the single source of truth** for what is buildable.
It is the same manifest CI and the nightly consume (see
[`build/NIGHTLY-BUILDS.md`](../build/NIGHTLY-BUILDS.md)). `local-deploy.sh` parses
it with the exact same flatten as the nightly driver
(`local-setup/ansible/files/nightly-build-push.sh`), so a service added there is
automatically buildable here — no second list to maintain.

For each service you pass to `--build`, the script generates a small compose
override, **`local-setup/docker-compose.local-build.yml`**, giving that service a
`build:` block and an `image: <name>:$LOCAL_TAG` (default tag `local`) with
`pull_policy: never`. The override is:

- **auto-generated on every run** (regenerated fresh; stale entries never leak),
- **gitignored** — never commit it,
- named `docker-compose.local-build.yml` (deliberately **not**
  `docker-compose.override.yml`, which Compose would auto-load next to the
  `docker-compose.yml` that also lives in `local-setup/`).

The stack then comes up with:

```bash
docker compose -f docker-compose.egov-digit.yaml -f docker-compose.local-build.yml up -d --build
```

With no `--build`, there is no override and it is a pure pull:

```bash
docker compose -f docker-compose.egov-digit.yaml up -d
```

Build modes are derived from the manifest, no per-service code:

| Manifest entry | Override `build:` |
|---|---|
| `dockerfile: build/maven/Dockerfile` (**maven**) | `context: ..`, `dockerfile: build/maven/Dockerfile`, `args: { WORK_DIR: <work-dir> }` |
| any other `dockerfile:` (**plain**) | `context: ../<work-dir>`, `dockerfile: <path relative to work-dir>` |
| no `dockerfile:` (**plain**) | `context: ../<work-dir>` (Compose uses the `Dockerfile` in the context) |

All paths are relative to `local-setup/`, where the override lives (so `..` is the
repo root).

## Relationship to the nightly tags

The nightly GitHub Actions pipeline pushes each CCRS image to Docker Hub under two
tags (details in [`build/NIGHTLY-BUILDS.md`](../build/NIGHTLY-BUILDS.md)):

- **`nightly-develop`** — a rolling pointer that moves every night to the latest
  `develop` build. The compose defaults track this (e.g.
  `DIGIT_UI_IMAGE` defaults to `egovio/digit-ui:nightly-develop`,
  `novu-bridge-endpoint` to `egovio/novu-bridge-endpoint:nightly-develop`).
- **`develop-YYYYMMDD`** — an immutable daily snapshot for reproducible pins /
  rollback. The nightly retains the **newest 5** per image and prunes older ones.

A pure `./local-deploy.sh` therefore runs whatever `nightly-develop` currently
points at. To **pin a reproducible snapshot** instead of the rolling tag, set the
image env var the compose exposes, for example:

```bash
DIGIT_UI_IMAGE=egovio/digit-ui:develop-20260726 ./local-deploy.sh
```

> **First-nightly note.** `egovio/digit-ui` and `egovio/novu-bridge-endpoint` tags
> exist on Docker Hub only **after the first nightly run** enrolls them (both are
> newly added to the pipeline). Until that first run lands, a pure pull of those
> two will 404 — use `--build digit-ui` / `--build novu-bridge-endpoint` to build
> them locally in the meantime.

## Examples

```bash
cd local-setup

# 1. Pure pull (fastest; runs the current nightly images).
./local-deploy.sh

# 2. Build one service locally, pull the rest.
./local-deploy.sh --build pgr-services

# 3. Build several (space-separated set; --build is also repeatable).
./local-deploy.sh --build "pgr-services digit-ui"
./local-deploy.sh --build pgr-services --build digit-ui   # equivalent

# 4. Inspect the manifest — name / work-dir / dockerfile / mode / is-it-a-service-here.
./local-deploy.sh --list

# 5. Generate the override without starting anything, then read it.
./local-deploy.sh --build pgr-services --no-up
cat docker-compose.local-build.yml

# 6. Enable a compose profile by passing args through after `--`.
#    novu-bridge-endpoint lives behind the `notifications` profile, so it only
#    starts when that profile is enabled:
./local-deploy.sh --build novu-bridge-endpoint -- --profile notifications

# 7. Verify what actually came up.
docker ps --format '{{.Names}}\t{{.Image}}'
```

Anything after a bare `--` is passed straight through to `docker compose … up`
(profiles, `--wait`, `--scale`, etc.). `LOCAL_TAG` overrides the `:local` tag used
for locally-built images.

## What this does NOT touch

- **Server deploys.** `local-setup/ansible/` — `deploy.sh`, the playbook, and all
  `host_vars` — are entirely separate and untouched. This script never invokes
  Ansible and writes nothing under `ansible/`. Provisioning a server still goes
  through `deploy.sh <tenant>`.
- **Vendor / infra / DIGIT-core images** (postgres, redis, kong, the `egov-*`
  platform services, elasticsearch, minio, …) are pulled exactly as
  `docker-compose.egov-digit.yaml` declares. `--build` only affects CCRS-owned
  services that are both in `build/build-config.yml` **and** a service in this
  compose file.

## Troubleshooting

- **`'<name>' is not an image-name in build/build-config.yml`** — the name isn't a
  buildable target. Run `./local-deploy.sh --list` for the exact spellings.
- **`'<name>' is buildable but is NOT a service in docker-compose.egov-digit.yaml`**
  — some manifest entries (the `*-db` Flyway images, `xstate-chatbot`,
  `configurator`, `digit-ui-v2`) are built by the nightly but are not services in
  this standalone compose, so there's nothing to override here.
- **`PyYAML required`** — install it: `python3 -m pip install pyyaml`. The script
  also needs Docker Compose v2 (`docker compose version`).
- **A rebuild didn't pick up my change.** Locally-built images are tagged
  `:local` and reused. Re-run with `--build <name>` — the script always passes
  `--build` to compose, so it rebuilds that service's image from source.
- **Pull 404 on `egovio/digit-ui` or `egovio/novu-bridge-endpoint`.** Those tags
  only exist after the first nightly enrolls them; build locally until then (see
  the first-nightly note above).
