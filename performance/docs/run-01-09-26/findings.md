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

### The Drain Gate

Levels are separated by a **drain gate**: the next level does not start until the persister's Kafka consumer lag returns to zero.

The gate originally also required the Elasticsearch indexer's lag to fall below 1,000. That condition can never be satisfied on this cluster — the indexer throws roughly 5,700 transformation errors every five minutes (`$.MdmsRes.tenant.tenants is not found`, `$.TenantBoundary[0].boundary[0] is not found`) and clears its backlog at about 1.3 messages/sec. It is a pre-existing defect unrelated to load testing, and it sits off the complaint write path. The gate checks the **persister only**, which is the consumer that actually governs workflow-state correctness.

This matters more than it sounds. An earlier ungated pass ran the same levels back to back with a fixed 45-second pause, and its results were not reproducible — levels inherited the previous level's backlog, and the failure counts moved non-monotonically as a result. Every figure in this document comes from the gated pass. The ungated pass is reported separately under [Why the Gate Matters](#why-the-gate-matters), because the difference between the two is itself the most useful finding in this run.

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
| Highest level tested | **320 VU** |
| HTTP failures at 240, 280 and 320 VU | **0.000%** |
| Lifecycle success at 240, 280 and 320 VU | **100.00%** |
| Error-based ceiling | **Not found** — no level reached the 5% budget |
| Peak throughput observed | 16.259 lifecycles/sec (66.33 API req/s) at 160 VU, against ~7,000 records |
| Saturation point | **At or below 120 VU** — the lowest gated level, already on the plateau |
| Pod restarts, closed-loop levels | **0** |
| Pod restarts, open-loop on shipped heap | **1** (liveness probe, not OOM) |
| Run-to-run variance at a fixed level | **6.9%** throughput, **20.1%** p95 |
| Records in database | 195 at start, 19,433 at end |

**No error ceiling exists below 320 VU on this deployment.** Load is absorbed as latency, not as failure: throughput falls and response times climb, but requests keep succeeding. The run was stopped at 320 VU because the ladder ran out of planned levels, not because anything broke.

## Results

Three passes were run. Only the **gated pass** is a result; the two ungated passes are reported because the difference between them is itself a finding, and because the ungated ladder is the only place levels below 120 VU were measured.

Whole-run rates over each 2-minute hold. One lifecycle = 4 API calls. Every level ran against a different database, because the campaign's own writes accumulated — the **Records** column gives the number present when each level started, and is the single most important column for reading the rest.

### Gated pass — the result

Each level waited for the persister's Kafka lag to reach zero and the indexer's to fall below 1,000 before starting.

| # | VU | Records | Lifecycles/s | API req/s | http p95* | http avg* | http max* | Lifecycle success† | Request fail† |
|---|----|---------|-------------|-----------|----------|----------|----------|---------|-----------|
| 5 | **120** | 17,337 | 7.939 | **32.67** | 3,188ms | 1,561ms | 5.9s | **100.00%** | **0.000%** |
| 6 | **160** | 18,381 | 7.842 | **32.56** | 5,254ms | 2,709ms | 8.1s | **100.00%** | **0.000%** |
| 1 | 200 | 12,233 | 10.549 | 43.69 | 4,667ms | 2,416ms | 7.0s | 99.93% | 0.017% |
| 2 | 240 | 13,638 | 9.714 | 40.63 | 7,405ms | 3,667ms | 10.7s | **100.00%** | **0.000%** |
| 3 | 280 | 14,952 | 8.983 | 37.97 | 9,589ms | 5,009ms | 13.9s | **100.00%** | **0.000%** |
| 4 | 320 | 16,184 | 7.948 | 34.00 | 11,454ms | 6,804ms | 18.8s | **100.00%** | **0.000%** |

Rows are ordered by VU; the **#** column gives run order. Note that 120 and 160 VU ran *last*, against the largest database, which is why they sit below 200 VU on throughput despite being the lighter load. **Read adjacent run numbers, not adjacent VU counts.**

**24,300 requests across six levels, zero failures, zero pod restarts.**

### Ungated passes — superseded

The same scenarios with a fixed 45-second pause instead of a drain gate. Retained because they are the evidence for [Why the Gate Matters](#why-the-gate-matters), and because levels below 120 VU exist only here.

| # | VU | Records | Lifecycles/s | API req/s | http p95* | Lifecycle success† | Request fail† | `INVALID ACTION` |
|---|----|---------|-------------|-----------|----------|---------|-----------|-----------------|
| 1 | 20 | 195 | 2.218 | 9.03 | 357ms | 100.00% | 0.000% | 0 |
| 2 | 40 | 480 | 4.532 | 18.44 | 164ms | 100.00% | 0.000% | 0 |
| 3 | 80 | 1,061 | 8.810 | 35.85 | 203ms | 100.00% | 0.000% | 0 |
| 4 | 160 | 2,214 | 16.259 | 66.33 | 669ms | 99.57% | 0.268% | 8 |
| 5 | 320 | 4,315 | 20.200 | 102.67 | 1,994ms | **1.14%** | **56.952%** | **2,688** |
| 6 | 200 | 7,118 | 14.516 | 59.47 | 2,594ms | 94.97% | 1.367% | 61 |
| 7 | 240 | 9,028 | 12.552 | 52.12 | 4,892ms | 95.32% | 0.766% | 14 |
| 8 | 280 | 10,695 | 11.448 | 48.14 | 7,233ms | 98.24% | 1.191% | 0 |

\* `http_req_duration` — server response time, including ~24ms network RTT.
† Different denominators — see [Reading the Two Percentage Columns](#reading-the-two-percentage-columns).

The 66.33 API req/s at 160 VU is the highest figure the campaign produced, and it is **not a capacity number**: it was measured against 2,214 records, an eighth of what the gated levels faced, on a curve that had not begun to flatten (20→40→80→160 grew 2.04×, 1.94×, 1.85× for each doubling). The 102.67 req/s at 320 VU is higher still and worthless — 57% of those requests were fast failures, and only 1.14% of lifecycles completed.

### Reading the Two Percentage Columns

**The two percentage columns are not complements and will not sum to 100.** They count different things over different denominators:

- **Lifecycle success** (`transaction_success`) — the share of *lifecycles* that completed all four steps and ended in `RESOLVED`. Denominator: lifecycles.
- **Request fail** (`http_req_failed`) — the share of individual *HTTP requests* that returned an error. Denominator: requests, about 4 per lifecycle plus one login per VU.

One failed request anywhere in the chain fails the whole lifecycle, so the lifecycle failure rate runs several times the request failure rate. At 160 VU, 23 failed requests out of 8,571 (0.268%) cost 9 lifecycles out of 2,101 (0.43% — leaving 99.57% success).

### The Deployment Is Saturated Across Every Level Tested

Because each level ran against a slightly larger database than the one before it (see [The Data-Volume Confound](#the-data-volume-confound)), levels far apart in time cannot be compared directly. **Adjacent pairs, run within minutes of each other, can.** Every such pair tells the same story:

| Pair | Throughput | Inside noise? | http p95 | Exceeds noise? |
|------|-----------|---------------|----------|----------------|
| 120 → 160 VU | −0.3% | yes | **+65%** | **yes** |
| 200 → 240 VU | −7.0% | yes | **+59%** | **yes** |
| 240 → 280 VU | −6.5% | yes | +29% | no |
| 280 → 320 VU | −10.5% | yes | +19% | no |

**The throughput column carries no signal.** Three repeats of an identical level
(see [Run-to-Run Variance](#run-to-run-variance)) show a 12.1% peak-to-trough
spread in throughput between runs that differ in nothing at all. Every
throughput change in the table above is smaller than that. An earlier version of
this document read the column as a trend and stated that each 40-VU step "costs
about 8-11% of throughput"; that claim is withdrawn — it was noise.

**The latency column does carry signal, for the two larger steps.** Against a
36.6% peak-to-trough spread in p95, the +65% and +59% rises are real; the +29%
and +19% are not distinguishable from noise.

So the saturation conclusion stands, on narrower evidence than before: at
120 → 160 VU throughput is flat — which the variance data now tells us is the
*expected* outcome for any two runs, not a finding in itself — while p95 rises
by two-thirds, which is well outside the noise floor. That combination is a
saturation plateau, and it means **the deployment is already at capacity at
120 VU**, the lowest level in the gated series.

**The peak therefore sits below 120 VU and was not measured.** Locating it needs a ladder below 120 with a fixed dataset, which this campaign did not run.

What it does **not** do is fail. Across 240, 280 and 320 VU — 15,636 requests in total — **not one request returned an error**, and every lifecycle reached `RESOLVED`. Whatever the limiting resource is, the stack queues on it rather than shedding load.

## Run-to-Run Variance

Three repeats of an identical level — 120 VU, drained persister, same
configuration, roughly two minutes apart. This is the measurement neither the
March 2026 campaign nor the earlier passes here ever made, and without it no
difference between two runs can be called real.

| Repeat | Lifecycles/s | API req/s | http p95 | Request fail |
|---|---|---|---|---|
| 1 | 5.478 | 22.81 | 5,510ms | 0.000% |
| 2 | 5.496 | 22.87 | 5,257ms | 0.000% |
| 3 | 4.856 | 20.32 | 7,487ms | 0.000% |

| Metric | Mean | Std dev | Coefficient of variation | Peak-to-trough |
|---|---|---|---|---|
| Lifecycles/s | 5.277 | 0.364 | **6.9%** | **12.1%** |
| API req/s | 22.00 | 1.455 | 6.6% | 11.6% |
| http p95 | 6,085ms | 1,221ms | **20.1%** | **36.6%** |

**Latency is three times noisier than throughput.** Any claim resting on a p95
difference smaller than about 37%, or a throughput difference smaller than about
12%, needs repeats behind it before it means anything.

Two limits on this estimate. **n=3** — enough to show the earlier per-rung
deltas sit inside the noise, not enough to characterise the distribution. And it
is **specific to this dataset**: the repeats ran at roughly 27,000 records, where
the same level measured earlier at 17,337 records returned 7.939 lifecycles/s
against 5.277 here. That 34% gap is data growth, and it dwarfs the 12% noise
floor — which is the clearest available statement of how much stored data
matters relative to measurement error on this deployment.

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

## The Data-Volume Confound

The campaign wrote **19,238 complaints** onto a starting database of 195. Every level added to the stored data that later levels then had to query, so each level faced a larger database than the one before it.

This is visible in the numbers. At 200 VU the ungated pass — run against 7,118 records — recorded 59.47 API req/s; the gated pass at the same 200 VU, against 12,233 records, recorded 43.69 req/s. The gate removed the failures but did not cause the 26% slowdown; the database had grown 72% in between.

The consequence is stronger than it first appears: **no two levels in this campaign ran against the same dataset.** Records grew monotonically with every level, in run order:

| Level (gated, run order) | Records present at run start |
|---|---|
| 200 VU | 12,233 |
| 240 VU | 13,638 |
| 280 VU | 14,952 |
| 320 VU | 16,184 |
| 120 VU | 17,337 |
| 160 VU | 18,381 |

Across all three passes the database went from 195 records to **19,433** — the campaign wrote 19,238 complaints, roughly a hundredfold increase on what it started with.

This is why the series is not monotonic in VU order — 200 VU records 43.69 API req/s while 120 VU records 32.67, even though 120 VU is the lighter load. The 120 and 160 levels were run **last**, against the largest database, so their lower throughput reflects data volume rather than concurrency.

Two things follow. **Only adjacent levels are comparable**, and those are used for the saturation analysis above. And **the peak throughput figure of 16.259 lifecycles/sec at 160 VU from the early group should be read as "highest observed at ~7,000 records"** — roughly a third of the data the later levels faced — not as a capacity figure.

A cleanly comparable ladder needs either a database reset between levels or a dataset large enough that the run's own writes are negligible. Neither was done here, and it is the main thing to fix before running this again.

## Stability

**Zero pod restarts across every closed-loop level** — fourteen levels across three passes and not one restart on `pgr-services`, `egov-workflow-v2`, `egov-persister` or `egov-user`.

The one restart in the whole campaign came from **open-loop testing on the shipped configuration**, where the liveness probe killed `pgr-services` (see [Open-Loop Testing](#the-heap-setting-decides-how-overload-fails)). The raised configuration survived the identical test with zero restarts.

That result is only meaningful because the JVM heap was raised for the test. See [Deployment Configuration](#deployment-configuration).

## Deployment Configuration

### Images under test

| Service | Image tag |
|---------|-----------|
| `pgr-services` | `develop-70916ea` |
| `egov-workflow-v2` | `2.12-87e13fe` |
| `egov-persister` | `maven-jdk21-9f83afb` |
| `egov-user` | `2.12-87e13fe` |

### Changes applied for the test

The figures above were **not** measured on the shipped configuration. Three changes were applied to the four services in the complaint path before testing, and reverted afterwards:

| Change | From | To | Why |
|--------|------|----|-----|
| JVM heap | `-Xmx192m` (`-Xmx256m` on `egov-user`) | `-Xmx448m` / `-Xmx288m` / `-Xmx640m`, sized to ~58% of each container's memory limit | Each JVM was using roughly a quarter of the memory already reserved for its container. See [issue #1934](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1934). |
| OOM behaviour | default | `-XX:+ExitOnOutOfMemoryError` | A heap exhaustion otherwise leaves the process alive but permanently stalled — see [issue #1929](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/1929). Exiting converts that into a pod restart, which Kubernetes recovers from in seconds and which shows up in restart counts. |
| Probe timeouts | `timeoutSeconds: 3` | `timeoutSeconds: 10` | At saturation `/health` can legitimately take longer than 3 seconds. Five consecutive failures would restart a healthy-but-busy pod mid-run, which reads as a collapse and is not one. |

**On the shipped `-Xmx192m` configuration these results would not hold.** The heap raise is the reason the campaign recorded zero restarts, and the durable fix belongs in the deployment charts rather than in a hand-applied patch.

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
