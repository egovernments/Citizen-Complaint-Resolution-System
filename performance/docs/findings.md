# Findings

Performance results from load testing DIGIT PGR with up to 1M records (March 2026).

## Testing Methodology

### Tool

All tests use [k6](https://k6.io/) (Grafana), an open-source load testing tool. k6 runs from a control machine and drives HTTP traffic against the DIGIT stack over SSH tunnels.

### What Each Virtual User Does

Each k6 **virtual user (VU)** runs a complete PGR complaint lifecycle — 4 sequential API calls through the full stack:

```
CREATE (file complaint) → ASSIGN (route to dept) → RESOLVE (close) → SEARCH (verify)
```

Between each API call, the VU waits 1-3 seconds (random think time) to simulate realistic user pacing. One full lifecycle takes ~8-15 seconds depending on server load.

### How to Read "Concurrent Users"

A VU is **not** the same as "users online." In our tests:

- **1 VU** = 1 user actively performing a complaint workflow end-to-end, non-stop
- **Real users** spend most of their time reading, navigating, and thinking — not making API calls

A real user might make one complaint every few minutes. A VU makes one every ~10 seconds. So **1 VU ≈ 20-30 real concurrent users** in terms of API load.

When we say "300 VUs," the equivalent real-world concurrency is roughly **6,000-9,000 users online simultaneously**, each occasionally filing or checking complaints.

For a more precise mapping, use TPS (transactions per second) as the common unit:
- Our tests report **throughput in lifecycles/sec** (each lifecycle = 4 API calls)
- Multiply by 4 to get TPS across all APIs
- Compare against your expected TPS from real user analytics

### Test Profiles

| Scenario | Duration | Ramp Pattern | Purpose |
|----------|----------|-------------|---------|
| `ramp-300vu` | 12.5 min | 2 min warmup (5 VUs), then linear 0→300 VUs over 10 min, 30s cooldown | Find degradation point under load |
| `variable-throughput` | 10 min | Spike/valley pattern: 1→15→1→25→2→35→10→0 lifecycles/s | Realistic bursty traffic, cold-start failures |
| `ramp-50vu` | 12 min | 2 min warmup, ramp to 50 VUs, 5 min hold, ramp down | Steady-state performance |
| `burst` | configurable | Instant jump to N VUs, hold | Find breaking point |
| `seed-1m` | ~13 hours | 50 VUs, 540K iterations, no think time | Populate DB with 1M records |

### Resource Profiles

CPU limits are applied to running containers via `docker update` (no restart needed). Memory limits are defined in profiles but only applied at stack startup via Docker Compose overlay.

| Profile | Total CPU | Total Memory | Target Machine |
|---------|-----------|-------------|----------------|
| `4c-8g` | 4 vCPU | 8 GB | Dev (8 vCPU/16 GB) |
| `8c-16g` | 8 vCPU | 16 GB | Both |
| `16c-32g` | 16 vCPU | 32 GB | Prod (16 vCPU/32 GB) |

### Test Machines

| Machine | Specs | Role |
|---------|-------|------|
| Dev | 8 vCPU, 16 GB RAM (AWS EC2) | Constrained-resource testing |
| Prod | 16 vCPU, 32 GB RAM (AWS EC2) | Full-scale testing, 1M record DB |

## Executive Summary

| Metric | Value |
|--------|-------|
| Peak throughput (empty DB) | 37 lifecycles/sec |
| Throughput at 1M records | 6.3 lifecycles/sec |
| Daily capacity at 1M | **544,320 transactions/day** |
| VU ceiling (dev, 8 vCPU) | ~250 concurrent users |
| VU ceiling (prod, 16 vCPU) | ~300 concurrent users |
| Performance issues identified | **3** |
| Throughput recovery after fixes | **9.4x** |
| Total records seeded | 1,006,743 complaints |

The system comfortably exceeds a 10,000 txn/day target even at 1M records. Three database performance issues were identified that caused 5.2x throughput degradation as records grew. After fixing all three, throughput recovered to 37/s at 100K records. At 1M records, remaining degradation is caused by a query pattern in the workflow service that can be resolved by disabling fuzzy search.

Fixes submitted in [PR #248](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/248).

## Baseline Performance

### Ramp Tests (No CPU Limits, Empty Database)

| Test | Machine | Transactions | Success | p95 Latency |
|------|---------|-------------|---------|-------------|
| ramp-2vu | Dev (8 vCPU) | 79 | 100% | 372ms |
| ramp-2vu | Prod (16 vCPU) | 84 | 100% | 361ms |
| ramp-10vu | Dev (8 vCPU) | 436 | 100% | 338ms |
| ramp-10vu | Prod (16 vCPU) | 437 | 100% | 333ms |

At low record counts, dev and prod perform nearly identically — the workload is not CPU-bound.

### Burst Tests (VU Ceiling)

| VUs | Dev (8 vCPU) | Prod (16 vCPU) |
|-----|------------|---------------|
| 20 | 100% pass | 100% pass |
| 80 | 100% pass | 100% pass |
| 150 | 100% pass | 100% pass |
| 250 | 100% pass, p95=476ms | 100% pass |
| 300 | failures | 100% pass, p95=629ms |
| 350 | - | 100% pass |
| 400 | - | failures start |

**VU ceilings:** Dev ~250, Prod ~300. Failures at the ceiling are caused by connection exhaustion and PgBouncer timeouts, not CPU.

## Resource Profile Performance Over Time

All profiles tested with a continuous 0→300 VU ramp over 10 minutes (plus 2-minute warmup). The time-series chart below shows p95 server latency and HTTP error rate evolving over the full test duration, with VU count shown at bottom. Solid lines are empty-DB runs; dashed lines are 1M-record runs.

![All profiles over time — latency, errors, and VU count](/ramp-300vu-timeseries.png)

**How to read this chart:** The top x-axis shows VU count at each point in time. All profiles start the main ramp at t=2min. Latency and errors diverge as load increases — the point where each line pulls away from the pack is that profile's degradation point.

**Key observations:**

- **4c-8g on dev** (pink) degrades first — p95 latency crosses 15s at ~6 min (120 VUs), errors spike to 80% by 9 min (~200 VUs). This profile is too constrained for more than light use.
- **8c-16g on prod** (blue solid) shows steadily rising latency from the start. Despite high p95 (60s at peak), errors stay near 0% until the very end — the system is slow but not failing. This profile caps the request pipeline without breaking it.
- **8c-16g on dev** (green) and **16c-32g on prod** (purple solid) are the clean performers on empty DB. Both keep latency manageable (<40s p95) with 0% errors through 300 VUs. These profiles match their respective machine capacities.
- **1M records** (dashed lines) shift latency curves left by ~2 minutes. The 8c-16g/1M (blue dashed) diverges from its empty-DB counterpart around 5 min (~90 VUs), while 16c-32g/1M (purple dashed) stays close to empty-DB until ~10 min (~240 VUs).
- **The 15s threshold** (red dotted line) is crossed by all profiles eventually, but the timing varies from 6 min (4c-8g) to 10+ min (16c-32g empty).

### Degradation Points by Profile

| Profile | Machine | DB | Latency crosses 15s | Errors > 5% | Max error rate |
|---------|---------|----|--------------------|-------------|----------------|
| 4c-8g | dev (8 vCPU) | empty | ~6 min (120 VUs) | ~8 min (180 VUs) | 98% |
| 8c-16g | prod (16 vCPU) | empty | ~5 min (90 VUs) | ~13 min (290 VUs) | 37% |
| 8c-16g | dev (8 vCPU) | empty | ~8 min (180 VUs) | never | 0% |
| 16c-32g | prod (16 vCPU) | empty | ~10 min (240 VUs) | never | 0% |
| 8c-16g | prod (16 vCPU) | 1M | ~4 min (60 VUs) | ~11 min (270 VUs) | 15% |
| 16c-32g | prod (16 vCPU) | 1M | ~8 min (180 VUs) | ~12 min (300 VUs) | 8% |

### By VU Count (Binned)

The charts below bin the same data by VU range instead of time, making it easier to compare latency and error rates at specific concurrency levels.

![Ramp 0-300 VU comparison — Empty DB](/ramp-300vu-empty-db.png)

### With 1M Records (Prod)

Same ramp test on the prod machine with 1,010,554 PGR complaints in the database. Dashed lines show empty-DB results for comparison.

![Ramp 0-300 VU comparison — 1M Records vs Empty DB](/ramp-300vu-1M-comparison.png)

**Key observations:**
- **1M records adds ~5-10s latency** at all VU levels compared to empty DB
- **8c-16g with 1M records**: Errors start at ~80 VUs, reaching ~25% at 300 VUs. Degradation point much earlier than empty DB.
- **16c-32g with 1M records**: Stays clean up to ~250 VUs, then errors begin. Extra CPU headroom handles the heavier DB queries.
- The latency gap between empty and 1M grows with VU count — DB queries compound under concurrent load.

## Variable Throughput Test (Spike/Valley Pattern)

In addition to the linear ramp, we run a **variable throughput** test that models realistic bursty traffic. Instead of controlling virtual users, this test controls the **request arrival rate** directly using k6's `ramping-arrival-rate` executor.

### Load Shape

```
Lifecycles/s
 35 ┤                              ╭─╮
 25 ┤                  ╭─╮         │ │
 15 ┤       ╭─╮        │ │         │ │
 10 ┤       │ │        │ │         │ ╰─────────╮
  2 ┤       │ ╰────────╯ ╰────────╯            │
  1 ┤───────╯                                   ╰──
    └──┬──┬──┬──────┬──┬──────┬──┬──────────┬──────
      warmup S1  valley1  S2  valley2  S3  sustained
```

| Phase | Duration | Rate (lifecycles/s) | ~API calls/s | What it tests |
|-------|----------|---------------------|-------------|---------------|
| Warmup | 1 min | 1/s | ~4 | Baseline, cache warming |
| Spike 1 | 30s | →15/s | ~60 | Sudden burst handling |
| Valley 1 | 2 min | →1/s | ~4 | Services go idle, connections drain |
| Spike 2 | 30s | →25/s | ~100 | Cold-start after idle — the worst case |
| Valley 2 | 2 min | →2/s | ~8 | Second idle period |
| Spike 3 | 30s | →35/s | ~140 | Peak burst near system max |
| Sustained | 3 min | →10/s | ~40 | Steady-state after stress, GC pressure check |
| Cooldown | 30s | →0/s | 0 | Queue drain |

### What This Catches That Ramp Tests Don't

- **Cold-start failures**: JVM warmup, connection pool spinup after idle periods
- **Kafka consumer rebalance**: persister lag spikes when load drops then surges
- **Memory leaks under stress**: accumulated GC pressure visible in sustained phase
- **Queue drain behavior**: do in-flight requests complete cleanly after spikes?

### Results (Prod 16c-32g, 1M Records, 3 Runs)

![Variable Throughput Results](/variable-throughput-results.png)

All 3 runs are highly repeatable (< 5% variance on all key metrics):

| Metric | Run 1 | Run 2 | Run 3 |
|--------|-------|-------|-------|
| Iterations | 7,664 | 7,659 | 7,654 |
| Throughput | 12.2/s | 12.2/s | 12.1/s |
| HTTP Error Rate | 58.1% | 57.1% | 57.3% |
| Success Rate | 4.4% | 4.7% | 4.3% |
| p50 Latency | 411ms | 412ms | 414ms |
| p95 Latency | 37.7s | 36.6s | 36.1s |

**Key findings from the spike/valley pattern:**

1. **No recovery after spikes**: After Spike 1, the system never fully recovers. Error rates stay elevated through Valley 1 (20-40%) and climb higher with each subsequent spike. By the Sustained phase, errors are 70-75% even at moderate 10/s load.

2. **VU accumulation**: k6 keeps spawning VUs to meet the target rate, but existing VUs are blocked on slow responses. VU count climbs to 350+ and stays there — the system is saturated with in-flight requests.

3. **Queue drain is the bottleneck**: The valleys don't provide enough time for the system to drain its queues. Kafka persister lag and connection pool exhaustion from spikes persist into the next phase.

4. **Median vs tail divergence**: Median latency stays low (411ms) because valley-phase requests are fast. But p95 is 37s because spike-phase requests are extremely slow — a bimodal distribution.

**Implication**: At 1M records, the system cannot handle bursty traffic patterns. The ramp test (which gives services time to warm up gradually) shows much better results than real-world spike patterns would produce. For production deployments at scale, either reduce the DB size (archive old complaints) or apply the `isFuzzyEnabled=false` fix to flatten the query cost.

## Database Performance Issues

Three root causes were identified by enabling Postgres slow query logging (`log_min_duration_statement = 100ms`) and analyzing query plans with `EXPLAIN (ANALYZE, BUFFERS)`.

### 1. Missing Foreign Key Index on `eg_pgr_address_v2.parentid`

The address table has a foreign key to `eg_pgr_service_v2(id)` but no index on the FK column. Every complaint fetch joins through this FK, triggering a sequential scan of the entire address table.

**Before (100K records):**
```
Seq Scan on eg_pgr_address_v2  (cost=0..2891 rows=1 width=648)
  Filter: (parentid = $1)
  Rows Removed by Filter: 102,437
  Execution Time: 24.1ms
```

**After:**
```
Index Scan using idx_eg_pgr_address_v2_parentid  (cost=0..8 rows=1 width=648)
  Index Cond: (parentid = $1)
  Execution Time: 0.12ms
```

**Fix:**
```sql
CREATE INDEX idx_eg_pgr_address_v2_parentid ON eg_pgr_address_v2 (parentid);
```

**Impact: 200x improvement** on address lookups.

### 2. Workflow Fuzzy Search Default

The workflow service has a `isFuzzyEnabled` config flag (default: `true`) that causes businessId queries to use `LIKE ANY(ARRAY['%businessId%', ...])`. Since businessIds are exact values (e.g., `PB-PGR-2026-03-16-105868`), the `%wildcards%` are unnecessary. `LIKE` with leading wildcards defeats btree index usage, forcing a sequential scan of the entire workflow table.

This query runs 3-4 times per complaint lifecycle (it's the workflow status lookup), making it the dominant cost at scale.

**The query:**
```sql
SELECT id FROM eg_wf_processinstance_v2 pi_outer
WHERE pi_outer.lastmodifiedTime = (
    SELECT max(lastmodifiedTime) FROM eg_wf_processinstance_v2 pi_inner
    WHERE pi_inner.businessid = pi_outer.businessid AND tenantid = $1
)
AND pi_outer.tenantid = $1
AND pi_outer.businessId LIKE ANY(ARRAY['%PB-PGR-2026-03-16-105868%'])
```

**Performance comparison (300K workflow rows):**

| Approach | Time | Index Used |
|----------|------|-----------|
| `LIKE ANY` (current, no index) | 100ms | Seq scan |
| `LIKE ANY` + GIN trigram | 3.1ms | GIN index |
| `= ANY` + btree (ideal fix) | 0.13ms | Btree index |

**Workaround applied:**
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_wf_pi_bizid_trgm
  ON eg_wf_processinstance_v2 USING gin (businessid gin_trgm_ops);
```

**Impact: 32x improvement** with GIN workaround. Setting `isFuzzyEnabled=false` uses the existing `IN` code path with btree indexes for **769x improvement**.

### 3. JIT Compilation Overhead on OLTP Queries

Postgres JIT compilation is designed for complex analytical queries. On the simple OLTP queries in DIGIT, JIT spends more time compiling than the query takes to execute.

**Example:** A query that executes in 90ms spends an additional 324ms on JIT compilation.

**Fix:**
```sql
ALTER SYSTEM SET jit = off;
SELECT pg_reload_conf();
```

**Impact: 4.3x improvement** on affected queries.

## Combined Fix Impact

All three fixes applied together at 100K records:

| Metric | Before Fixes | After All Fixes | Speedup |
|--------|-------------|-----------------|---------|
| Throughput (50 VUs) | 3.96/s | 37.09/s | **9.4x** |
| HTTP avg latency | 4,090ms | 433ms | **9.4x** |
| HTTP p95 latency | 5,620ms | 558ms | **10.1x** |

## 1M Record Seeding

### Methodology

- Scenario: `seed-1m.js` — 50 VUs, 540,000 shared iterations, CREATE → ASSIGN → RESOLVE
- 1-second delay between CREATE and ASSIGN for Kafka persister async write
- All 33 complaint types rotated, 500 citizen users
- Target: prod machine (16 vCPU, 32 GB RAM)

### Results

| Metric | Value |
|--------|-------|
| Iterations completed | 540,000 / 540,000 (100%) |
| Success rate | 99.99% (539,969 successes) |
| HTTP failures | 31 / 1,620,050 (0.002%) |
| Avg throughput | 11.8 completions/sec |
| Duration | 12 hours 43 minutes |
| Data transferred | 8.4 GB received, 7.1 GB sent |

### Final Database State

| Table | Records | Size |
|-------|---------|------|
| `eg_pgr_service_v2` | 1,006,743 | 742 MB |
| `eg_wf_processinstance_v2` | 2,892,719 | 2,301 MB |
| `eg_pgr_address_v2` | ~1,006,743 | ~390 MB |
| **Total database** | - | **3,532 MB** |

## Performance at 1M Records

With all database fixes applied, 50 VUs:

| Metric | Value |
|--------|-------|
| Throughput | 6.3 lifecycles/sec |
| HTTP avg latency | 2,160ms |
| HTTP p95 latency | 3,340ms |
| Success rate | 100% |
| **Daily capacity** | **544,320 txn/day** |

## Degradation Curve

Throughput as a function of record count (all DB fixes applied, 50 VUs):

| Records | HTTP Avg Latency | Throughput |
|---------|-----------------|------------|
| ~0 (empty) | 450ms | 37/s |
| 100K | 433ms | 37/s |
| ~300K | ~700ms | ~22/s |
| ~500K | ~1,000ms | ~14/s |
| ~700K | ~1,400ms | ~12/s |
| **1,006K** | **2,160ms** | **6.3/s** |

The degradation is driven by the workflow `LIKE ANY` correlated subquery. Even with the GIN trigram index, the query cost grows with table size. Disabling fuzzy search (`isFuzzyEnabled=false`) switches to `IN` queries with btree indexes, which would flatten this curve significantly.

## Recommended SQL Indexes

Apply these to any DIGIT Postgres instance running at scale:

```sql
-- 1. Missing FK index on address table (200x improvement)
CREATE INDEX idx_eg_pgr_address_v2_parentid
  ON eg_pgr_address_v2 (parentid);

-- 2. Composite index for workflow tenant+businessservice queries
CREATE INDEX idx_eg_wf_pi_v2_tenant_bsvc
  ON eg_wf_processinstance_v2 (tenantid, businessservice, lastmodifiedtime DESC);

-- 3. Composite index for workflow tenant+businessid lookups
CREATE INDEX idx_wf_pi_tenant_bizid_time
  ON eg_wf_processinstance_v2 (tenantid, businessid, lastmodifiedtime DESC);

-- 4. GIN trigram index for LIKE ANY workaround (32x improvement)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_wf_pi_bizid_trgm
  ON eg_wf_processinstance_v2 USING gin (businessid gin_trgm_ops);

-- 5. Disable JIT for OLTP workloads (4.3x improvement)
ALTER SYSTEM SET jit = off;
SELECT pg_reload_conf();

-- 6. Enable slow query logging (for ongoing monitoring)
ALTER SYSTEM SET log_min_duration_statement = 100;
SELECT pg_reload_conf();
```

## Recommended Configuration Change

The single most impactful change for DIGIT performance at scale:

Set `EGOV_WF_FUZZYSEARCH_ISFUZZYENABLED=false` in your workflow service deployment config (Docker Compose env or Helm values).

This switches from `LIKE ANY(ARRAY['%id%', ...])` to `IN (...)` queries, which use standard btree indexes.

**Impact at 300K workflow rows:**

| Config | Query Time | Improvement |
|--------|-----------|-------------|
| `isFuzzyEnabled=true` (default) | 100ms (seq scan) | - |
| `isFuzzyEnabled=true` + GIN trigram index | 3.1ms | 32x |
| `isFuzzyEnabled=false` (recommended) | 0.13ms (btree) | **769x** |

This fix is included in [PR #248](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/248) for both Docker Compose and Helm chart deployments.

## Operational Lessons

1. **Docker log rotation** — Container logs can fill disk in hours under load. Configure `/etc/docker/daemon.json`:
   ```json
   {
     "log-driver": "json-file",
     "log-opts": { "max-size": "100m", "max-file": "3" }
   }
   ```

2. **Docker volume pruning** — Orphaned volumes accumulate. Run `docker volume prune` periodically. One cleanup freed 36.4 GB.

3. **Kong DNS cache** — After `docker compose restart`, Kong caches stale container IPs. Use `docker compose down && up` instead to recreate the network.

4. **Kafka async delay** — The Persister writes to Postgres asynchronously via Kafka. Under high load, there's a 1+ second delay between an API response and the data being queryable. Seed scripts must account for this with a sleep between CREATE and ASSIGN.

5. **Encryption service resilience** — `egov-enc-service` may fail after a disk-full event. A full service restart (`docker compose restart egov-enc-service`) recovers it.
