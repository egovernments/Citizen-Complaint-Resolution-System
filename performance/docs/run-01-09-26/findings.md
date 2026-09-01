# Findings

Performance results from load testing DIGIT PGR against a Kubernetes deployment on AWS EKS (September 2026), run as an unthrottled concurrency ladder with a drain gate between levels.

## Testing Methodology

### Tool

All tests use [k6](https://k6.io/) (Grafana), an open-source load testing tool. k6 runs from a control machine and drives HTTP traffic against the cluster over the public internet. The control machine sits in the same AWS region as the cluster, so the network round trip is roughly **24ms** — small enough that it does not dominate the figures below.

### What Each Virtual User Does

Each k6 **virtual user (VU)** runs a complete PGR complaint lifecycle — 4 sequential API calls through the full stack:

```
CREATE (file complaint) → ASSIGN (route to dept) → RESOLVE (close) → SEARCH (verify)
```

Between each API call the VU waits 1-3 seconds (random think time) to simulate realistic user pacing. One full lifecycle takes ~9-10 seconds at low load, longer as the server slows down.

### How to Read "Concurrent Users"

A VU is **not** the same as "users online". A real user might file one complaint every few minutes. A VU files one every ~10 seconds. So **1 VU ≈ 20-30 real concurrent users** in terms of API load.

For a more precise mapping, use TPS as the common unit:
- Throughput is reported in lifecycles/sec (each lifecycle = 4 API calls)
- Multiply by 4 to get TPS across all APIs
- Compare against your expected TPS from real user analytics

### Test Profiles

| Scenario | Shape | Purpose |
|----------|-------|---------|
| `smoke` | 1 VU, 1 iteration | Confirm the lifecycle completes before any load |
| `burst` | Instant jump to N VUs, hold 2 minutes (N = 20, 40, 80, 160, 200, 240, 280, 320) | Locate the failure point by error rate |

Every level is `constant-vus` held for 2 minutes. Figures are whole-run rates over that hold.

**A 2-minute hold is short for a steady-state measurement, and it is the main methodological limit of this run.** It is long enough to separate the 40 → 80 → 120 steps, which sit far outside the noise floor, but not long enough to settle the saturation boundary: the 160 → 200 step falls inside that floor — see [Run-to-Run Variance](#run-to-run-variance). A follow-up run should hold the saturating levels considerably longer before the plateau is treated as established.

### The Drain Gate

Levels are separated by a **drain gate**: the next level does not start until the persister's Kafka consumer lag returns to zero.

The gate originally also required the Elasticsearch indexer's lag to fall below 1,000. That condition can never be satisfied on this cluster — the indexer throws roughly 5,700 transformation errors every five minutes (`$.MdmsRes.tenant.tenants is not found`, `$.TenantBoundary[0].boundary[0] is not found`) and clears its backlog at about 1.3 messages/sec. It is a pre-existing defect unrelated to load testing, and it sits off the complaint write path. The gate checks the **persister only**, which is the consumer that actually governs workflow-state correctness.

Levels are additionally separated by a **dataset reset** — the database is returned to exactly 3 complaints before each level, so no level inherits the previous one's stored data.

Both matter. An earlier ungated pass ran the same levels back to back with a fixed 45-second pause and no reset; its results were not reproducible, because levels inherited both the previous level's Kafka backlog and its rows. That pass is reported separately under [Why the Gate Matters](#why-the-gate-matters), because the difference between the two is itself a useful finding.

### Test Machine

| Component | Spec |
|-----------|------|
| Platform | AWS EKS v1.35.6, 4 × m5a.xlarge |
| Per node | 4 vCPU, 16 GB RAM |
| Cluster total | 16 vCPU, 64 GB RAM, shared across all namespaces |
| Application namespace | `egov`, 36 pods |
| Database | Amazon RDS PostgreSQL, separate from the application nodes |
| Message broker | Kafka (KRaft), 3 controllers |
| Load generator | k6, remote control machine, ~24ms RTT |

**No CPU limits are set on any service in this deployment** — neither limits nor requests. Every run below is therefore unthrottled by construction: services compete for node CPU rather than being pinned to a fixed share. There is no throttled comparison in this run because there is nothing to throttle.

Replicas are **1** on every service in the complaint path (`pgr-services`, `egov-workflow-v2`, `egov-persister`, `egov-user`), so these figures describe a single instance of each.

## Executive Summary

| Metric | Value |
|--------|-------|
| **Peak throughput** | **12.989 lifecycles/sec · 53.49 API req/s** |
| **Daily capacity at peak** | **1,122,250 complaints/day** |
| **Saturation point** | **160 VU** — 200 VU adds 1.3%, inside the noise floor |
| Request failures, every level | **0.000%** |
| Lifecycle success, every level | **100.00%** |
| Error-based ceiling | **Not found** — nothing failed at any level tested |
| Pod restarts, closed-loop levels | **0** |
| Pod restarts, open-loop on shipped heap | **1** (liveness probe, not OOM) |
| Run-to-run variance, fixed dataset | **6.7%** throughput, **51%** p95 |
| Dataset | **fixed at 3 complaints** for every level |
| Cluster utilisation at peak | **5–27% CPU**, 48 of 402 DB connections |

**No error ceiling exists on this deployment within the range tested.** Load is absorbed as latency, not as failure — response times climb while requests keep succeeding. The limit is a throughput plateau at ~53 API req/s reached at 160 VU, and it is reached with the cluster roughly 70% idle.

## Results

Every level below ran against an **identical database**: exactly 3 complaints, restored by a gated cleanup between levels. Nothing accumulated, so levels are directly comparable to each other regardless of run order. All figures are whole-run rates over a 2-minute hold on the **shipped configuration** — no heap or probe changes were in place.

| VU | Lifecycles/s | API req/s | Daily capacity | http p95* | http avg* | Lifecycle success† | Request fail† |
|----|-------------|-----------|---------------|----------|----------|---------|-----------|
| 40 | 4.213 | 17.16 | 364,003/day | 787ms | 274ms | **100.00%** | **0.000%** |
| 80 | 8.050 | 32.82 | 695,520/day | 828ms | 375ms | **100.00%** | **0.000%** |
| 120 | 11.777‡ | 48.03‡ | 1,017,533/day | 855ms‡ | 430ms‡ | **100.00%** | **0.000%** |
| **160** | **12.894** | **52.79** | **1,114,042/day** | 1,816ms | 910ms | **100.00%** | **0.000%** |
| 200 | 12.989 | 53.49 | 1,122,250/day | 3,170ms | 1,619ms | **100.00%** | **0.000%** |

\* `http_req_duration` — server response time, including ~24ms network RTT.
† Different denominators — see [Reading the Two Percentage Columns](#reading-the-two-percentage-columns).
‡ Mean of three repeats at this level; see [Run-to-Run Variance](#run-to-run-variance).

**Not one request failed at any level**, and every lifecycle reached `RESOLVED` — 24,000+ requests across seven runs, with zero pod restarts throughout.

### Throughput plateaus at ~53 API req/s

| Step | Throughput gain | VU increase | Verdict |
|------|----------------|-------------|---------|
| 40 → 80 | +91.3% | ×2.0 | near-linear |
| 80 → 120 | +46.3% | ×1.5 | linear |
| 120 → 160 | +9.9% | ×1.33 | bending |
| **160 → 200** | **+1.3%** | ×1.25 | **flat** |

The 160 → 200 step is inside the 6.7% run-to-run spread measured at 120 VU, so it is **not distinguishable from noise** — the deployment gains nothing from the extra 40 users. Latency over the same step rises 75% (1,816ms → 3,170ms), well outside its own spread.

**Peak throughput is therefore ~13 lifecycles/sec, ~53 API req/s, ~1.12 million complaints/day**, reached at 160 VU. Above that, load converts entirely into waiting.

### Reading the Two Percentage Columns

**The two percentage columns are not complements and will not sum to 100.** They count different things over different denominators:

- **Lifecycle success** (`transaction_success`) — the share of *lifecycles* that completed all four steps and ended in `RESOLVED`. Denominator: lifecycles.
- **Request fail** (`http_req_failed`) — the share of individual *HTTP requests* that returned an error. Denominator: requests, about 4 per lifecycle plus one login per VU.

One failed request anywhere in the chain fails the whole lifecycle, so the lifecycle failure rate runs several times the request failure rate. On this ladder both are zero at every level, so the distinction does not bite — but it matters whenever it is not.

## Run-to-Run Variance

Three repeats of an identical level — 120 VU, drained persister, same
configuration, **each starting from the same 3-complaint dataset**. Without this
measurement, no difference between two runs can be called real.

| Repeat | Lifecycles/s | API req/s | http p95 | Request fail |
|---|---|---|---|---|
| 1 | 11.280 | 46.04 | 1,121ms | 0.000% |
| 2 | 12.073 | 49.22 | 760ms | 0.000% |
| 3 | 11.978 | 48.83 | 685ms | 0.000% |

| Metric | Mean | Std dev | Coefficient of variation | Peak-to-trough |
|---|---|---|---|---|
| Lifecycles/s | 11.777 | 0.433 | **3.7%** | **6.7%** |
| API req/s | 48.03 | 1.735 | 3.6% | 6.6% |
| http p95 | 855ms | 233ms | **27.2%** | **51.0%** |

**Latency remains far noisier than throughput** — roughly seven times the
coefficient of variation. A throughput difference under about 7%, or a p95
difference under about 50%, needs repeats behind it before it means anything.

**Fixing the dataset halved the throughput noise.** An earlier set of repeats,
run while the database was still growing underneath the campaign, measured
12.1% peak-to-trough. On a fixed dataset the same measurement gives 6.7%. Most
of what looked like measurement noise was the dataset moving.

One limit remains: **n=3** is enough to size the noise floor, not enough to
characterise its distribution.

## Open-Loop Testing

Every figure above comes from a closed-loop test: a fixed number of virtual
users, each of which cannot begin a new lifecycle until its previous one
finishes. That design makes the offered load an *output* — the server decides
how fast requests arrive by deciding how fast it responds — so it can never
produce more demand than the system is already absorbing.

`variable-throughput.js` uses a `ramping-arrival-rate` executor instead, holding
the arrival rate independent of server speed: 1 → 15 → 1 → 25 → 2 → 35 → 10 → 0
lifecycles/sec across ten minutes, with valleys between spikes. It was run twice,
once on each configuration.

| | Shipped heap | Raised heap |
|---|---|---|
| `-Xmx` / probe timeout | 192m / 3s | 448m / 10s |
| **dropped_iterations** | **3,899** | **4,390** |
| Iterations completed | 4,124 | 3,561 |
| Intended | 8,023 | 7,951 |
| **Intended work never started** | **48.6%** | **55.2%** |
| API req/s achieved | 26.50 | 23.58 |
| http p95 | 15.59s | 18.51s |
| http max | **59.62s** | 31.48s |
| **Request fail** | **3.79%** (634) | **0.000%** (0 of 14,857) |
| **Lifecycle success** | **89.71%** | **100.00%** |
| Pod restarts | **1 — killed by liveness probe** | **0** |

**Roughly half the intended work never started.** `dropped_iterations` is the
metric a closed-loop ladder cannot produce at all, and it is the honest measure
of the gap between demand and capacity. Lifecycle duration went from ~10s under
closed-loop to 44s and 55s here, and VUs piled up from 11 to the 400 ceiling as
k6 tried and failed to hold the rate.

Note that the closed-loop ladder reported **0.000% failures** at every gated
level while open-loop on the same cluster produced a 48.6% shortfall. Both are
accurate. They answer different questions: closed-loop measures what the system
will accept, open-loop measures what happens when demand does not wait its turn.
Real traffic does not wait its turn.

### The heap setting decides how overload fails

On the shipped configuration the deployment **failed and was restarted**. On the
raised configuration it **queued and stayed up**. Same offered load, same
cluster, same ten minutes.

The shipped run's `pgr-services` was killed by the **liveness probe**, not by
memory — no `OOMKilled` marker appears anywhere in the pod status:

```
Liveness probe failed: context deadline exceeded (x6 over 7m17s)
Container pgr-services failed liveness probe, will be restarted
lastState.terminated: reason=Error exit=137 (SIGKILL)
```

The shipped probe timeout is 3 seconds. Under sustained load `/health` exceeded
it six consecutive times and kubelet restarted a pod that was slow but still
serving; the 50 connection-refused errors in that run are the restart window,
and the 59.62s maximum latency is the same event. **On shipped settings,
sustained load causes Kubernetes to restart healthy-but-loaded pods.**

What the raised heap did *not* do is make the system faster. Successful
lifecycles were 3,700 shipped against 3,561 raised — a 3.9% difference, which
the variance data above places firmly inside the noise. The heap does not buy
throughput. It decides whether overload degrades into slowness or into an outage.

## Why the Gate Matters

An earlier pass ran 200, 240 and 280 VU back to back with a fixed 45-second pause instead of a drain gate. Its results were materially different:

| VU | Ungated failures | Ungated `INVALID ACTION` | Gated failures | Gated `INVALID ACTION` |
|----|-----------------|------------------------|----------------|----------------------|
| 200 | 1.367% | 61 | **0.017%** | **1** |
| 240 | 0.766% | 14 | **0.000%** | **0** |
| 280 | 1.191% | 0 | **0.000%** | **0** |
| 320 | **56.952%** | **2,688** | **0.000%** | **0** |

The 320 VU level is the clearest case. Ungated it failed 56.95% of requests and completed 1.14% of lifecycles; gated, from a drained start, it failed **nothing** and completed **everything**.

Every one of those ungated failures was the same error:

```
code: "INVALID ACTION"
message: "Action RESOLVE not found in config for the businessId: PG-PGR-2026-09-01-004443"
```

Not a timeout, not a 5xx. The workflow service was correctly refusing a transition, because `RESOLVE` arrived before the preceding `ASSIGN` had been committed and become visible. PGR writes workflow transitions asynchronously through Kafka, so a `200` on `ASSIGN` means *accepted and queued*, not *committed*. When the write path is already carrying a backlog, that window widens past the harness's 1-3 second think time and `RESOLVE` overtakes its own `ASSIGN`.

**This is a real defect, not a test artefact** — any client issuing two workflow transitions in quick succession against a backlogged deployment can hit it. But it is a property of *backlog*, not of concurrency: at 320 VU with a drained write path it does not occur at all.

The practical consequence for load testing is that levels must not inherit each other's backlog. A ladder without a drain gate measures the accumulated state of the previous levels, and its numbers will not reproduce.

## What Stored Data Costs

Because the ladder above holds the dataset fixed, the effect of stored data can
be read off separately. The same 120 VU level was measured three times during
this campaign at three different database sizes:

| Records in database | Lifecycles/s | Relative |
|---|---|---|
| 3 | **11.777** | baseline |
| 17,337 | 7.939 | **−33%** |
| ~27,000 | 5.277 | **−55%** |

**Stored data is the single largest influence on throughput measured anywhere in
this campaign** — larger than concurrency, and roughly eight times the 6.7%
run-to-run noise floor. Twenty-seven thousand complaints is a trivial database
by production standards, and it had already more than halved throughput.

**The mechanism was not isolated.** No `EXPLAIN` was captured against a
populated dataset, so this campaign can state the size of the effect but not its
cause. Four facts are readable from the source tree and narrow where to look:

- The PGR search query contains **no `LIKE '%…%'` predicate**. Its only `LIKE`
  is a prefix match on the tenant (`ser.tenantid LIKE 'pg%'`), applied when the
  requested tenant is state-level.
- `eg_pgr_service_v2` is indexed on `id`, `accountid`, `applicationstatus`,
  `servicecode` and `(tenantid, servicerequestid)`, but **not on `createdtime`**
  — which is the column the search orders by when no `sortBy` is given
  (`ORDER BY ser_createdtime DESC`, applied before `OFFSET`/`LIMIT`).
- The search joins `eg_pgr_address_v2` on `parentid`. That table is indexed on
  `locality` only; PostgreSQL does not index a foreign-key column
  automatically, so **the join column carries no index**.
- The count query wraps the entire filtered join in
  `select count(*) from (…)`, so a count reflects the full scoped result set
  rather than one page of it.

Settling this needs `EXPLAIN (ANALYZE, BUFFERS)` on the real query shapes
against a populated dataset. **Indexing and archiving are not substitutes for
each other**: if a plan-level fix exists it is larger and more durable than
archiving, and archiving still helps either way.

The practical consequences:

- Any capacity figure must state the dataset it was measured against. The
  headline numbers above are for an effectively empty database and are therefore
  an **upper bound**, not a forecast.
- A deployment expecting sustained volume needs an archiving policy from the
  outset. This is cheaper than hardware and has a larger effect.
- Load tests must reset the dataset between levels. Earlier passes in this
  campaign did not, and their levels are not comparable to one another — they
  have been superseded by the fixed-dataset ladder above.

## Where the Limit Is

At saturation the deployment is **not** short of CPU, database capacity, or
connections. Peak resource use during the 200 VU level, with metrics-server
sampling every 15 seconds:

| Service | Peak CPU | Behaviour across the ladder |
|---|---|---|
| `egov-user` | **2,088m** | scales with load — 706m at 80 VU to 2,088m at 200 VU |
| `pgr-services` | 908m | **flat** — 803m to 939m regardless of level |
| `egov-workflow-v2` | 380m | flat |
| `egov-persister` | 241m | flat |

Cluster nodes are 4 vCPU each, 16 vCPU total, and sat at **5–27% utilisation**.
PostgreSQL used **48 of 402** available connections. No query was slow: across a
full level the worst mean execution time was **3.27ms**, and the heaviest
consumer by total time was an MDMS lookup at 1.15ms mean over 18,427 calls.

Two things follow.

**`pgr-services` CPU is flat while throughput plateaus.** It never exceeds ~0.94
of a core on a 4-core node with no CPU limit set. A service that is CPU-bound
climbs; this one does not, so it is waiting rather than computing.

**The constraint is application concurrency, not infrastructure.** With ~70% of
cluster CPU idle, 88% of database connections free and no slow query, the
ceiling is a thread-pool, connection-pool or serialisation limit inside the
services. The single-partition Kafka topics documented in
[Known Limits Not Reached](#known-limits-not-reached) are one candidate; this
campaign did not isolate which.

**One optimisation target is visible in the query data.** MDMS lookups account
for more database time than anything else — 26,156 calls in a two-minute level,
roughly 13 per complaint. Each is fast; the volume is the cost. That points at
caching rather than indexing.

## Stability

**Zero pod restarts across every closed-loop level**, including the entire fixed-dataset ladder on the shipped configuration — no restart on `pgr-services`, `egov-workflow-v2`, `egov-persister` or `egov-user`.

The one restart in the whole campaign came from **open-loop testing**, where the liveness probe killed `pgr-services` while it was slow but still serving (see [Open-Loop Testing](#the-heap-setting-decides-how-overload-fails)). Under the closed-loop ladder the shipped configuration was stable throughout.

## Deployment Configuration

### Images under test

| Service | Image tag |
|---------|-----------|
| `pgr-services` | `develop-70916ea` |
| `egov-workflow-v2` | `2.12-87e13fe` |
| `egov-persister` | `maven-jdk21-9f83afb` |
| `egov-user` | `2.12-87e13fe` |

### Changes applied during the campaign

**The headline ladder was measured on the shipped configuration** — no heap or probe changes were in place for it. Three changes were applied for the open-loop comparison only, and reverted afterwards:

| Change | From | To | Why |
|--------|------|----|-----|
| JVM heap | `-Xmx192m` (`-Xmx256m` on `egov-user`) | `-Xmx448m` / `-Xmx288m` / `-Xmx640m`, sized to ~58% of each container's memory limit | Each JVM was using roughly a quarter of the memory already reserved for its container. See [issue #1934](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1934). |
| OOM behaviour | default | `-XX:+ExitOnOutOfMemoryError` | A heap exhaustion otherwise leaves the process alive but permanently stalled — see [issue #1929](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1929). Exiting converts that into a pod restart, which Kubernetes recovers from in seconds and which shows up in restart counts. |
| Probe timeouts | `timeoutSeconds: 3` | `timeoutSeconds: 10` | At saturation `/health` can legitimately take longer than 3 seconds. Five consecutive failures would restart a healthy-but-busy pod mid-run, which reads as a collapse and is not one. |

The closed-loop ladder recorded zero restarts on the shipped configuration, so the heap raise is not load-bearing for those figures. It mattered only under open-loop overload, where it decided whether the deployment degraded into slowness or into an outage. The durable fix belongs in the deployment charts rather than in a hand-applied patch — see [issue #1934](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1934).

**Dataset control.** Between every level a gated transaction removed the complaints that level had written, restoring the database to exactly 3 rows. Deletion was scoped by the harness description marker **and** a time bound, never by description alone, with pre-gates that abort if the target count or the survivor count is unexpected. Three pre-existing complaints from May 2026 were preserved throughout.

### Configuration the harness needs

Pointing the harness at this deployment requires values that differ from the defaults:

| Setting | Value | Why it matters |
|---------|-------|----------------|
| Auth tenant | `pg` | Login is rejected at the city tenant. |
| Filing tenant | `pg.chandigarh` | Complaints are filed at the city tenant, not the state tenant. |
| Locality codes | `CH_WARD_01` … `CH_WARD_35` | **Zero-padded.** `CH_WARD_1` is rejected with `INVALID_BOUNDARY_CODE`. |
| Service codes | 6 codes | PGR validates `serviceCode` against `RAINMAKER-PGR.ComplaintHierarchy`, which holds 8 entries of which 6 are leaves with a department — not against `ServiceDefs`, which advertises 33. The other 27 complaint types cannot be filed. |

The split between authentication and filing tenants is unusual enough that the harness gained an `authTenant` setting for it, falling back to `tenant` where the two are the same.

## Known Limits Not Reached

Two constraints are present in this deployment but were not the binding limit at any level tested, and are recorded so that a future run at higher concurrency knows where to look:

**Every PGR Kafka topic runs a single partition** (`PartitionCount: 1, ReplicationFactor: 1`), including `save-pgr-request`, `update-pgr-request` and `save-wf-transitions`. One consumer processes each topic in sequence regardless of how many application replicas exist. This is the mechanism behind the `INVALID ACTION` behaviour described above, and it is a hard ceiling that adding application capacity cannot lift.

**The Elasticsearch indexer runs behind under load** and drains at roughly 17 messages/second afterwards. It sits off the complaint write path — it feeds search and inbox views — so it did not affect any figure here, but it took 10 minutes to clear after a single 2-minute level at 320 VU.

**No error ceiling was found because the ladder ran out of planned levels, not because anything failed.** The fixed-dataset ladder stopped at 200 VU; the earlier gated pass reached 320 VU without a failed request, on a database that was still growing underneath it — see [Why the Gate Matters](#why-the-gate-matters). Establishing whether an error ceiling exists above the throughput plateau, and whether the single-partition topology described above is what creates it, needs a gated fixed-dataset ladder carried past 320 VU. That run was not made, so both questions remain open.
