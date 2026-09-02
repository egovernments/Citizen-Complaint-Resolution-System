# Dashboard performance fixture

`fixture.sh` creates an exact, deterministic complaint corpus for dashboard
performance runs, refreshes the real dashboard grains, and removes the corpus
afterward. It generates rows in PostgreSQL with `generate_series`; it does not
commit a giant CSV, create random users, or write directly to a materialized
view.

## Safety contract

- Use a dedicated performance environment, never a production database.
- Disable the application's scheduled dashboard refresh for the benchmark
  window; the fixture performs and analyzes every required refresh itself.
- Database writes require `DASHBOARD_FIXTURE_ALLOW_MUTATION=yes`.
- Every complaint carries `additionaldetails.performanceFixture=dashboard-v1`
  and the supplied `performanceRunId`.
- IDs are deterministic hashes of the run ID plus the complaint ordinal.
- Setup fails if that run already exists.
- Setup fails when the target tenant already contains non-fixture complaints, so
  “3K” cannot silently mean 3K plus an unknown existing corpus.
- Teardown selects only the tagged run, deletes its dependent workflow,
  address, document, and daily-snapshot rows, and refreshes all dashboard MVs.
- The script never truncates a table, creates a user, or deletes by tenant.
- Teardown creates a uniquely named temporary `parentid` support index when
  needed, avoiding quadratic foreign-key checks, and drops it after validation.
- `with-fixture` installs exit/signal traps and is the preferred way to run.

The corpus temporarily exists in the PGR source tables because PostgreSQL
materialized views must be refreshed from their source of truth. The rows are
deterministic and run-scoped, not random or permanent. `complaint_events` and
`complaint_facts` are always refreshed in dependency order. The legacy
`pgr_mv_*` views are refreshed afterward. The append-only
`complaint_open_state_daily` table receives one anchor-date snapshot for the
fixture's open complaints and is cleaned by the same run prefix.
All dashboard relations are explicitly `ANALYZE`d after setup and teardown, so
query plans do not depend on an autovacuum race.

## Connection

Use a database URL when `psql` is installed:

```bash
export DASHBOARD_DB_URL='postgresql://egov:...@host:5432/egov'
export DASHBOARD_FIXTURE_ALLOW_MUTATION=yes
```

Or run `psql` inside an existing Postgres container:

```bash
export DASHBOARD_DB_CONTAINER=postgres
export DASHBOARD_DB_USER=egov
export DASHBOARD_DB_NAME=egov
export DASHBOARD_FIXTURE_ALLOW_MUTATION=yes
```

Credentials are read only from the environment and are not written to the run
status artifacts.

## Preferred: Bomet-shaped setup, run, and guaranteed teardown

Dhruv's published baseline is the unthrottled Bomet deployment: 16 vCPU,
30.6 GiB visible RAM, a full 59-container stack, and 2,525 complaints for the
repeatability run. The `cpu-8` result in that report is a set of per-container
quotas on the same 30 GiB host; it is not an 8-vCPU deployment. Browser results
intended to sit beside that baseline must therefore use `bomet-live` or a
`bomet-clone` that passes the runtime parity gate.

Capture the live reference without changing Bomet:

```bash
mkdir -p performance/results/dashboard-runs/bomet-reference
ssh bomet 'DASHBOARD_DOCKER_SUDO=1 bash -s -- -' \
  < performance/dashboard/capture-environment.sh \
  > performance/results/dashboard-runs/bomet-reference/environment.json
```

Use `bomet-live` only for read-only coverage of the existing corpus:

```bash
export DIGIT_USERNAME='...'
export DIGIT_PASSWORD='...'
export DASHBOARD_TARGET_SSH='bomet'
export DASHBOARD_TARGET_DOCKER_SUDO=1

performance/dashboard/run-playwright.sh \
  --target bomet-live --suite benchmark --fixture off --tier existing
```

Use a disposable, restored Bomet clone for the exact 3K/20K/50K/100K/500K curve:

```bash
performance/dashboard/run-playwright.sh \
  --target bomet-clone \
  --run-id issue1109-bomet-clone-3k-full \
  --tier 3k \
  --principal full
```

The target wrapper selects the functional suite, benchmark suite, or both; performs
target safety checks; captures the host/container resource manifest; creates the
fixture; runs Chromium; summarizes the raw samples; and tears the fixture down whether
the test succeeds, fails, or is interrupted. See [TARGET-8C.md](./TARGET-8C.md) for the
reference host, legacy and experimental CPU/memory allocations, and service shutdown policy.

Required values are deliberately explicit:

```bash
export DASHBOARD_BOMET_CLONE_BASE_URL='https://disposable-bomet-clone.example'
export DASHBOARD_BOMET_CLONE_TENANT='ke'
export DASHBOARD_TARGET_SHA='<deployed-40-character-sha>'
export DASHBOARD_TARGET_SSH='performance-host' # omit when running on that host
export DASHBOARD_REFERENCE_ENVIRONMENT="$PWD/performance/results/dashboard-runs/bomet-reference/environment.json"
# export DASHBOARD_TARGET_DOCKER_SUDO=1         # when Docker needs passwordless sudo remotely
# export DASHBOARD_TARGET_DOCKER_LOCAL=1        # use instead when runner is on that host
export DASHBOARD_SCHEDULED_REFRESH_DISABLED=yes
export DASHBOARD_ESCALATION_DISABLED=yes
export DIGIT_USERNAME='...'
export DIGIT_PASSWORD='...'
export DASHBOARD_DB_URL='postgresql://...'
export DASHBOARD_FIXTURE_ALLOW_MUTATION=yes
```

Flags make each part of the harness independently runnable:

```bash
# Read-only compatibility passes. Protected live names force the existing corpus.
performance/dashboard/run-playwright.sh --target bomet-live --suite functional --fixture off
performance/dashboard/run-playwright.sh --target nairobi-live --suite functional --fixture off

# Parity-gated seed/teardown plus only the measured repeated load test.
performance/dashboard/run-playwright.sh --target bomet-clone --suite benchmark --fixture on --tier 50k

# Diagnose the UI against an already prepared 8C corpus, visibly in Chrome.
performance/dashboard/run-playwright.sh --target 8c --suite functional --fixture off --tier existing --headed

# Resolve and validate the plan without touching the DB or browser.
performance/dashboard/run-playwright.sh --target 8c --tier 100k --dry-run
```

The benchmark defaults to two discarded warmups and twenty measured repetitions. Each load
uses a new browser context (cold browser cache) while preserving warmed server/JIT/DB caches.
Raw per-sample JSON, CSV, the aggregate summary, traces-on-failure, fixture status and the
credential-free environment/run manifests land under `performance/results/dashboard-runs/`.
`--vus N` runs those browser samples with `N` Playwright workers; use this only for small
browser-concurrency diagnostics. High-concurrency capacity tests use the k6 dashboard workload
described below so Chromium resource use on the control machine does not become the result.

`bomet-clone` compares every Compose service, immutable image ID, and hashed runtime
configuration with the captured live reference before seeding. It requires the same host CPU
and memory shape by default. Only the components under test (`pgr-services` and `digit-ui`) may
use different images, and only PGR may differ in runtime configuration for the two explicitly
disabled schedulers. These deviations are warnings in `bomet-parity.json`; every other drift is
a hard failure. Set `DASHBOARD_BOMET_REQUIRE_HOST_MATCH=no` only for a separately labelled
hardware experiment, never for a result compared numerically with Dhruv's Bomet run.

## Bomet snapshot run

`run-bomet-snapshot.sh` implements a reversible cycle on the exact Bomet host/stack
without overwriting the live
database:

1. Take a transactionally consistent `pg_dump` of Bomet's `egov`
   database and restore it into a run-scoped `dashboard_perf_*` database.
2. Add one exact temporary PgBouncer route for the clone, reload PgBouncer without a
   restart, remove existing PGR rows from the clone, and install a DB guard that rejects
   every non-fixture PGR insert/update.
3. Create the exact fixture while PGR remains on the original database. Recreate only
   `pgr-services` against the seeded clone with MV refresh and escalation disabled, wait
   for real container health, and require one authenticated pack request plus one KPI query
   to pass before Playwright starts.
4. Tear down the fixture, recreate PGR from the original Compose configuration, restore
   PgBouncer's original configuration byte-for-byte, verify PGR's immutable image and
   critical datasource/scheduler settings, then drop the clone and dump. Changes to the
   live complaint count during snapshot preparation are reported rather than mistaken for
   fixture leakage; the fixture never connects to the original database.

```bash
export BOMET_SNAPSHOT_ALLOW_MUTATION=yes
export BOMET_MAINTENANCE_CONFIRMED=yes # only after real PGR submissions are blocked
export DASHBOARD_FIXTURE_ALLOW_MUTATION=yes
export DASHBOARD_SCHEDULED_REFRESH_DISABLED=yes
export DASHBOARD_ESCALATION_DISABLED=yes
export DASHBOARD_TARGET_SHA='<candidate-sha>'
export DIGIT_USERNAME='...'
export DIGIT_PASSWORD='...'

performance/dashboard/run-bomet-snapshot.sh \
  --run-id issue1109-bomet-3k --tier 3k --suite all
```

For a two-dimensional dataset-size/concurrency campaign, take one snapshot per dataset tier and
run the dashboard API ladder against the same immutable fixture. The default matrix is 20K and
50K complaints at 2, 10, 50, 75, 100, 120, 125, and 150 VUs. These are Dhruv's Bomet ramp
levels plus his fixed-dataset 120-VU repeatability point. Each k6 VU performs the real
`/packs` + `/catalog/_search` bootstrap and all pack KPI queries, paced to one dashboard visit
per ten seconds. A one-VU Playwright run at each tier retains the user-visible page-ready metric.
Both paths retain their raw samples. Generated summaries report
`p50`/`p80`/`p90`/`p95`/`p99`/`max`; the API matrix also separates main-window HTTP RPS,
dashboard visits per second, and KPI-query rate from warm-up traffic.
These rates divide the main-tagged counters by `HOLD_DURATION`; k6's exported counter
`rate` uses the full scenario clock (including the warm-up start offset) and is retained
raw but is not reported as main-window throughput.

If a valid browser sample set for a deterministic tier is already retained, pass
`--skip-playwright` together with `--load-vus` to continue only its API ladder. The
wrapper still creates, validates, activates, tears down, and drops a fresh disposable
snapshot clone.

```bash
performance/dashboard/run-bomet-dashboard-matrix.sh \
  --run-prefix issue1109-dashboard-scale
```

Every load level captures two-second host, container, PGR-health, and PostgreSQL samples. The
runner refuses the next level after a PGR restart/OOM/unhealthy state or when PostgreSQL reaches
90% of `max_connections`. Cleanup also retains at most the latest 5,000 PGR and Kong log lines so
diagnostic capture cannot delay datasource restoration; override that bound with the positive
integer `BOMET_DIAGNOSTIC_LOG_LINES` when needed. Summarize completed cells with:

Set `DASHBOARD_LOAD_SSH` to drive each k6 stage from a separate Linux Docker host. The stage
container and the Bomet resource monitor run detached, so a control-laptop sleep or network
change cannot interrupt traffic or telemetry. The next VU level is still gated by the local
wrapper's post-stage Bomet health check. The default image is pinned by digest; each result
retains its load-generator manifest and image ID.

```bash
node performance/dashboard/summarize-matrix.mjs \
  performance/results/dashboard-runs issue1109-dashboard-scale
```

Use `--probe-only` for a guarded readiness smoke. It performs the same snapshot, exact
fixture, PgBouncer mapping, switch, two-request analytics gate, and full teardown, but does
not start a browser:

```bash
performance/dashboard/run-bomet-snapshot.sh \
  --run-id issue1109-bomet-3k-probe --tier 3k --probe-only
```

The maintenance assertion is mandatory. While PGR points at the disposable clone, the DB guard
rejects real complaint submissions so they cannot be silently discarded, but users would still
receive an error. The wrapper must not run until the maintenance window is approved. The original
database is never restored over and is not mutated by the fixture.

## Manual lifecycle

```bash
performance/dashboard/fixture.sh setup \
  --run-id issue1109-local-01 --tier 50k --tenant pg.citya

performance/dashboard/fixture.sh status --run-id issue1109-local-01

performance/dashboard/fixture.sh teardown --run-id issue1109-local-01
```

Optional controls:

- `--service-code CODE`: use one verified ComplaintHierarchy leaf.
- `--locality CODE`: use one verified boundary, normally a ward.
- `--refresh-mode blocking|concurrent`: blocking is the deterministic default;
  concurrent minimizes reader blocking but requires populated unique-indexed
  MVs.
- `--anchor-time ISO-8601`: fixes all dates relative to one recorded instant.
- `--allow-existing-corpus`: escape hatch for a separately labelled diagnostic;
  never use it for the primary exact-tier curve.

The allowed tiers are exactly `3k`, `20k`, `50k`, `100k`, and `500k`.

## Deterministic distributions

The primary benchmark holds control-plane data fixed and changes only complaint
volume. The generator discovers the deployment's real complaint leaves,
boundaries, PGR workflow states, and up to 500 existing employee UUIDs.

| Dimension | Distribution |
|---|---|
| Age | 0-6d 12%; 7-29d 23%; 30-89d 25%; 90-179d 20%; 180-364d 20% |
| Current outcome | resolved 55%; pending assignment 10%; assigned/open 20%; rejected 10%; reopened/open 5% |
| Rating | 65% of resolved; stars 1/2/3/4/5 = 5/10/20/35/30% |
| Complaint type and ward | 50% concentrated in the busiest deterministic 20%; remainder spread across all discovered values |
| Geolocation | 80% with coordinates; 20% without |
| Reassignment | 20% of assignable complaints |
| Escalation | 10% of complaints |
| Multiple assignees | 5% of assignment events |
| Source | web 55%; mobile 25%; CSC 15%; WhatsApp 5% |

No citizen or employee rows are created. Synthetic citizen account IDs live
only on complaints and implement repeat-complainant skew.

Status snapshots are written under
`performance/results/dashboard-fixtures/` and are gitignored.
