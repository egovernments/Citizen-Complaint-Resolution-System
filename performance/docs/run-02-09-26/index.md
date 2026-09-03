# Dashboard Read-Path Load Test — 2–3 September 2026

This run measured how the employee dashboard read path changes with both stored
complaint count and concurrent dashboard demand on the live-shaped Bomet Docker
Compose deployment.

| Document | Contents |
|---|---|
| [Detailed measurements](../dashboard-scaling-02-09-26) | Complete 20K/50K/100K/500K matrices, latency percentiles, runtime observations, browser samples, and cleanup evidence |
| [Capacity planning](../recommendations-transition-plan#dashboard-read-capacity-at-500k-stored-complaints) | Deployment guidance, user-equivalence model, database recommendations, and Kubernetes decision boundary |

## Headline

At exactly **500,000 stored complaints**, the dashboard remains functionally
correct through 200 virtual users: every completed stage returned 100% dashboard
success, zero partial analytics responses, zero HTTP failures, zero PGR
restarts, and no OOM.

The useful limit arrives before errors. Throughput begins falling behind the
offered pace at 175 VUs and stops growing at 200 VUs:

| VUs | Offered dashboard loads/s | Realized loads/s | HTTP RPS | Dashboard p50 | p95 | p99 |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 10.0 | 10.000 | 30.750 | 6.053s | 7.152s | 7.209s |
| 125 | 12.5 | 12.500 | 38.442 | 7.450s | 9.936s | 10.042s |
| 150 | 15.0 | 15.000 | 46.125 | 8.213s | 10.837s | 16.037s |
| 175 | 17.5 | 16.417 | 50.567 | 10.164s | 14.378s | 17.959s |
| 200 | 20.0 | 16.092 | 49.775 | 12.468s | 17.562s | 22.376s |

At 200 VUs, 14.3% more concurrency than 175 VUs produces 1.6% less HTTP
throughput and 22% higher dashboard p95. The measured ceiling is therefore
approximately **16.1–16.4 dashboard loads/s or 50 HTTP RPS** on this
configuration. Above it, work queues rather than completing faster.

## What Was Tested

- **Target:** Bomet, 16 vCPU and 30.6 GiB RAM, with the full stack running.
- **Load generator:** separate 8 vCPU / 24 GiB machine using a pinned k6 image.
- **PGR build:**
  `sha256:6af21d546f53258a0d92adb41e7094c08a24bfe89c3dddec0036d6c887503bb3`.
- **Dataset:** deterministic tiers at 20K, 50K, 100K, and 500K complaints.
  The 500K tier contained 1,355,000 workflow events, 500,000 materialized facts,
  and 175,000 daily snapshot rows.
- **Load ladder:** 2, 10, 50, 75, 100, 120, 125, 150, 175, and 200 VUs at
  500K. Each completed cell used a 30-second warm-up and 120-second measurement.
- **Dashboard visit:** pack and catalog bootstrap followed by one batched query
  containing all nine selected KPIs. A VU attempts one visit every 10 seconds.
- **Telemetry:** end-to-end dashboard and per-request latency percentiles,
  realized visits/s, HTTP RPS, correctness/error rates, host load/memory, PGR
  CPU/memory/restarts/OOM, and PostgreSQL active/waiting sessions.

The 2–150 and 175–200 results are from run IDs
`issue1109-scale11-20260902-500k-api` and
`issue1109-scale12-20260903-500k-high`. A just-started 225-VU stage was stopped
after the plateau was established; it is marked incomplete and excluded.

## Database Finding

At 500K, PostgreSQL reached all 18 observed connections and recorded waiting
sessions from the 10-VU stage onward. Spot samples at high load showed
`DataFileRead`, `BufferMapping`, and `SpinDelay` waits, with no blocking
transaction or advisory-lock queue. Peak host load1 reached 38.10 while memory
remained available and PGR stayed healthy.

This is a database I/O/buffer and concurrency bottleneck in the measured read
path. Adding more application VUs—or adding application replicas without
changing database capacity—will not remove it and may increase the queue.

## Translating Dashboard Load to People

Dhruv's complaint-lifecycle approximation of one test VU to 20–30 people must
not be reused here. A dashboard VU repeatedly performs one whole dashboard load
every 10 seconds; the corresponding population depends on how often a real user
reloads or changes filters.

The direct conversion is:

> concurrent dashboard users = dashboard loads/second × average seconds between loads

| Average interval per active user | Users at recommended interim load (10 loads/s) | Users at measured ceiling (16.1 loads/s) |
|---:|---:|---:|
| 10 seconds | 100 | ~161 |
| 30 seconds | 300 | ~483 |
| 60 seconds | 600 | ~966 |
| 5 minutes | 3,000 | ~4,830 |

These are active dashboard users repeatedly generating loads, not accounts,
logged-in sessions, or total employees. Production telemetry for dashboard
loads per user should replace the interval assumptions when available.

## Recommendations

1. **Use 10 dashboard loads/s as the interim operating point at 500K**, not the
   16.1-load/s ceiling. It produced 30.75 HTTP RPS with 7.15-second p95 and
   leaves roughly 38% throughput headroom. If the product adopts a strict
   five-second p95 SLO, use the measured 5-load/s point instead (4.48-second
   p95).
2. **Separate PostgreSQL from the application host around 500K stored
   complaints** and measure it before moving application services. Compare the
   current co-located baseline with a dedicated database using the same data,
   queries, connection pools, and load generator.
3. **Treat PgBouncer and JDBC pools as one budget.** Increasing only one layer
   can move the queue or overload Postgres. Size them from concurrent query
   demand and database CPU/I/O, then repeat the 100/125/150/175/200 ladder.
4. **Profile the nine dashboard KPI queries at 500K and 1M** with
   `EXPLAIN (ANALYZE, BUFFERS)`, `pg_stat_statements`, and wait-event sampling.
   Prioritize reads, buffer misses, temporary spill, and repeated scans before
   increasing hardware.
5. **Keep materialized-view refresh away from peak dashboard periods.** Measure
   foreground latency during refresh separately, and alert on freshness/refresh
   duration so capacity is not quoted from a refresh-free test only.
6. **Repeat the selected operating point three times and run a 30-minute soak.**
   The current cells are single two-minute windows. Publish production capacity
   only after throughput variance, p95 variance, cache state, and recovery are
   known.
7. **Add an open-loop dashboard arrival test.** The current closed-loop test
   proves where throughput flattens, but an arrival-rate scenario is required to
   quantify queue growth, dropped iterations, timeouts, and recovery after a
   burst.
8. **Do not present Kubernetes as the database fix.** Move to Kubernetes when
   high availability or horizontal application scaling is required, but pair it
   with a dedicated/right-sized database, bounded connection budgets, query
   improvements, and an archiving/retention plan.

The dedicated PostgreSQL comparison and its Ansible implementation are tracked
in [#1971](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1971).

## Scope Boundary

This test measures the dashboard read path. Dhruv's complaint-lifecycle test
measures CREATE → ASSIGN → RESOLVE → SEARCH across PGR, Workflow, Kafka,
Persister, and PostgreSQL. Their VUs, RPS, user conversions, and daily-capacity
figures are different units and must remain separate in deployment guidance.

All fixture data was isolated in disposable snapshot clones. Final teardown
removed the exact seeded rows, restored PGR to the original `egov` database and
configuration, dropped the clone, and left PGR healthy with zero restarts/OOM.
