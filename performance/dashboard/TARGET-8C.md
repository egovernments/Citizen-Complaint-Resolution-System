# Dashboard benchmark targets: Bomet parity and 8C diagnostics

## Target decision

The comparable baseline is Bomet, not the standalone 8C host. Dhruv's 28 August / 1 September
campaign used an unthrottled **16 vCPU / 30.6 GiB / full-stack Bomet deployment**. Its highest
repeated clean point used a fixed 2,525-row database. The report explicitly says its `cpu-8`
profile is not an 8-vCPU machine: it imposed individual CPU ceilings while retaining all 30 GiB
of RAM, and PGR received only 0.40 vCPU.

Use this matrix:

| Target | Dataset | Purpose | Publish beside Dhruv's result? |
|---|---|---|---|
| `bomet-live` | existing Bomet corpus, read-only | deployed compatibility and browser baseline | Yes, as an “as deployed” browser result |
| `bomet-clone` | exact 3K/50K/100K fixture | primary dashboard scale curve | Yes, only after full parity gate and same host shape |
| `8c` | disposable exact fixture | engineering diagnostic / lower hardware experiment | No; label separately |
| `nairobi-live` | existing Nairobi corpus, read-only | portability smoke | No |

Never seed live Bomet. Restore its deployment/tenant shape to a disposable host, scrub identities,
then let the fixture create and remove only tagged PGR rows. The runtime gate compares every
Compose service, immutable Docker image ID, hashed configuration, CPU and memory against a manifest
captured from Bomet. Candidate PGR/UI images and PGR's disabled benchmark schedulers are the only
default allowed differences.

## Standalone 8C / 24 GB diagnostic

The reachable candidate for the primary 3K/50K/100K benchmark is `ovh-8c24g`: **8 logical
CPUs / 24 GB marketed RAM (22.9 GiB visible to Linux)**. The older performance report's AWS
8C/16 GiB host is a different machine and was not reachable during the 2026-09-02 preflight.
Do not merge results from those two memory shapes under one label.

The Playwright process should run from a separate host so Chromium
does not consume the server CPU/RAM being measured. Record the runner host and network path
with the result.

Bomet is a shared live deployment with real complaints. Nairobi is also shared. They are useful
read-only targets, but neither may receive the synthetic fixture. `run-playwright.sh` enforces that
boundary. A disposable Bomet restore has its own `bomet-clone` target and parity gate.

## What the run records

Every benchmark writes `environment.json` from the target Docker host. It includes:

- logical CPUs, physical memory, CPU model, kernel and Docker version;
- every running container, configured image, immutable image ID and Compose service name;
- a non-reversible SHA-256 fingerprint of each container's runtime configuration;
- configured Docker CPU/memory fields; and
- effective cgroup `cpu.max` and `memory.max` values (the authoritative limits).

This matters because Docker's stored `NanoCpus` value can remain stale after a limit is removed.
An exact fixture run is not publishable if this manifest, the candidate SHA, parity report, or
fixture status is missing. A live read-only run identifies mutable tags through the immutable image
IDs in the captured manifest and has no fixture status by design.

## Current legacy `cpu-8` allocation

The existing [`performance/profiles/cpu-8.yml`](../profiles/cpu-8.yml) was designed for the PGR
lifecycle load test. It is retained as a comparison point, not adopted blindly for dashboard
results.

| Dashboard path component | Existing CPU cap | Role in this test |
|---|---:|---|
| PostgreSQL | 1.60 | analytics SQL over facts/events and dashboard snapshots |
| PgBouncer | 0.20 | PGR-to-PostgreSQL transaction pooling |
| pgr-services | 0.40 | `/v2/analytics/packs`, catalog and `_query` composition |
| Kong | 0.60 | browser ingress, auth/plugin overhead and trace propagation |
| digit-ui | 0.04 | static dashboard assets |
| MDMS backend + legacy MDMS | 0.20 | dashboard pack/config and filter metadata |
| boundary-service | 0.12 | ward hierarchy/filter options and map boundary work |
| egov-user + access-control + localization | 0.56 | login, authorization and labels |
| OTEL collector + Tempo + Grafana | 0.28 | required correlation evidence |
| Redis | 0.20 | shared cache/session support |
| Redpanda + workflow + persister | 1.64 | background/full-stack services, not the dashboard read hot path |
| Elasticsearch + indexer | 1.20 | full-stack background/search services |
| Remaining services listed in the profile | 1.24 | HRMS, IDGen, encryption, inbox, MinIO, etc. |

The listed caps total **8.28 CPU**, and containers not named by that profile are not constrained by
it. In particular, 0.40 CPU for PGR is likely to turn the Java analytics composer into an
artificial bottleneck during a dashboard benchmark. Therefore the first 8C dashboard baseline
uses the complete running stack without applying this legacy quota file; the actual cgroup and
JVM/container memory ceilings are captured in `environment.json`.

## Experimental dashboard-oriented 8C envelope

Use this only as an 8C engineering experiment after the unthrottled baseline. It is not a Bomet
replacement or a deployment recommendation: Dhruv observed that the Bomet full stack held 26.8 GB
at rest, so the 22.9 GiB host cannot reproduce that complete deployment memory shape.

| Component/group | CPU budget | Memory planning ceiling | Rationale |
|---|---:|---:|---|
| PostgreSQL | 2.25 vCPU | 6.0 GiB | primary dashboard data plane; preserves page cache and parallel-query headroom |
| PgBouncer | 0.25 vCPU | 0.25 GiB | small, latency-sensitive connection broker |
| pgr-services | 1.50 vCPU | 1.5 GiB | analytics composition, JSON serialization and request authorization |
| Kong + digit-ui | 0.60 vCPU | 0.75 GiB | ingress plus static serving |
| MDMS, boundary, user, access-control, localization and Redis | 1.25 vCPU | 4.5 GiB | dashboard control-plane dependencies |
| OTEL collector, Prometheus, Tempo, Loki and Promtail | 0.65 vCPU | 4.0 GiB | retain because trace/metric parity is an acceptance criterion |
| Redpanda, workflow, persister, Elasticsearch and indexer | 1.25 vCPU | 3.5 GiB | keep the deployment production-shaped while limiting background contention |
| Host/other service headroom | 0.25 vCPU | 1.5 GiB | kernel, Docker and low-frequency services |
| **Total** | **8.00 vCPU** | **22.0 GiB** | leaves about 0.9 GiB of the visible 22.9 GiB outside planning ceilings |

CPU quota is a ceiling, not a reservation. If strict isolation is required, use a dedicated host
or cpusets rather than assuming `docker update --cpus` dedicates cores. Memory values need to be
reconciled with JVM `-Xmx`, PostgreSQL shared buffers and current working sets before enforcement;
setting a hard limit below current use can cause an OOM restart and invalidate the run.

## Service shutdown policy

The publishable primary run keeps the full stack running. Scheduled dashboard MV refresh and any
unrelated load generator are disabled during fixture setup/run because they directly disturb the
measurement. PGR auto-escalation must also be disabled: the deterministic corpus intentionally has
old open complaints, and an escalation scan would mutate it mid-sample. The runner verifies explicit
`PGR_DASHBOARD_REFRESH_ENABLED=false` and `PGR_ESCALATION_ENABLED=false` values in the running PGR
container before it creates a fixture. Do not stop PostgreSQL, PgBouncer, PGR, Kong, digit-ui, MDMS, boundary, user/auth,
access-control, localization, Redis, or observability.

An optional `dashboard-isolated` diagnostic may stop notification/Novu, OTP, configurator, MCP,
filestore/MinIO, indexing and other unused services. It must have a separate result label and may
not replace the full-stack baseline. Kafka/workflow/persister should remain up for the first
baseline; only disable them in that separately labelled diagnostic after confirming no scheduled
writer is active.

## 8C preflight on 2026-09-02

Read-only inspection of `ovh-8c24g` found:

| Check | Observed state |
|---|---|
| Host | 8 logical CPUs; 24,598,159,360 bytes RAM (22.9 GiB); Haswell-class x86_64 |
| Stack | 51 running containers; employee and public dashboard URLs return HTTP 200 locally |
| Hot-path limits | PostgreSQL, PgBouncer, PGR, Kong, digit-ui, MDMS and boundary all report `cpu.max=max` and `memory.max=max` |
| Deployed images | PGR `master-0938bdf`; digit-ui `master-c287d49` — not yet one pinned benchmark SHA |
| Existing PGR rows | `pg`: 1; `pg.citest`: 2 |
| Dashboard scheduler | no override, therefore application default is enabled at a 300,000 ms interval |
| Auto-escalation | explicitly enabled |

Before the first measured run: deploy one pinned harness/product SHA, use/reset a tenant with zero
complaints, set both scheduler flags false, recreate PGR, capture the new environment manifest, and
then run the 3K tier. Do not use `--allow-existing-corpus` to turn the current three rows into a
nominal “exact” result.
