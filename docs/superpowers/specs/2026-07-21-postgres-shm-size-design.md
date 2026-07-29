# Postgres `/dev/shm` sizing in the Compose stacks

Design for [issue #1365](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1365).

## Problem

During PGR load testing, 1,412 of 3,831 concurrent complaint-list requests (36.9%)
failed with:

```
ERROR: could not resize shared memory segment "/PostgreSQL.NNNNNNNNNN"
       to 8388608 bytes: No space left on device
```

"No space left on device" is `/dev/shm`, not the filesystem. Postgres allocates
dynamic shared memory (DSM) there so the workers of a parallel query can exchange
tuples. The unfiltered complaint-list query — a join with `ORDER BY … DESC` and
`OFFSET/LIMIT` — plans as a parallel query, so each concurrent execution claims its
own DSM segment.

No Compose file sets `shm_size` on `postgres-db`, so every stack runs with Docker's
64 MB default. The error names the segment size: 8388608 bytes = 8 MB. That gives a
ceiling of roughly eight concurrent parallel queries before the ninth fails.

Only the list endpoint is affected. Single-record lookups and single-row writes never
allocate DSM and showed 0% failure in the same run, which makes the fault look
endpoint-specific when it is a container resource limit.

## Sizing

The pad must hold `8 MB × (concurrent queries)`. Concurrency at the database is not
bounded by `MAX_CLIENT_CONN` — pgbouncer runs in transaction pooling mode, so the
bound is `DEFAULT_POOL_SIZE`. That value differs across the stacks, so the required
size does too:

| Compose file | `DEFAULT_POOL_SIZE` | Worst-case DSM | `shm_size` | postgres memory cap |
|---|---|---|---|---|
| `local-setup/docker-compose.egov-digit.yaml` | 60 | ~480 MB | `1gb` | none |
| `local-setup/docker-compose.registry.yml` | 60 | ~480 MB | `1gb` | none |
| `docker-compose.egov-digit.yaml` (repo root) | 60 | ~480 MB | `1gb` | none |
| `local-setup/docker-compose.yml` | 20 | ~160 MB | `256m` | 768M |
| `local-setup/docker-compose.db-migrations.yml` | 20 | ~160 MB | `256m` | 768M |
| `local-setup/docker-compose.deploy.yaml` | 20 | ~160 MB | `256m` | none |

Both values come from the same arithmetic; only the pool size differs.

The worst case overstates real demand — not every query plans as a parallel gather,
and a segment is released when its query ends. Sizing for it anyway is cheap:
`/dev/shm` is a tmpfs, so the setting is a ceiling rather than a reservation and
consumes memory only as pages are written.

### Why not `1gb` uniformly

A tmpfs is charged to the container's memory cgroup, so the pad competes with
shared_buffers, work_mem and the rest of the backend's memory for one budget.
`docker-compose.yml` and `docker-compose.db-migrations.yml` cap `postgres-db` at
768M. A 1 GB pad inside a 768M budget permits postgres to be OOM-killed by filling
the pad alone — a terminal container failure, strictly worse than the recoverable
query error being fixed. At `256m` the pad cannot breach the cap on its own and
~500M remains for the backend's own use.

### Why not `256m` uniformly

It is sufficient for the three pool=20 stacks and insufficient for the three pool=60
ones, which include `docker-compose.egov-digit.yaml` — the stack the failure was
measured on. It would raise that stack's breaking point from ~8 concurrent parallel
queries to ~32 while the pool can still present 60, leaving the reported failure
reachable under the same load profile.

### Alternatives considered

The issue offers two other remedies, neither adopted here:

- **`max_parallel_workers_per_gather = 0`.** Appropriate for an OLTP workload and it
  removes the allocation rather than accommodating it. Rejected because other DSM
  consumers — parallel index build, parallel vacuum — would still meet the 64 MB
  default, so the class of failure stays open, and it forfeits parallelism for
  genuinely analytic queries.
- **An index supporting the list query's ordering.** The narrowest change, but it
  belongs to `pgr-services` migrations rather than `local-setup`, and the planner may
  still choose a parallel plan under different filters.

`shm_size` is the change that closes the failure class for every DSM consumer without
altering query behaviour.

## Changes

### 1. `shm_size` on `postgres-db`

Add the key to the `postgres-db` service in all six Compose files, at the sizes
tabulated above, each with a comment recording the derivation (8 MB per parallel
query × the file's pgbouncer pool size).

No change is needed to `docker-compose.fast-path.yml`. Its `postgres-db` block
overrides only `volumes`, and Compose merges overlays per key, so `shm_size` from the
base file survives.

### 2. README note on log rotation

The other half of #1365 — unbounded container logs filling the host disk and driving
Postgres into a PANIC crash-loop — is fixed on branch `fix/docker-log-rotation-1342`,
which writes `max-size`/`max-file` log-opts into `/etc/docker/daemon.json` from
`playbook-deploy.yml`.

That fix reaches Ansible-deployed hosts only. A hand-run `docker compose up` gets no
rotation at all. `local-setup/README.md` gains a note stating this and pointing at
the daemon-level configuration, citing the measured idle growth from the issue
(7.9 GB across 21 hours, ≈9 GB/day, before any load).

## Verification

For each of the six files, `docker compose -f <file> config --format json` parses and
reports the expected `services["postgres-db"].shm_size` in bytes (1073741824 or
268435456).

Then, on the dev stack, `docker compose up -d postgres-db` followed by
`docker exec docker-postgres df -h /dev/shm` reports 256M rather than 64M.

## Out of scope

- **A CI guard** asserting `shm_size` is present in every Compose file. Considered and
  declined as disproportionate.
- **The two unconfirmed failures in #1365** — `Unknown error occurred in decryption
  process` and `INVALID ACTION … not found in config for the businessService`. The
  issue does not claim either as an upstream defect, and the state needed to diagnose
  them was destroyed by a restore predating the run.
- **HTTP 400 for server-side exceptions.** A `DataAccessResourceFailureException`
  being indistinguishable from client validation by status code materially slowed
  this diagnosis, and 5xx would be correct. It is an exception-handler change in
  `pgr-services`/core rather than a `local-setup` one, and belongs in its own issue.
