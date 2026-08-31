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

## Preferred: setup, run, and guaranteed teardown

```bash
performance/dashboard/fixture.sh with-fixture \
  --run-id issue1109-local-01 \
  --tier 3k \
  --tenant pg.citya \
  --anchor-time 2026-08-31T12:00:00Z \
  -- npm exec playwright test performance/dashboard/playwright
```

`RUN_ID` and `DATASET_TIER` are exported to the child command. Teardown runs
whether the command succeeds, fails, or is interrupted.

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

The allowed tiers are exactly `3k`, `50k`, and `100k`.

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
